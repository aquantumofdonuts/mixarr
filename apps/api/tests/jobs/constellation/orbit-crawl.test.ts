import { describe, it, expect, vi } from 'vitest';
import {
  runOrbitCrawl,
  makeExpandAdapter,
  warmOrbitIfStale,
  rewakeStaleOrbits,
  type OrbitStore,
} from '../../../src/jobs/constellation/orbit-crawl-worker.js';
import { ApiBudgetExhaustedError } from '../../../src/services/constellation/DailyApiBudget.js';
import {
  OrbitSeedCollector,
  type SeedSource,
  type OrbitTier,
} from '../../../src/services/constellation/OrbitSeedCollector.js';
import { OrbitCrawler, type OrbitDeps } from '../../../src/services/constellation/OrbitCrawler.js';

function source(tier: OrbitTier, artists: Array<{ mbid?: string; discogsId?: number; name?: string }>): SeedSource {
  return { tier, getArtists: async () => artists };
}

/** Records every markOrbit call so tests can assert seed tiering. */
function fakeMarkOrbit(): {
  markOrbit: (userId: number, personId: number, tier: OrbitTier) => Promise<void>;
  calls: Array<{ userId: number; personId: number; tier: OrbitTier }>;
} {
  const calls: Array<{ userId: number; personId: number; tier: OrbitTier }> = [];
  return {
    calls,
    markOrbit: async (userId, personId, tier) => {
      calls.push({ userId, personId, tier });
    },
  };
}

describe('runOrbitCrawl', () => {
  it('marks each seed into the orbit with its tier and crawls nearest-first', async () => {
    const collector = new OrbitSeedCollector(async () => null);
    const sources = [
      source('hist1d', [{ discogsId: 1 }]),
      source('hist7d', [{ discogsId: 2 }]),
      source('lib', [{ discogsId: 3 }]),
    ];

    // Record the seed order the crawler is invoked with. Seeds expand to nothing.
    const crawlSeeds: number[] = [];
    const deps: OrbitDeps = {
      async expand(personId) {
        crawlSeeds.push(personId);
        return { neighborIds: [], edgesCreated: 0 };
      },
      async isFull() {
        return false;
      },
    };
    const crawler = new OrbitCrawler(deps);
    const { markOrbit, calls } = fakeMarkOrbit();

    const result = await runOrbitCrawl({
      userId: 7,
      collector,
      sources,
      crawler,
      maxEdges: 100,
      markOrbit,
    });

    // Seeds marked into orbit with correct tiers.
    expect(calls).toEqual([
      { userId: 7, personId: 1, tier: 'hist1d' },
      { userId: 7, personId: 2, tier: 'hist7d' },
      { userId: 7, personId: 3, tier: 'lib' },
    ]);

    // Crawler visited seeds in nearest-first tier order.
    expect(crawlSeeds).toEqual([1, 2, 3]);

    expect(result.seeds).toBe(3);
    expect(result.personsExpanded).toBe(3);
    expect(result.edgesMaterialized).toBe(0);
  });

  it('dedupes a person across tiers before marking/crawling (nearest wins)', async () => {
    const collector = new OrbitSeedCollector(async () => null);
    const sources = [
      source('hist1d', [{ discogsId: 42 }]),
      source('lib', [{ discogsId: 42 }, { discogsId: 43 }]),
    ];

    const deps: OrbitDeps = {
      async expand() {
        return { neighborIds: [], edgesCreated: 0 };
      },
      async isFull() {
        return false;
      },
    };
    const { markOrbit, calls } = fakeMarkOrbit();

    const result = await runOrbitCrawl({
      userId: 1,
      collector,
      sources,
      crawler: new OrbitCrawler(deps),
      maxEdges: 100,
      markOrbit,
    });

    // 42 is marked once (in hist1d, its nearest tier), 43 in lib.
    expect(calls).toEqual([
      { userId: 1, personId: 42, tier: 'hist1d' },
      { userId: 1, personId: 43, tier: 'lib' },
    ]);
    expect(result.seeds).toBe(2);
  });

  it('respects the edge budget by delegating to the real OrbitCrawler', async () => {
    const collector = new OrbitSeedCollector(async () => null);
    const sources = [source('hist1d', [{ discogsId: 1 }])];

    // Every person expands to 5 fresh neighbors / 5 edges -> only the budget stops it.
    const deps: OrbitDeps = {
      async expand(personId) {
        return { neighborIds: [0, 1, 2, 3, 4].map((k) => personId * 10 + k), edgesCreated: 5 };
      },
      async isFull() {
        return false;
      },
    };
    const { markOrbit } = fakeMarkOrbit();

    const result = await runOrbitCrawl({
      userId: 1,
      collector,
      sources,
      crawler: new OrbitCrawler(deps),
      maxEdges: 12,
      markOrbit,
    });

    // Budget checked after each expand -> overshoot by at most one expand (5).
    expect(result.edgesMaterialized).toBeGreaterThanOrEqual(12);
    expect(result.edgesMaterialized).toBeLessThanOrEqual(12 + 5);
    expect(result.personsExpanded).toBe(3);
    expect(result.seeds).toBe(1);
  });

  it('returns zero seeds (and does not crawl) when no source resolves', async () => {
    const collector = new OrbitSeedCollector(async () => null);
    const sources = [source('hist1d', [{ name: 'unresolvable' }])];

    let expandCalled = false;
    const deps: OrbitDeps = {
      async expand() {
        expandCalled = true;
        return { neighborIds: [], edgesCreated: 0 };
      },
      async isFull() {
        return false;
      },
    };
    const { markOrbit, calls } = fakeMarkOrbit();

    const result = await runOrbitCrawl({
      userId: 1,
      collector,
      sources,
      crawler: new OrbitCrawler(deps),
      maxEdges: 100,
      markOrbit,
    });

    expect(result).toEqual({ personsExpanded: 0, edgesMaterialized: 0, seeds: 0 });
    expect(calls).toEqual([]);
    expect(expandCalled).toBe(false);
  });

  it('keeps crawling when markOrbit throws for one seed (mark failure is non-fatal)', async () => {
    const collector = new OrbitSeedCollector(async () => null);
    const sources = [source('hist1d', [{ discogsId: 1 }, { discogsId: 2 }])];

    const crawlSeeds: number[] = [];
    const deps: OrbitDeps = {
      async expand(personId) {
        crawlSeeds.push(personId);
        return { neighborIds: [], edgesCreated: 0 };
      },
      async isFull() {
        return false;
      },
    };

    // markOrbit throws for person 1 but succeeds for person 2.
    const marked: number[] = [];
    const markOrbit = async (_userId: number, personId: number) => {
      if (personId === 1) throw new Error('orbit upsert boom');
      marked.push(personId);
    };

    const result = await runOrbitCrawl({
      userId: 3,
      collector,
      sources,
      crawler: new OrbitCrawler(deps),
      maxEdges: 100,
      markOrbit,
    });

    // The failed mark for seed 1 did not abort the run: seed 2 still marked, and
    // BOTH seeds were still crawled.
    expect(marked).toEqual([2]);
    expect(crawlSeeds).toEqual([1, 2]);
    expect(result.seeds).toBe(2);
    expect(result.personsExpanded).toBe(2);
  });
});

