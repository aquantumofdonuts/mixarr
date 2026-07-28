import { describe, it, expect } from 'vitest';
import { runOrbitCrawl, makeExpandAdapter } from '../../../src/jobs/constellation/orbit-crawl-worker.js';
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
