import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Prisma (source imports from '../../lib/db.js' -> src/lib/db.js).
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    constellationEdge: { findMany: vi.fn(), updateMany: vi.fn() },
    constellationPerson: { findMany: vi.fn() },
    constellationGenre: { findMany: vi.fn() },
    constellationOwned: { findMany: vi.fn() },
  },
}));

// Mock the logger so budget-exhaustion warnings are observable (and silent).
vi.mock('../../../src/lib/logger.js', () => {
  const warn = vi.fn();
  return { createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn, error: vi.fn() }) };
});

import prisma from '../../../src/lib/db.js';
import { createLogger } from '../../../src/lib/logger.js';
import { GraphService } from '../../../src/services/constellation/GraphService.js';

type EdgeRow = {
  sourcePersonId: number;
  targetPersonId: number;
  weight: number;
  bridge: number | null;
  bridgeConfident: boolean;
  roleBitmask: number;
};
type PersonRow = { personId: number; displayName: string; fullyExpanded: boolean };
type GenreRow = { personId: number; genre: string; weight: number };
type OwnedRow = { userId: number; personId: number; source: string };

interface Store {
  edges: EdgeRow[];
  persons: PersonRow[];
  genres: GenreRow[];
  owned: OwnedRow[];
}

/** True if a scalar `where` field (number or {in:[...]}) matches `val`. */
function fieldMatch(field: any, val: number): boolean {
  if (field && typeof field === 'object' && Array.isArray(field.in)) return field.in.includes(val);
  return field === val;
}

/** Wire the mocked prisma delegates to an in-memory store. */
function installStore(store: Store): void {
  vi.mocked(prisma.constellationEdge.findMany).mockImplementation((async ({ where }: any) =>
    store.edges
      .filter((e) => where?.sourcePersonId === undefined || fieldMatch(where.sourcePersonId, e.sourcePersonId))
      .map((e) => ({ ...e }))) as any);

  vi.mocked(prisma.constellationPerson.findMany).mockImplementation((async ({ where }: any) =>
    store.persons.filter((p) => fieldMatch(where.personId, p.personId)).map((p) => ({ ...p }))) as any);

  vi.mocked(prisma.constellationGenre.findMany).mockImplementation((async ({ where }: any) =>
    store.genres.filter((g) => fieldMatch(where.personId, g.personId)).map((g) => ({ ...g }))) as any);

  vi.mocked(prisma.constellationOwned.findMany).mockImplementation((async ({ where }: any) =>
    store.owned
      .filter((o) => o.userId === where.userId && fieldMatch(where.personId, o.personId))
      .map((o) => ({ ...o }))) as any);

  vi.mocked(prisma.constellationEdge.updateMany).mockResolvedValue({ count: 0 } as any);
}