describe('makeExpandAdapter resilience', () => {
  it('returns an empty dead-end (not a throw) when expandPerson fails', async () => {
    const expansionService = {
      async expandPerson() {
        throw new Error('getArtistReleases: source unreachable');
      },
    };
    // findMany must never be reached on the failure path.
    const prisma = {
      constellationEdge: {
        async findMany() {
          throw new Error('should not be called after expand failure');
        },
      },
    };

    const expand = makeExpandAdapter(expansionService, prisma);

    await expect(expand(42)).resolves.toEqual({ neighborIds: [], edgesCreated: 0 });
  });

  it('skips only the failing person; a real OrbitCrawler still expands the others', async () => {
    // Two seeds; expandPerson throws for person 1 but succeeds for person 2.
    const expansionService = {
      async expandPerson(id: number) {
        if (id === 1) throw new Error('person 1 unreachable');
      },
    };
    const prisma = {
      constellationEdge: {
        async findMany(args: unknown) {
          const sourceId = (args as { where: { sourcePersonId: number } }).where.sourcePersonId;
          // Person 2 has no neighbours; anyone else likewise (only 1 & 2 are seeds).
          return sourceId === 2 ? [] : [];
        },
      },
    };

    const expand = makeExpandAdapter(expansionService, prisma);
    const crawler = new OrbitCrawler({
      expand,
      async isFull() {
        return false;
      },
    });

    const result = await crawler.crawl([1, 2], { maxEdges: 100 });

    // Both were dequeued and expand() was awaited for each; person 1's failure
    // degraded to a dead end rather than aborting the crawl.
    expect(result.personsExpanded).toBe(2);
    expect(result.edgesMaterialized).toBe(0);
  });
});

