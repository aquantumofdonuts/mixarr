import { describe, it, expect } from 'vitest';
import { OrbitCrawler, type OrbitDeps } from '../../../src/services/constellation/OrbitCrawler.js';

/**
 * Build fake seams over an explicit adjacency map. Any id NOT in the map expands
 * to zero neighbors / zero edges. `full` is the set treated as already-expanded.
 */
function fakeDeps(
  graph: Record<number, number[]>,
  full: Set<number> = new Set(),
): { deps: OrbitDeps; expandOrder: number[]; isFullCalls: number[] } {
  const expandOrder: number[] = [];
  const isFullCalls: number[] = [];
  const deps: OrbitDeps = {
    async expand(personId) {
      expandOrder.push(personId);
      const neighborIds = graph[personId] ?? [];
      return { neighborIds, edgesCreated: neighborIds.length };
    },
    async isFull(personId) {
      isFullCalls.push(personId);
      return full.has(personId);
    },
  };
  return { deps, expandOrder, isFullCalls };
}

describe('OrbitCrawler', () => {
  it('halts on an effectively-infinite small-world graph once the edge budget is spent', async () => {
    // For ANY person, expand() yields 5 fresh distinct neighbors (id*10+k) and 5 edges.
    // This graph never terminates on its own — only the budget can stop it.
    const infiniteDeps: OrbitDeps = {
      async expand(personId) {
        const neighborIds = [0, 1, 2, 3, 4].map((k) => personId * 10 + k);
        return { neighborIds, edgesCreated: 5 };
      },
      async isFull() {
        return false;
      },
    };
    const crawler = new OrbitCrawler(infiniteDeps);

    const result = await crawler.crawl([1], { maxEdges: 12 });

    // Terminates (this assertion would never be reached if it looped forever).
    expect(result.edgesMaterialized).toBeGreaterThanOrEqual(12);
    // Budget checked AFTER each expand -> may overshoot by one expand's worth (5).
    expect(result.edgesMaterialized).toBeLessThanOrEqual(12 + 5);
    // Only a handful of persons expanded (3 * 5 = 15 >= 12), NOT the whole universe.
    expect(result.personsExpanded).toBe(3);
  });

  it('expands breadth-first: all depth-0 seeds before any depth-1 neighbor', async () => {
    // seeds 1 and 2; their neighbors are the 100s / 200s.
    const { deps, expandOrder } = fakeDeps({
      1: [101, 102],
      2: [201, 202],
      101: [],
      102: [],
      201: [],
      202: [],
    });
    const crawler = new OrbitCrawler(deps);

    const result = await crawler.crawl([1, 2], { maxEdges: 1000 });

    // Both seeds appear before any neighbor.
    const firstNeighborIdx = expandOrder.findIndex((id) => id >= 100);
    const seedIdxs = [expandOrder.indexOf(1), expandOrder.indexOf(2)];
    for (const s of seedIdxs) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(firstNeighborIdx);
    }
    expect(expandOrder.slice(0, 2).sort()).toEqual([1, 2]);
    expect(result.personsExpanded).toBe(6);
  });

  it('skips an already-full person (idempotency): expand is never called for it', async () => {
    const { deps, expandOrder } = fakeDeps({ 1: [2], 2: [3], 3: [] }, new Set([2]));
    const crawler = new OrbitCrawler(deps);

    const result = await crawler.crawl([1], { maxEdges: 1000 });

    expect(expandOrder).toContain(1);
    expect(expandOrder).not.toContain(2);
    // 2 was skipped, so we never learned 2's neighbors -> 3 is never reached either.
    expect(expandOrder).not.toContain(3);
    expect(result.personsExpanded).toBe(1);
  });

  it('does zero work re-crawling a fully-settled orbit (all seeds full)', async () => {
    const { deps, expandOrder } = fakeDeps({ 1: [2], 2: [1] }, new Set([1, 2]));
    const crawler = new OrbitCrawler(deps);

    const result = await crawler.crawl([1, 2], { maxEdges: 1000 });

    expect(expandOrder).toEqual([]);
    expect(result.personsExpanded).toBe(0);
    expect(result.edgesMaterialized).toBe(0);
  });

  it('expands a person reachable via multiple paths at most once (visited dedup)', async () => {
    // seeds 1 and 2 share neighbor 99.
    const { deps, expandOrder } = fakeDeps({ 1: [99], 2: [99], 99: [] });
    const crawler = new OrbitCrawler(deps);

    const result = await crawler.crawl([1, 2], { maxEdges: 1000 });

    expect(expandOrder.filter((id) => id === 99)).toHaveLength(1);
    expect(result.personsExpanded).toBe(3);
  });

  it('deduplicates repeated seeds', async () => {
    const { deps, expandOrder } = fakeDeps({ 1: [] });
    const crawler = new OrbitCrawler(deps);

    await crawler.crawl([1, 1, 1], { maxEdges: 1000 });

    expect(expandOrder).toEqual([1]);
  });

  it('does not expand neighbors beyond maxDepth', async () => {
    // chain: 1 -> 2 -> 3 -> 4 -> 5
    const { deps, expandOrder } = fakeDeps({ 1: [2], 2: [3], 3: [4], 4: [5], 5: [] });
    const crawler = new OrbitCrawler(deps);

    await crawler.crawl([1], { maxEdges: 1000, maxDepth: 2 });

    // depth 0:1, depth 1:2, depth 2:3 expanded; 4 (depth 3) is enqueued-guarded out.
    expect(expandOrder.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(expandOrder).not.toContain(4);
    expect(expandOrder).not.toContain(5);
  });
});