const edge = (s: number, t: number, w: number, roleBitmask = 1): EdgeRow => ({
  sourcePersonId: s,
  targetPersonId: t,
  weight: w,
  bridge: null,
  bridgeConfident: false,
  roleBitmask,
});
const person = (id: number, fullyExpanded = false): PersonRow => ({
  personId: id,
  displayName: `P${id}`,
  fullyExpanded,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GraphService.subgraph', () => {
  it('builds focus + ring-1 (top-N) + pruned ring-2, excluding in-graph dupes', async () => {
    const store: Store = {
      // focus 1 -> 2(5), 3(3), 4(1); topN=2 keeps the two heaviest {2,3}.
      edges: [
        edge(1, 2, 5), edge(1, 3, 3), edge(1, 4, 1),
        // node 2's heaviest points back to in-graph node 3 -> must be skipped; 10 is added.
        edge(2, 3, 9), edge(2, 10, 4),
        // node 3's heaviest points to in-graph node 2 -> skipped; 20 is added.
        edge(3, 2, 8), edge(3, 20, 4),
      ],
      persons: [1, 2, 3, 4, 10, 20].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    const res = await new GraphService().subgraph(1, { topN: 2 });

    expect(res.focusId).toBe(1);
    expect(res.nodes.map((n) => n.personId).sort((a, b) => a - b)).toEqual([1, 2, 3, 10, 20]);
    // node 4 was outside top-N; excluded.
    expect(res.nodes.some((n) => n.personId === 4)).toBe(false);
    // Edges: the two ring-1 edges + one ring-2 edge per ring-1 node.
    const keys = res.edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(keys).toEqual(['1->2', '1->3', '2->10', '3->20']);
    // The 2->3 / 3->2 edges toward in-graph nodes are NOT re-added as ring-2 edges.
    expect(keys).not.toContain('2->3');
    expect(keys).not.toContain('3->2');
  });

  it('applies the role mask JS-side: non-matching-role edges are excluded from both rings', async () => {
    const PERF = 1; // performer bit
    const PROD = 2; // producer bit
    const store: Store = {
      edges: [
        edge(5, 6, 5, PERF), edge(5, 7, 4, PROD),
        edge(6, 8, 3, PERF), edge(6, 9, 2, PROD),
      ],
      persons: [5, 6, 7, 8, 9].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    const res = await new GraphService().subgraph(5, { roleMask: PERF, topN: 4 });

    const ids = res.nodes.map((n) => n.personId).sort((a, b) => a - b);
    expect(ids).toEqual([5, 6, 8]); // 7 (producer, ring-1) and 9 (producer, ring-2) filtered out
    expect(res.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(['5->6', '6->8']);
  });

  it('sets dominant genre and size = credit prominence (sum of outgoing weights)', async () => {
    const store: Store = {
      edges: [
        edge(1, 2, 5),
        edge(2, 10, 4), edge(2, 11, 2), // node 2 outgoing sums to 6
      ],
      persons: [1, 2, 10, 11].map((id) => person(id)),
      genres: [
        { personId: 2, genre: 'rock', weight: 3 },
        { personId: 2, genre: 'jazz', weight: 1 },
      ],
      owned: [],
    };
    installStore(store);

    const res = await new GraphService().subgraph(1, {});
    const n2 = res.nodes.find((n) => n.personId === 2)!;
    expect(n2.genre).toBe('rock');
    expect(n2.size).toBe(6);
  });

  it('uses max(credit prominence, popularity) when a popularity seam is injected', async () => {
    const store: Store = {
      edges: [edge(1, 2, 5), edge(2, 10, 4), edge(2, 11, 2)],
      persons: [1, 2, 10, 11].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    const getPopularity = vi.fn(async (id: number) => (id === 2 ? 100 : 0));
    const res = await new GraphService({ getPopularity }).subgraph(1, {});
    const n2 = res.nodes.find((n) => n.personId === 2)!;
    expect(n2.size).toBe(100); // max(6, 100)
    expect(getPopularity).toHaveBeenCalledWith(2);
  });

  it('marks owned only when a ConstellationOwned row exists for the given user', async () => {
    const store: Store = {
      edges: [edge(1, 2, 5)],
      persons: [1, 2].map((id) => person(id)),
      genres: [],
      owned: [{ userId: 42, personId: 2, source: 'lidarr' }],
    };
    installStore(store);

    const withUser = await new GraphService().subgraph(1, { userId: 42 });
    expect(withUser.nodes.find((n) => n.personId === 2)!.owned).toBe(true);
    expect(withUser.nodes.find((n) => n.personId === 1)!.owned).toBe(false);

    const noUser = await new GraphService().subgraph(1, {});
    expect(noUser.nodes.every((n) => n.owned === false)).toBe(true);
  });

  it('DANGLING-EDGE INVARIANT: every edge source & target is a present node (incl. maxNodes trim)', async () => {
    const store: Store = {
      edges: [
        edge(1, 2, 5), edge(1, 3, 4),
        edge(2, 10, 3), edge(2, 11, 2),
        edge(3, 20, 3), edge(3, 21, 2),
      ],
      persons: [1, 2, 3, 10, 11, 20, 21].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    // maxNodes 4 trims ring-2 to a single node -> edges must not reference trimmed nodes.
    const res = await new GraphService().subgraph(1, { topN: 2, maxNodes: 4 });
    const nodeIds = new Set(res.nodes.map((n) => n.personId));
    for (const e of res.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });

  it('EMPTY FOCUS: focus with no outgoing edges -> just the focus node, no edges, no throw', async () => {
    const store: Store = {
      edges: [],
      persons: [person(1)],
      genres: [],
      owned: [],
    };
    installStore(store);

    const res = await new GraphService().subgraph(1, {});
    expect(res.nodes.map((n) => n.personId)).toEqual([1]);
    expect(res.edges).toEqual([]);
  });

  it('NONEXISTENT FOCUS: no ConstellationPerson row -> focus node with empty displayName, no throw', async () => {
    const store: Store = {
      edges: [],
      persons: [],
      genres: [],
      owned: [],
    };
    installStore(store);

    const res = await new GraphService().subgraph(999, {});
    expect(res.nodes).toHaveLength(1);
    expect(res.nodes[0]).toMatchObject({ personId: 999, displayName: '', genre: null, owned: false });
    expect(res.edges).toEqual([]);
  });

  it('roleMask=0 excludes all edges (focus only), distinct from roleMask=undefined (full ring-1)', async () => {
    const store: Store = {
      edges: [edge(1, 2, 5, 1), edge(1, 3, 4, 2)],
      persons: [1, 2, 3].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    const masked = await new GraphService().subgraph(1, { roleMask: 0 });
    expect(masked.nodes.map((n) => n.personId)).toEqual([1]);
    expect(masked.edges).toEqual([]);

    const unfiltered = await new GraphService().subgraph(1, {});
    expect(unfiltered.nodes.map((n) => n.personId).sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('caps total nodes at maxNodes, stopping ring-2 growth', async () => {
    const store: Store = {
      edges: [
        edge(1, 2, 5), edge(1, 3, 4),
        edge(2, 10, 3),
        edge(3, 20, 3),
      ],
      persons: [1, 2, 3, 10, 20].map((id) => person(id)),
      genres: [],
      owned: [],
    };
    installStore(store);

    // focus(1) + ring-1(2,3) = 3; maxNodes 4 leaves room for exactly one ring-2 node.
    const res = await new GraphService().subgraph(1, { topN: 2, maxNodes: 4 });
    expect(res.nodes).toHaveLength(4);
    const ids = res.nodes.map((n) => n.personId);
    expect(ids).toContain(10);
    expect(ids).not.toContain(20);
  });
});

describe('GraphService.path', () => {
  type NbEdge = { target: number; bridge?: number | null; weight?: number };
  type Adj = Record<number, NbEdge[]>;

  /** Build an injectable getNeighbors seam from an adjacency map (no Prisma). */
  function fakeNeighbors(adj: Adj) {
    return vi.fn(async (id: number) =>
      (adj[id] ?? []).map((e) => ({
        target: e.target,
        bridge: e.bridge ?? null,
        weight: e.weight ?? 1,
      })));
  }

  it('shortest: returns a reachable 3-hop path with degrees 3, mode shortest', async () => {
    const getNeighbors = fakeNeighbors({ 1: [{ target: 2 }], 2: [{ target: 3 }], 3: [{ target: 4 }] });
    const res = await new GraphService({ getNeighbors }).path(1, 4, { mode: 'shortest' });
    expect(res).toEqual({ nodes: [1, 2, 3, 4], degrees: 3, mode: 'shortest' });
  });

  it('shortest: bails to null when the target is only reachable past max', async () => {
    // Linear chain 1->2->3->4->5->6 (5 hops); max=3 must NOT reach 6.
    const getNeighbors = fakeNeighbors({
      1: [{ target: 2 }], 2: [{ target: 3 }], 3: [{ target: 4 }], 4: [{ target: 5 }], 5: [{ target: 6 }],
    });
    const res = await new GraphService({ getNeighbors }).path(1, 6, { mode: 'shortest', max: 3 });
    expect(res).toBeNull();
    // must NOT have traversed the whole chain: 4 and 5 are never expanded within 3 hops.
    const expanded = getNeighbors.mock.calls.map((c) => c[0]);
    expect(expanded).not.toContain(5);
  });

  it('shortest: routes through a hub (2-hop) rather than the longer non-hub path', async () => {
    const getNeighbors = fakeNeighbors({
      1: [{ target: 99 }, { target: 2 }],
      99: [{ target: 5 }], // hub: 1->99->5 = 2 hops
      2: [{ target: 3 }], 3: [{ target: 4 }], 4: [{ target: 5 }], // long path: 1->2->3->4->5 = 4 hops
    });
    const res = await new GraphService({ getNeighbors }).path(1, 5, { mode: 'shortest' });
    expect(res).toEqual({ nodes: [1, 99, 5], degrees: 2, mode: 'shortest' });
  });

  it('interesting: prefers the LONGER high-bridge chain over the short low-bridge hub route', async () => {
    const adj: Adj = {
      // Short, boring hub route: 1->9->5, cumulative bridge 0.
      1: [{ target: 9, bridge: 0 }, { target: 2, bridge: 0.9 }],
      9: [{ target: 5, bridge: 0 }],
      // Longer boundary-crossing chain: 1->2->3->4->5, cumulative bridge 3.6.
      2: [{ target: 3, bridge: 0.9 }],
      3: [{ target: 4, bridge: 0.9 }],
      4: [{ target: 5, bridge: 0.9 }],
    };
    const interesting = await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 5, {
      mode: 'interesting',
    });
    expect(interesting).not.toBeNull();
    expect(interesting!.nodes).toEqual([1, 2, 3, 4, 5]);
    expect(interesting!.degrees).toBe(4);
    expect(interesting!.mode).toBe('interesting');
    expect(interesting!.totalBridge).toBeCloseTo(3.6, 10);

    // Same graph, shortest mode -> the boring 2-hop hub route with ~zero bridge.
    const shortest = await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 5, {
      mode: 'shortest',
    });
    expect(shortest).toEqual({ nodes: [1, 9, 5], degrees: 2, mode: 'shortest' });
    expect(interesting!.totalBridge!).toBeGreaterThan(0);
  });

  it('interesting: candidate budget bounds the search on a dense graph and still returns a valid path', async () => {
    // Fully-connected 7-clique: unbounded simple-path enumeration explodes.
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const adj: Adj = {};
    for (const a of ids) adj[a] = ids.filter((b) => b !== a).map((b) => ({ target: b, bridge: 0.1 }));
    const getNeighbors = fakeNeighbors(adj);

    const budget = 25;
    const res = await new GraphService({ getNeighbors }).path(1, 7, {
      mode: 'interesting',
      candidateBudget: budget,
    });

    // Budget respected: getNeighbors (= node expansions) never exceeds the budget.
    expect(getNeighbors.mock.calls.length).toBeLessThanOrEqual(budget);

    // Still returns a VALID simple from->to path within max+2 hops.
    expect(res).not.toBeNull();
    expect(res!.nodes[0]).toBe(1);
    expect(res!.nodes[res!.nodes.length - 1]).toBe(7);
    expect(res!.degrees).toBe(res!.nodes.length - 1);
    expect(res!.degrees).toBeLessThanOrEqual(6 + 2); // default max(6) + 2
    expect(new Set(res!.nodes).size).toBe(res!.nodes.length); // simple path, no repeats
  });

  it('returns null in both modes when from and to are disconnected', async () => {
    const adj: Adj = { 1: [{ target: 2 }], 2: [{ target: 1 }], 3: [{ target: 4 }] }; // {1,2} | {3,4}
    expect(await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 4, { mode: 'shortest' })).toBeNull();
    expect(await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 4, { mode: 'interesting' })).toBeNull();
  });

  it('from == to: degrees 0 in both modes with no getNeighbors expansion', async () => {
    const getNeighbors = fakeNeighbors({ 7: [{ target: 8 }] });
    const svc = new GraphService({ getNeighbors });

    const shortest = await svc.path(7, 7, { mode: 'shortest' });
    expect(shortest).toMatchObject({ nodes: [7], degrees: 0, mode: 'shortest' });

    const interesting = await svc.path(7, 7, { mode: 'interesting' });
    expect(interesting).toMatchObject({ nodes: [7], degrees: 0, mode: 'interesting' });

    expect(getNeighbors).not.toHaveBeenCalled();
  });

  it('interesting: depth cap is max+2 inclusive (returns a max+2 path)', async () => {
    // max=2 -> depth cap 4 hops. Only route 1->2->3->4->5 is exactly 4 hops.
    const getNeighbors = fakeNeighbors({
      1: [{ target: 2, bridge: 0.5 }], 2: [{ target: 3, bridge: 0.5 }],
      3: [{ target: 4, bridge: 0.5 }], 4: [{ target: 5, bridge: 0.5 }],
    });
    const res = await new GraphService({ getNeighbors }).path(1, 5, { mode: 'interesting', max: 2 });
    expect(res).not.toBeNull();
    expect(res!.nodes).toEqual([1, 2, 3, 4, 5]);
    expect(res!.degrees).toBe(4); // == max + 2
    expect(res!.totalBridge).toBeCloseTo(2.0, 10);
  });

  it('interesting: depth cap is max+3 exclusive (null when the only path is max+3)', async () => {
    // max=2 -> depth cap 4 hops. Only route 1->..->6 is 5 hops (max+3) -> unreachable.
    const getNeighbors = fakeNeighbors({
      1: [{ target: 2 }], 2: [{ target: 3 }], 3: [{ target: 4 }], 4: [{ target: 5 }], 5: [{ target: 6 }],
    });
    const res = await new GraphService({ getNeighbors }).path(1, 6, { mode: 'interesting', max: 2 });
    expect(res).toBeNull();
  });

  it('self-loop: a node edge to itself does not loop forever or produce a bogus path', async () => {
    // Node 2 has a self-loop; the real route is 1->2->3.
    const adj: Adj = { 1: [{ target: 2 }], 2: [{ target: 2 }, { target: 3 }] };
    const shortest = await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 3, { mode: 'shortest' });
    expect(shortest).toEqual({ nodes: [1, 2, 3], degrees: 2, mode: 'shortest' });

    const interesting = await new GraphService({ getNeighbors: fakeNeighbors(adj) }).path(1, 3, {
      mode: 'interesting',
    });
    expect(interesting!.nodes).toEqual([1, 2, 3]);
    expect(interesting!.degrees).toBe(2);
  });

  it('interesting: budget too small -> null AND a budget-exhaustion warning is logged', async () => {
    const warn = (createLogger('x') as unknown as { warn: ReturnType<typeof vi.fn> }).warn;
    warn.mockClear();

    // A real 1->2->3->4->5 path exists, but a budget of 1 expansion cannot reach it.
    const getNeighbors = fakeNeighbors({
      1: [{ target: 2 }], 2: [{ target: 3 }], 3: [{ target: 4 }], 4: [{ target: 5 }],
    });
    const res = await new GraphService({ getNeighbors }).path(1, 5, {
      mode: 'interesting',
      candidateBudget: 1,
    });
    expect(res).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/candidate budget/i);
  });
});

describe('GraphService.bridgeFill', () => {
  it('fills the bridge (both directions) when both endpoints are fully expanded', async () => {
    const store: Store = {
      edges: [
        edge(1, 2, 1), edge(2, 1, 1),
        edge(1, 3, 1), edge(1, 4, 1), // node 1 neighbors: {2,3,4}
        edge(2, 5, 1), edge(2, 6, 1), // node 2 neighbors: {1,5,6}  -> disjoint from 1's {3,4}
      ],
      persons: [person(1, true), person(2, true)],
      genres: [],
      owned: [],
    };
    installStore(store);

    await new GraphService().bridgeFill([{ source: 1, target: 2 }]);

    const upd = vi.mocked(prisma.constellationEdge.updateMany);
    expect(upd).toHaveBeenCalledTimes(1);
    const arg = upd.mock.calls[0][0] as any;
    expect(arg.where.OR).toEqual([
      { sourcePersonId: 1, targetPersonId: 2 },
      { sourcePersonId: 2, targetPersonId: 1 },
    ]);
    expect(arg.data.bridgeConfident).toBe(true);
    expect(arg.data.bridge).toBeCloseTo(1, 10); // disjoint neighbor sets -> Jaccard distance 1
  });

  it('dedupes symmetric input pairs into a single update', async () => {
    const store: Store = {
      edges: [edge(1, 3, 1), edge(2, 5, 1)],
      persons: [person(1, true), person(2, true)],
      genres: [],
      owned: [],
    };
    installStore(store);

    await new GraphService().bridgeFill([
      { source: 1, target: 2 },
      { source: 2, target: 1 },
    ]);
    expect(vi.mocked(prisma.constellationEdge.updateMany)).toHaveBeenCalledTimes(1);
  });

  it('only lowers confidence (no bridge) when an endpoint is not fully expanded', async () => {
    const store: Store = {
      edges: [edge(1, 3, 1), edge(2, 5, 1)],
      persons: [person(1, true), person(2, false)],
      genres: [],
      owned: [],
    };
    installStore(store);

    await new GraphService().bridgeFill([{ source: 1, target: 2 }]);

    const upd = vi.mocked(prisma.constellationEdge.updateMany);
    expect(upd).toHaveBeenCalledTimes(1);
    const arg = upd.mock.calls[0][0] as any;
    expect(arg.data.bridgeConfident).toBe(false);
    expect('bridge' in arg.data).toBe(false); // bridge left untouched / null
  });
});
