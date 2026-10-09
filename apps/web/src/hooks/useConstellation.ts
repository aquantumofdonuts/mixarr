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
}

export interface UseConstellationResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
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
    setFocusId(data.focusId);
    setGraph({ nodes: data.subgraph.nodes, edges: data.subgraph.edges });
    setStreamToken(data.streamToken);
  }, []);
  const seedType = seed?.type ?? null;
  const seedId = seed?.id ?? null;
  useEffect(() => {
    active.current = true;
    const generation = retire();
    tokenRef.current = null; setStreamToken(null);
    setGraph({ nodes: [], edges: [] }); setFocusId(null); setError(null); setLoading(false);
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
  }, [seedType, seedId, roleMask, options.actorId, applySeed, retire]);

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
    expansions.current.get(personId)?.abort();
    const controller = new AbortController();
    expansions.current.set(personId, controller); controllers.current.add(controller);
    try {
      const { data, error: err } = await api.get<ExpandResponse>(expandUrl(personId, tokenRef.current, roleMaskRef.current), { signal: controller.signal });
      if (controller.signal.aborted || epoch.current !== generation) return;
      if (err || !data) { setError(err ?? 'Failed to expand node'); return; }
      setGraph(prev => mergeSubgraph(prev, data.subgraph));
    } catch {
      if (!controller.signal.aborted && epoch.current === generation) setError('Failed to expand node');
    } finally {
      controllers.current.delete(controller);
      if (expansions.current.get(personId) === controller) expansions.current.delete(personId);
    }
  }, []);

  return { nodes: graph.nodes, edges: graph.edges, focusId, streamToken, loading, error, recenter, expandMore };
}
