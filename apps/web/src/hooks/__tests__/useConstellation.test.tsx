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
  boundField, MAX_FIELD_NODES, ANCHOR_BREADCRUMBS,
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
    expect(api.get).toHaveBeenCalledWith('/api/constellation/seed?type=artist&id=10', { signal: expect.any(AbortSignal) });
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
      '/api/constellation/seed?type=artist&id=20&token=tok-1', { signal: expect.any(AbortSignal) },
    );
    expect(result.current.focusId).toBe(20);
    // Re-center preserves the known original seed anchor.
    expect(result.current.nodes.map((n) => n.personId).sort()).toEqual([10, 20, 21]);
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
      '/api/constellation/expand/11?token=tok-1&generation=3', { signal: expect.any(AbortSignal) },
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

  it('includes the roleMask in the seed request when provided', async () => {
    const resp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10)], []),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    vi.mocked(api.get).mockResolvedValue(ok(resp));

    const { result } = renderHook(() =>
      useConstellation({ type: 'artist', id: '10' }, { roleMask: 6 }),
    );

    await waitFor(() => expect(result.current.focusId).toBe(10));
    expect(api.get).toHaveBeenCalledWith('/api/constellation/seed?type=artist&id=10&roleMask=6', { signal: expect.any(AbortSignal) });
  });

  it('omits roleMask from the seed request when undefined (all roles)', async () => {
    const resp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10)], []),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    vi.mocked(api.get).mockResolvedValue(ok(resp));

    const { result } = renderHook(() => useConstellation({ type: 'artist', id: '10' }));

    await waitFor(() => expect(result.current.focusId).toBe(10));
    expect(api.get).toHaveBeenCalledWith('/api/constellation/seed?type=artist&id=10', { signal: expect.any(AbortSignal) });
  });

  it('re-seeds when the roleMask changes', async () => {
    const resp: SeedResponse = {
      focusId: 10,
      subgraph: subgraph(10, [node(10)], []),
      streamToken: { id: 'tok-1', generation: 1 },
    };
    vi.mocked(api.get).mockResolvedValue(ok(resp));

    const { result, rerender } = renderHook(
      ({ mask }: { mask?: number }) =>
        useConstellation({ type: 'artist', id: '10' }, { roleMask: mask }),
      { initialProps: { mask: undefined as number | undefined } },
    );
    await waitFor(() => expect(result.current.focusId).toBe(10));
    expect(api.get).toHaveBeenLastCalledWith('/api/constellation/seed?type=artist&id=10', { signal: expect.any(AbortSignal) });

    rerender({ mask: 3 });
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith('/api/constellation/seed?type=artist&id=10&roleMask=3', { signal: expect.any(AbortSignal) }),
    );
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

describe('request retirement', () => {
  beforeEach(() => vi.resetAllMocks());
  const response = (id: number) => ok({ focusId: id, subgraph: subgraph(id, [node(id)], []), streamToken: { id: `token-${id}`, generation: 1 } });
  it('aborts rapid seed changes and ignores old seed/finally while latest is loading', async () => {
    const pending: Array<(value: any) => void> = [];
    vi.mocked(api.get).mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const { result, rerender } = renderHook(({ id }) => useConstellation({ type: 'artist', id }), { initialProps: { id: '1' } });
    const firstSignal = vi.mocked(api.get).mock.calls[0][1]!.signal!;
    rerender({ id: '2' }); expect(firstSignal.aborted).toBe(true);
    await act(async () => pending[0](response(1)));
    expect(result.current.focusId).toBeNull(); expect(result.current.loading).toBe(true);
    await act(async () => pending[1](response(2))); expect(result.current.focusId).toBe(2); expect(result.current.loading).toBe(false);
  });
  it.each(['seed', 'role', 'actor', 'recenter'] as const)('cannot merge an old expansion after %s changes', async kind => {
    let complete!: (value: any) => void;
    vi.mocked(api.get).mockImplementation(async url => url.includes('/expand/') ? await new Promise(resolve => { complete = resolve; }) : response(url.includes('id=2') ? 2 : 1));
    const { result, rerender } = renderHook(({ id, mask, actor }) => useConstellation({ type: 'artist', id }, { roleMask: mask, actorId: actor }), { initialProps: { id: '1', mask: undefined as number | undefined, actor: 7 } });
    await waitFor(() => expect(result.current.focusId).toBe(1));
    let expansion!: Promise<void>; act(() => { expansion = result.current.expandMore(9); });
    const signal = vi.mocked(api.get).mock.calls.find(([url]) => url.includes('/expand/'))![1]!.signal!;
    if (kind === 'recenter') await act(async () => { await result.current.recenter(2); });
    else rerender({ id: kind === 'seed' ? '2' : '1', mask: kind === 'role' ? 2 : undefined, actor: kind === 'actor' ? 8 : 7 });
    expect(signal.aborted).toBe(true);
    await act(async () => { complete(ok({ subgraph: subgraph(9, [node(99)], []) })); await expansion; });
    expect(result.current.nodes.some(person => person.personId === 99)).toBe(false);
  });
  it('clears pending/loading state for a null seed and consumes cancellation rejections', async () => {
    vi.mocked(api.get).mockImplementation((_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(options!.signal!.reason))));
    const { result, rerender, unmount } = renderHook(({ seed }) => useConstellation(seed), { initialProps: { seed: { type: 'artist', id: '1' } as import('../useConstellation').ConstellationSeed } });
    expect(result.current.loading).toBe(true); rerender({ seed: null });
    await waitFor(() => expect(result.current.loading).toBe(false)); expect(result.current.error).toBeNull(); unmount();
  });
});

