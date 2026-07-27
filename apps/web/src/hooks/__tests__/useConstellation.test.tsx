import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn() },
}));

import { api } from '@/lib/api';
import {
  useConstellation,
  mergeNodes,
  mergeEdges,
  mergeSubgraph,
  edgeKey,
} from '../useConstellation';
import type { GraphNode, GraphEdge, Subgraph, SeedResponse, ExpandResponse } from '@/types/constellation';

const node = (personId: number, over: Partial<GraphNode> = {}): GraphNode => ({
  personId,
  displayName: `P${personId}`,
  genre: null,
  size: 1,
  owned: false,
  ...over,
});

const edge = (source: number, target: number, over: Partial<GraphEdge> = {}): GraphEdge => ({
  source,
  target,
  weight: 1,
  bridge: null,
  bridgeConfident: false,
  roleBitmask: 0,
  ...over,
});

const subgraph = (focusId: number, nodes: GraphNode[], edges: GraphEdge[]): Subgraph => ({
  focusId,
  nodes,
  edges,
});

function ok<T>(data: T) {
  return { data, error: null, status: 200 };
}

// ─── Pure helpers ────────────────────────────────────────────────────

describe('merge/dedupe helpers', () => {
  it('edgeKey is source->target', () => {
    expect(edgeKey(edge(1, 2))).toBe('1->2');
  });

  it('mergeNodes dedupes by personId (incoming wins)', () => {
    const merged = mergeNodes(
      [node(1, { displayName: 'old' }), node(2)],
      [node(1, { displayName: 'new' }), node(3)],
    );
    expect(merged.map((n) => n.personId).sort()).toEqual([1, 2, 3]);
    expect(merged.find((n) => n.personId === 1)?.displayName).toBe('new');
  });

  it('mergeEdges dedupes by source->target and keeps direction distinct', () => {
    const merged = mergeEdges([edge(1, 2), edge(2, 3)], [edge(1, 2), edge(2, 1)]);
    const keys = merged.map(edgeKey).sort();
    expect(keys).toEqual(['1->2', '2->1', '2->3']);
  });

  it('mergeSubgraph merges both nodes and edges', () => {
    const merged = mergeSubgraph(
      { nodes: [node(1)], edges: [edge(1, 2)] },
      subgraph(1, [node(2)], [edge(2, 3)]),
    );
    expect(merged.nodes.map((n) => n.personId).sort()).toEqual([1, 2]);
    expect(merged.edges.map(edgeKey).sort()).toEqual(['1->2', '2->3']);
  });
});

// ─── Hook behaviour ──────────────────────────────────────────────────

describe('useConstellation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('seeds from the artist id on mount', async () => {
    const resp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10), node(11)], [edge(10, 11)]),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    vi.mocked(api.get).mockResolvedValue(ok(resp));

    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));

    await waitFor(() => expect(result.current.focusId).toBe(10));
    expect(api.get).toHaveBeenCalledWith('/api/constellation/seed?type=artist&id=10');
    expect(result.current.nodes).toHaveLength(2);
    expect(result.current.streamToken).toEqual({ id: 'tok-1', generation: 1 });
  });

  it('recenter re-seeds with the current token id to bump the generation', async () => {
    const seedResp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10)], []),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    const recenterResp: SeedResponse = {
      focusId: 20,
      subgraph: subgraph(20, [node(20), node(21)], [edge(20, 21)]),
      streamToken: { id: 'tok-1', generation: 2 },
    };
    vi.mocked(api.get).mockImplementation(async (endpoint: string) =>
      endpoint.includes('token=tok-1') ? ok(recenterResp) : ok(seedResp),
    );

    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));
    await waitFor(() => expect(result.current.focusId).toBe(10));

    await act(async () => {
      await result.current.recenter(20);
    });

    expect(api.get).toHaveBeenLastCalledWith(
      '/api/constellation/seed?type=artist&id=20&token=tok-1',
    );
    expect(result.current.focusId).toBe(20);
    // Graph is REPLACED, not merged.
    expect(result.current.nodes.map((n) => n.personId).sort()).toEqual([20, 21]);
    expect(result.current.streamToken).toEqual({ id: 'tok-1', generation: 2 });
  });

  it('expandMore calls /expand with token+generation and MERGES the result', async () => {
    const seedResp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10), node(11)], [edge(10, 11)]),
      streamToken: { id: 'tok-1', generation: 3 },
    };
    const expandResp: ExpandResponse = {
      personId: 11,
      enqueued: true,
      // Overlaps node 11 + edge 10->11 (must dedupe), adds 12 + 11->12.
      subgraph: subgraph(11, [node(11), node(12)], [edge(10, 11), edge(11, 12)]),
    };
    vi.mocked(api.get).mockImplementation(async (endpoint: string) =>
      endpoint.startsWith('/api/constellation/expand') ? ok(expandResp) : ok(seedResp),
    );

    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));
    await waitFor(() => expect(result.current.focusId).toBe(10));

    await act(async () => {
      await result.current.expandMore(11);
    });

    expect(api.get).toHaveBeenLastCalledWith(
      '/api/constellation/expand/11?token=tok-1&generation=3',
    );
    // Merged + deduped: nodes {10,11,12}, edges {10->11, 11->12}.
    expect(result.current.nodes.map((n) => n.personId).sort()).toEqual([10, 11, 12]);
    expect(result.current.edges.map(edgeKey).sort()).toEqual(['10->11', '11->12']);
    // Focus + token unchanged by expand.
    expect(result.current.focusId).toBe(10);
    expect(result.current.streamToken).toEqual({ id: 'tok-1', generation: 3 });
  });

  it('expandMore merge keeps the NEWER data for an existing node', async () => {
    const seedResp: SeedResponse = {
      focusId: 10,
      // Node 11 seeded as NOT owned.
      subgraph: subgraph(10, [node(10), node(11, { owned: false })], [edge(10, 11)]),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    const expandResp: ExpandResponse = {
      personId: 11,
      enqueued: true,
      // Same personId 11 but now owned = true (fresher data must win).
      subgraph: subgraph(11, [node(11, { owned: true })], []),
    };
    vi.mocked(api.get).mockImplementation(async (endpoint: string) =>
      endpoint.startsWith('/api/constellation/expand') ? ok(expandResp) : ok(seedResp),
    );

    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));
    await waitFor(() => expect(result.current.focusId).toBe(10));
    expect(result.current.nodes.find((n) => n.personId === 11)?.owned).toBe(false);

    await act(async () => {
      await result.current.expandMore(11);
    });

    // No duplicate node, and the merged node carries the newer owned=true.
    expect(result.current.nodes.filter((n) => n.personId === 11)).toHaveLength(1);
    expect(result.current.nodes.find((n) => n.personId === 11)?.owned).toBe(true);
  });

  it('surfaces an error when seeding fails', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: null, error: 'boom', status: 500 });
    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('is idle with a null seed', async () => {
    const { result } = renderHook(() => useConstellation(null));
    expect(result.current.focusId).toBeNull();
    expect(result.current.nodes).toHaveLength(0);
    expect(api.get).not.toHaveBeenCalled();
  });
});
