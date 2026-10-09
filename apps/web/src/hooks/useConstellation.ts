'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '@/lib/api';
import type {
  GraphNode,
  GraphEdge,
  Subgraph,
  StreamToken,
  SeedResponse,
  ExpandResponse,
  StreamPayload, ExpansionStatus, CreditSource,
} from '@/types/constellation';

/** Seed the graph is centred on. `null` means "no graph loaded". */
export type ConstellationSeed = { type: 'artist'; id: string } | null;

/**
 * Options for the data hook. `roleMask` is the server-side role filter (bitmask
 * over ROLE_BITS); changing it triggers a re-seed so the filter is applied by the
 * backend's `subgraph`. `undefined` means "all roles" (no filter).
 */
export interface UseConstellationOptions {
  roleMask?: number;
  actorId?: number;
  walkingFocus?: number | null;
  breadcrumbIds?: number[];
}

export interface UseConstellationResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  creditSource: CreditSource | null;
  availability: ExpansionStatus | null;
  onFrame: (payload: StreamPayload) => void;
  onStatus: (payload: ExpansionStatus) => void;
  focusId: number | null;
  streamToken: StreamToken | null;
  loading: boolean;
  error: string | null;
  /** Re-seed centred on `personId`, bumping the stream generation. */
  recenter: (personId: number) => Promise<void>;
  /** Merge the cached neighbourhood of `personId` into the current graph. */
  expandMore: (personId: number) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Pure merge / dedupe helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Stable identity key for an edge. */
export function edgeKey(edge: GraphEdge): string {
  return `${edge.source}->${edge.target}`;
}

/** Merge two node lists, deduping by `personId` (incoming wins on conflict). */
export function mergeNodes(current: GraphNode[], incoming: GraphNode[]): GraphNode[] {
  const byId = new Map<number, GraphNode>();
  for (const node of current) byId.set(node.personId, node);
  for (const node of incoming) byId.set(node.personId, node);
  return [...byId.values()];
}

/** Merge two edge lists, deduping by `source->target` (incoming wins). */
export function mergeEdges(current: GraphEdge[], incoming: GraphEdge[]): GraphEdge[] {
  const byKey = new Map<string, GraphEdge>();
  for (const edge of current) byKey.set(edgeKey(edge), edge);
  for (const edge of incoming) byKey.set(edgeKey(edge), edge);
  return [...byKey.values()];
}

/**
 * Merge an incoming subgraph into the current node/edge sets, deduping nodes by
 * `personId` and edges by `source->target`.
 */
export function mergeSubgraph(
  current: { nodes: GraphNode[]; edges: GraphEdge[] },
  incoming: Subgraph,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: mergeNodes(current.nodes, incoming.nodes),
    edges: mergeEdges(current.edges, incoming.edges),
  };
}

export const MAX_FIELD_NODES = 300;
export const ANCHOR_BREADCRUMBS = 5;

/** Oldest merged nodes leave first, with anchor neighbourhoods receiving priority. */
export function boundField(graph: { nodes: GraphNode[]; edges: GraphEdge[] }, mandatoryIds: number[]) {
  const mandatory = new Set(mandatoryIds);
  const neighbours = new Set<number>();
  for (const edge of graph.edges) {
    if (mandatory.has(edge.source)) neighbours.add(edge.target);
    if (mandatory.has(edge.target)) neighbours.add(edge.source);
  }
  const retained = new Set(graph.nodes.map(node => node.personId));
  for (const preferOutside of [true, false]) {
    for (const node of graph.nodes) {
      if (retained.size <= MAX_FIELD_NODES) break;
      if (mandatory.has(node.personId) || (preferOutside && neighbours.has(node.personId))) continue;
      retained.delete(node.personId);
    }
  }
  return { nodes: graph.nodes.filter(node => retained.has(node.personId)),
    edges: graph.edges.filter(edge => retained.has(edge.source) && retained.has(edge.target)) };
}