describe('bounded wander field', () => {
  it('uses actual merge order, prioritizes anchor neighbours, and caps protected overflow', () => {
    expect(MAX_FIELD_NODES).toBe(300); expect(ANCHOR_BREADCRUMBS).toBe(5);
    const ids = [900, 800, 700, ...Array.from({ length: 300 }, (_, i) => i + 1)];
    const bounded = boundField({ nodes: ids.map(id => node(id)), edges: [edge(900, 800), edge(700, 1)] }, [900, 700]);
    expect(bounded.nodes).toHaveLength(300); expect(bounded.nodes.map(n => n.personId)).toContain(800);
    expect(bounded.nodes.map(n => n.personId)).not.toContain(2); expect(bounded.nodes.map(n => n.personId)).not.toContain(3);
    const overflow = boundField({ nodes: [node(900), ...Array.from({ length: 300 }, (_, i) => node(i + 1))], edges: Array.from({ length: 300 }, (_, i) => edge(900, i + 1)) }, [900]);
    expect(overflow.nodes).toHaveLength(300); expect(overflow.nodes[0].personId).toBe(900);
    expect(overflow.nodes.some(n => n.personId === 1)).toBe(false); expect(overflow.edges).toHaveLength(299);
  });
  it('bounds repeated HTTP and SSE merges, retains walking anchors, and reexpands pruned breadcrumbs', async () => {
    const seedResponse = { focusId: 900, creditSource: 'index', streamToken: { id: 't', generation: 1 }, subgraph: subgraph(900, [node(900), node(800)], [edge(900, 800)]) };
    vi.mocked(api.get).mockImplementation(async endpoint => endpoint.includes('/seed') ? ok(seedResponse) : ok({ personId: 800, creditSource: 'live', enqueued: true, subgraph: subgraph(800, [node(800), node(700)], [edge(800, 700)]) }));
    const { result, rerender } = renderHook(({ walkingFocus, breadcrumbIds }) => useConstellation({ type: 'artist', id: '900' }, { walkingFocus, breadcrumbIds }), { initialProps: { walkingFocus: 800, breadcrumbIds: [11, 12, 13, 14, 15, 16] } });
    await waitFor(() => expect(result.current.focusId).toBe(900));
    act(() => { result.current.onFrame({ generation: 1, focusId: 800, nodes: [11,12,13,14,15,16].map(id => node(id)), edges: [] }); });
    for (let batch = 0; batch < 5; batch++) {
      act(() => result.current.onFrame({ generation: 1, focusId: 800, nodes: Array.from({ length: 100 }, (_, i) => node(1000 + batch * 100 + i)), edges: [] }));
      expect(result.current.nodes.length).toBeLessThanOrEqual(300);
    }
    const ids = result.current.nodes.map(n => n.personId);
    for (const id of [900,800,12,13,14,15,16]) expect(ids).toContain(id);
    expect(ids).not.toContain(11);
    rerender({ walkingFocus: 11, breadcrumbIds: [11,12,13,14,15,16,11] });
    vi.mocked(api.get).mockResolvedValueOnce(ok({ personId: 11, creditSource: 'live', enqueued: true, subgraph: subgraph(11, [node(11), node(6000)], [edge(11, 6000)]) }));
    await act(async () => { await result.current.expandMore(11); });
    expect(result.current.nodes.map(n => n.personId)).toContain(11); expect(result.current.nodes.length).toBe(300); expect(result.current.creditSource).toBe('live');
    act(() => result.current.onStatus({ generation: 1, focusId: 11, status: 'source-unavailable' }));
    const before = result.current.nodes;
    expect(result.current.availability?.status).toBe('source-unavailable'); expect(result.current.nodes).toBe(before);
    await act(async () => { await result.current.expandMore(11); });
    expect(result.current.availability).toBeNull();
    expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.includes('/expand/11'))).toHaveLength(2);
  });
});

it('preserves known mandatory identities on role and recenter responses without fabricating unresolved anchors', async () => {
  vi.mocked(api.get).mockResolvedValueOnce(ok({ focusId: 900, creditSource: 'index', streamToken: { id: 't', generation: 1 }, subgraph: subgraph(900, [900,800,700,600,500,400,300,200].map(id => node(id)), []) }));
  const { result, rerender } = renderHook(({ roleMask }) => useConstellation({ type: 'artist', id: '900' }, { roleMask, walkingFocus: 800, breadcrumbIds: [700,600,500,400,300,999] }), { initialProps: { roleMask: undefined as number | undefined } });
  await waitFor(() => expect(result.current.focusId).toBe(900));
  vi.mocked(api.get).mockResolvedValueOnce(ok({ focusId: 900, creditSource: 'index', streamToken: { id: 't2', generation: 1 }, subgraph: subgraph(900, [node(900)], []) }));
  rerender({ roleMask: 2 }); await waitFor(() => expect(result.current.streamToken?.id).toBe('t2'));
  expect(result.current.nodes.map(n => n.personId)).toEqual([900,800,600,500,400,300]);
  vi.mocked(api.get).mockResolvedValueOnce(ok({ focusId: 100, creditSource: 'index', streamToken: { id: 't2', generation: 2 }, subgraph: subgraph(100, [node(100)], []) }));
  await act(async () => { await result.current.recenter(100); });
  expect(result.current.nodes.map(n => n.personId)).toEqual([900,800,600,500,400,300,100]);
  expect(result.current.nodes.some(n => n.personId === 999)).toBe(false);
});