describe('makeExpandAdapter and the daily API budget', () => {
  it('rethrows ApiBudgetExhaustedError so the crawl stops instead of skipping every person', async () => {
    const expansionService = {
      async expandPerson() {
        throw new ApiBudgetExhaustedError(5000, '2026-10-07');
      },
    };
    const prisma = { constellationEdge: { async findMany() { return []; } } };
    const expand = makeExpandAdapter(expansionService, prisma);
    const crawler = new OrbitCrawler({ expand, async isFull() { return false; } });

    await expect(crawler.crawl([1, 2, 3], { maxEdges: 100 })).rejects.toBeInstanceOf(
      ApiBudgetExhaustedError,
    );
  });
});

describe('warmOrbitIfStale', () => {
  const NOW = new Date('2026-10-07T12:00:00Z');
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  function fakeStore(rows: Array<{ userId: number; status: string; lastCrawledAt: Date | null }>): OrbitStore {
    return {
      constellationOrbit: {
        async findFirst(args) {
          const w = args.where as { userId: number; status: string; lastCrawledAt?: { gte: Date } };
          const matches = rows
            .filter((r) => r.userId === w.userId && r.status === w.status)
            .filter((r) => !w.lastCrawledAt || (r.lastCrawledAt && r.lastCrawledAt >= w.lastCrawledAt.gte))
            .sort((a, b) => (b.lastCrawledAt?.getTime() ?? 0) - (a.lastCrawledAt?.getTime() ?? 0));
          return matches[0] ? { lastCrawledAt: matches[0].lastCrawledAt } : null;
        },
        async groupBy() {
          return [...new Set(rows.map((r) => r.userId))].map((userId) => ({ userId }));
        },
      },
    };
  }

  it('enqueues for a user with no orbit yet', async () => {
    const enqueue = vi.fn(async () => {});
    const result = await warmOrbitIfStale(1, { store: fakeStore([]), enqueue, now: () => NOW });
    expect(result).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(1);
  });

  it('skips when a warm is in flight (crawling row younger than the in-flight window)', async () => {
    const enqueue = vi.fn(async () => {});
    const store = fakeStore([{ userId: 1, status: 'crawling', lastCrawledAt: new Date(NOW.getTime() - HOUR) }]);
    expect(await warmOrbitIfStale(1, { store, enqueue, now: () => NOW })).toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('treats an old crawling row as abandoned and re-enqueues', async () => {
    const enqueue = vi.fn(async () => {});
    const store = fakeStore([{ userId: 1, status: 'crawling', lastCrawledAt: new Date(NOW.getTime() - 2 * DAY) }]);
    expect(await warmOrbitIfStale(1, { store, enqueue, now: () => NOW })).toBe(true);
  });

  it('skips a settled orbit crawled within the re-wake window, re-enqueues once it is older', async () => {
    const enqueue = vi.fn(async () => {});
    const fresh = fakeStore([{ userId: 1, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - 2 * DAY) }]);
    expect(await warmOrbitIfStale(1, { store: fresh, enqueue, now: () => NOW })).toBe(false);

    const stale = fakeStore([{ userId: 1, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - 8 * DAY) }]);
    expect(await warmOrbitIfStale(1, { store: stale, enqueue, now: () => NOW })).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('honours a custom rewakeAfterMs', async () => {
    const enqueue = vi.fn(async () => {});
    const store = fakeStore([{ userId: 1, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - 2 * DAY) }]);
    expect(await warmOrbitIfStale(1, { store, enqueue, now: () => NOW, rewakeAfterMs: DAY })).toBe(true);
  });

  it('rewakeStaleOrbits gates every user with an orbit and survives one failure', async () => {
    const store = fakeStore([
      { userId: 1, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - 8 * DAY) },
      { userId: 2, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - DAY) },
      { userId: 3, status: 'crawled', lastCrawledAt: new Date(NOW.getTime() - 9 * DAY) },
    ]);
    const enqueue = vi.fn(async (userId: number) => {
      if (userId === 1) throw new Error('queue down');
    });

    const enqueued = await rewakeStaleOrbits({ store, enqueue, now: () => NOW });

    // 1 failed (counted as not enqueued), 2 is fresh, 3 is stale -> 1 enqueued.
    expect(enqueued).toBe(1);
    expect(enqueue.mock.calls.map((c) => c[0])).toEqual([1, 3]);
  });
});

describe('orbit-crawl-worker module import', () => {
  it('does not open a Redis connection at import time', async () => {
    // Importing the module must not construct a BullMQ Worker / Redis client.
    // registerOrbitCrawlWorker is a guarded function; merely importing the module
    // (done above) performs no Redis I/O. This test documents that contract: if
    // importing connected to Redis, the suite would hang/fail without a server.
    const mod = await import('../../../src/jobs/constellation/orbit-crawl-worker.js');
    expect(typeof mod.runOrbitCrawl).toBe('function');
    expect(typeof mod.registerOrbitCrawlWorker).toBe('function');
  });
});
