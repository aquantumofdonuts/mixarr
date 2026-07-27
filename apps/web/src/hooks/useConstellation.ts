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

  // Latest stream token in a ref so `recenter` / `expandMore` read the current
  // value without being torn down and recreated on every token change.
  const tokenRef = useRef<StreamToken | null>(null);
  useEffect(() => {
    tokenRef.current = streamToken;
  }, [streamToken]);

  // Latest roleMask in a ref so `recenter` / `expandMore` apply the current
  // server-side filter without being recreated on every mask change.
  const roleMaskRef = useRef<number | undefined>(roleMask);
  useEffect(() => {
    roleMaskRef.current = roleMask;
  }, [roleMask]);

  // Tracks unmount so imperative callbacks (`recenter` / `expandMore`) don't
  // setState after the component is gone.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  /** Apply a fresh seed/re-center response, replacing the graph. */
  const applySeed = useCallback((data: SeedResponse) => {
    setFocusId(data.focusId);
    setGraph({ nodes: data.subgraph.nodes, edges: data.subgraph.edges });
    setStreamToken(data.streamToken);
  }, []);

  // Key the seed effect on the stable primitive fields of `seed` rather than the
  // object identity — callers routinely pass an inline `{ type, id }` literal
  // that changes identity every render, and re-fetching on identity would loop.
  const seedType = seed?.type ?? null;
  const seedId = seed?.id ?? null;

  // Initial seed / re-seed whenever the seed prop changes.
  useEffect(() => {
    if (seedType === null || seedId === null) {
      setGraph({ nodes: [], edges: [] });
      setFocusId(null);
      setStreamToken(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .get<SeedResponse>(seedUrl(seedId, undefined, roleMask))
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data) {
          setError(err ?? 'Failed to load constellation');
          return;
        }
        applySeed(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // roleMask is a dependency: changing the server-side role filter must re-seed
    // so the backend re-computes the filtered subgraph.
  }, [seedType, seedId, roleMask, applySeed]);

  /**
   * Re-center on `personId`: re-seed with the current token id so the backend
   * bumps that token's generation, then replace the graph and stream token.
   */
  const recenter = useCallback(
    async (personId: number) => {
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await api.get<SeedResponse>(
          seedUrl(String(personId), tokenRef.current?.id, roleMaskRef.current),
        );
        // Bail if the hook unmounted mid-request — no setState after unmount.
        if (unmountedRef.current) return;
        if (err || !data) {
          setError(err ?? 'Failed to re-center constellation');
          return;
        }
        applySeed(data);
      } finally {
        if (!unmountedRef.current) setLoading(false);
      }
    },
    [applySeed],
  );

  /**
   * Expand `personId`: fetch its cached neighbourhood and merge it into the
   * current graph (dedupe by personId / source->target). Does not touch the
   * focus or stream token.
   */
  const expandMore = useCallback(async (personId: number) => {
    const { data, error: err } = await api.get<ExpandResponse>(
      expandUrl(personId, tokenRef.current, roleMaskRef.current),
    );
    if (unmountedRef.current) return;
    if (err || !data) {
      setError(err ?? 'Failed to expand node');
      return;
    }
    const incoming = data.subgraph;
    setGraph((prev) => mergeSubgraph(prev, incoming));
  }, []);

  return {
    nodes: graph.nodes,
    edges: graph.edges,
    focusId,
    streamToken,
    loading,
    error,
    recenter,
    expandMore,
  };
}