// ---------------------------------------------------------------------------
// Endpoint builders
// ---------------------------------------------------------------------------

function seedUrl(id: string, tokenId?: string, roleMask?: number): string {
  const params = new URLSearchParams({ type: 'artist', id });
  if (tokenId) params.set('token', tokenId);
  // Server-side role filter (bitmask over ROLE_BITS). Only sent when set — an
  // undefined mask means "all roles" and the server omits the filter entirely.
  if (roleMask !== undefined) params.set('roleMask', String(roleMask));
  return `/api/constellation/seed?${params.toString()}`;
}

function expandUrl(personId: number, token: StreamToken | null, roleMask?: number): string {
  const base = `/api/constellation/expand/${personId}`;
  const params = new URLSearchParams();
  if (token) {
    params.set('token', token.id);
    params.set('generation', String(token.generation));
  }
  if (roleMask !== undefined) params.set('roleMask', String(roleMask));
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Data hook for the constellation graph. Owns the current node/edge sets, the
 * focus, and the SSE stream token, and exposes `recenter` / `expandMore`.
 */
export function useConstellation(
  seed: ConstellationSeed,
  options: UseConstellationOptions = {},
): UseConstellationResult {
  const { roleMask } = options;
  // Nodes + edges live in one state slice so `mergeSubgraph` can update both
  // atomically (an `expandMore` merge must not tear across two renders).
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [creditSource, setCreditSource] = useState<CreditSource | null>(null);
  const [availability, setAvailability] = useState<ExpansionStatus | null>(null);
  const originalSeed = useRef<number | null>(null);
  const currentCenter = useRef<number | null>(null);
  const walk = useRef({ focus: options.walkingFocus, breadcrumbs: options.breadcrumbIds ?? [] });
  walk.current = { focus: options.walkingFocus, breadcrumbs: options.breadcrumbIds ?? [] };
  const anchors = useCallback(() => {
    const distinct = [...new Set([...walk.current.breadcrumbs].reverse())].slice(0, ANCHOR_BREADCRUMBS);
    return [originalSeed.current, walk.current.focus ?? currentCenter.current, ...distinct].filter((id): id is number => id != null);
  }, []);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [streamToken, setStreamToken] = useState<StreamToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef<StreamToken | null>(null);
  const epoch = useRef(0);
  const active = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const expansions = useRef(new Map<number, AbortController>());
  const roleMaskRef = useRef(roleMask); roleMaskRef.current = roleMask;
  const retire = useCallback(() => {
    epoch.current += 1;
    for (const controller of controllers.current) controller.abort();
    controllers.current.clear(); expansions.current.clear();
    return epoch.current;
  }, []);
  const applySeed = useCallback((data: SeedResponse) => {
    tokenRef.current = data.streamToken;
    if (originalSeed.current === null) originalSeed.current = data.focusId;
    currentCenter.current = data.focusId;
    setFocusId(data.focusId);
    setCreditSource(data.creditSource ?? null);
    setAvailability(null);
    setGraph(previous => {
      const mandatory = new Set(anchors());
      return boundField({ nodes: mergeNodes(previous.nodes.filter(node => mandatory.has(node.personId)), data.subgraph.nodes), edges: data.subgraph.edges }, anchors());
    });
    setStreamToken(data.streamToken);
  }, [anchors]);
  const seedType = seed?.type ?? null;
  const seedId = seed?.id ?? null;
  const seedIdentity = `${options.actorId ?? ''}:${seedType}:${seedId}`;
  const previousSeed = useRef<string | null>(null);
  useEffect(() => {
    active.current = true;
    const generation = retire();
    tokenRef.current = null; setStreamToken(null);
    if (previousSeed.current !== seedIdentity) {
      originalSeed.current = null; currentCenter.current = null;
      setGraph({ nodes: [], edges: [] }); setFocusId(null);
      previousSeed.current = seedIdentity;
    }
    setAvailability(null); setCreditSource(null); setError(null); setLoading(false);
    if (seedType !== null && seedId !== null) {
      const controller = new AbortController(); controllers.current.add(controller);
      setLoading(true);
      void api.get<SeedResponse>(seedUrl(seedId, undefined, roleMask), { signal: controller.signal })
        .then(({ data, error: err }) => {
          if (controller.signal.aborted || epoch.current !== generation) return;
          if (err || !data) { setError(err ?? 'Failed to load constellation'); return; }
          applySeed(data);
        }).catch(() => {
          if (!controller.signal.aborted && epoch.current === generation) setError('Failed to load constellation');
        }).finally(() => {
          controllers.current.delete(controller);
          if (!controller.signal.aborted && epoch.current === generation) setLoading(false);
        });
    }
    return () => { active.current = false; retire(); };
  }, [seedType, seedId, seedIdentity, roleMask, options.actorId, applySeed, retire]);

  const recenter = useCallback(async (personId: number) => {
    if (!active.current || !Number.isSafeInteger(personId) || personId <= 0) return;
    const previousToken = tokenRef.current;
    const generation = retire();
    tokenRef.current = null; setStreamToken(null);
    const controller = new AbortController(); controllers.current.add(controller);
    setLoading(true); setError(null);
    try {
      const { data, error: err } = await api.get<SeedResponse>(seedUrl(String(personId), previousToken?.id, roleMaskRef.current), { signal: controller.signal });
      if (controller.signal.aborted || epoch.current !== generation) return;
      if (err || !data) { setError(err ?? 'Failed to re-center constellation'); return; }
      applySeed(data);
    } catch {
      if (!controller.signal.aborted && epoch.current === generation) setError('Failed to re-center constellation');
    } finally {
      controllers.current.delete(controller);
      if (!controller.signal.aborted && epoch.current === generation) setLoading(false);
    }
  }, [applySeed, retire]);

  const expandMore = useCallback(async (personId: number) => {
    if (!active.current || !tokenRef.current || !Number.isSafeInteger(personId) || personId <= 0) return;
    const generation = epoch.current;
    setAvailability(null);
    expansions.current.get(personId)?.abort();
    const controller = new AbortController();
    expansions.current.set(personId, controller); controllers.current.add(controller);
    try {
      const { data, error: err } = await api.get<ExpandResponse>(expandUrl(personId, tokenRef.current, roleMaskRef.current), { signal: controller.signal });
      if (controller.signal.aborted || epoch.current !== generation) return;
      if (err || !data) { setAvailability({ generation: tokenRef.current!.generation, focusId: personId, status: 'source-unavailable', detail: 'Collaborator source is unavailable. Please retry.' }); return; }
      setCreditSource(data.creditSource ?? null);
      setGraph(prev => boundField(mergeSubgraph(prev, data.subgraph), anchors()));
    } catch {
      if (!controller.signal.aborted && epoch.current === generation) setAvailability({ generation: tokenRef.current!.generation, focusId: personId, status: 'source-unavailable', detail: 'Collaborator source is unavailable. Please retry.' });
    } finally {
      controllers.current.delete(controller);
      if (expansions.current.get(personId) === controller) expansions.current.delete(personId);
    }
  }, [anchors]);

  const onStatus = useCallback((payload: ExpansionStatus) => {
    if (!active.current || tokenRef.current?.generation !== payload.generation) return;
    setAvailability(payload);
  }, []);
  const onFrame = useCallback((payload: StreamPayload) => {
    if (!active.current || tokenRef.current?.generation !== payload.generation) return;
    if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return;
    setGraph(prev => boundField(mergeSubgraph(prev, { focusId: Number(payload.focusId), nodes: payload.nodes as GraphNode[], edges: payload.edges as GraphEdge[] }), anchors()));
    setAvailability(previous => previous?.focusId === payload.focusId ? null : previous);
  }, [anchors]);

  return { creditSource, availability, onFrame, onStatus, nodes: graph.nodes, edges: graph.edges, focusId, streamToken, loading, error, recenter, expandMore };
}
