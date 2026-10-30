import { describe, it, expect } from 'vitest';
import {
  OrbitSeedCollector,
  type SeedSource,
} from '../../../src/services/constellation/OrbitSeedCollector.js';

/** A fixed-return seed source for a given tier. */
function source(tier: SeedSource['tier'], artists: Awaited<ReturnType<SeedSource['getArtists']>>): SeedSource {
  return { tier, getArtists: async () => artists };
}

/** A seed source whose getArtists rejects (to prove per-source isolation). */
function throwingSource(tier: SeedSource['tier']): SeedSource {
  return {
    tier,
    getArtists: async () => {
      throw new Error(`source ${tier} exploded`);
    },
  };
}

/**
 * Build a resolver over an mbid -> discogsId map. An mbid absent from the map
 * resolves to null (unresolvable). Records the mbids it was asked to resolve.
 */
function fakeResolver(map: Record<string, number | null>): {
  resolveMbid: (mbid: string) => Promise<number | null>;
  asked: string[];
} {
  const asked: string[] = [];
  return {
    asked,
    resolveMbid: async (mbid: string) => {
      asked.push(mbid);
      return map[mbid] ?? null;
    },
  };
}

describe('OrbitSeedCollector', () => {
  it('preserves tier order (nearest first)', async () => {
    const { resolveMbid } = fakeResolver({});
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('lib', [{ discogsId: 5 }]),
      source('hist30d', [{ discogsId: 3 }]),
      source('hist1d', [{ discogsId: 1 }]),
      source('libtop', [{ discogsId: 4 }]),
      source('hist7d', [{ discogsId: 2 }]),
    ]);

    // Regardless of the order sources are passed, the output follows the tier
    // ordering hist1d < hist7d < hist30d < libtop < lib.
    expect(result).toEqual([
      { tier: 'hist1d', personId: 1 },
      { tier: 'hist7d', personId: 2 },
      { tier: 'hist30d', personId: 3 },
      { tier: 'libtop', personId: 4 },
      { tier: 'lib', personId: 5 },
    ]);
  });

  it('keeps a person in its NEAREST tier when it appears in several', async () => {
    const { resolveMbid } = fakeResolver({});
    const collector = new OrbitSeedCollector(resolveMbid);

    // Person 42 appears in hist1d AND lib -> kept only in hist1d.
    const result = await collector.collect([
      source('hist1d', [{ discogsId: 42 }, { discogsId: 7 }]),
      source('lib', [{ discogsId: 42 }, { discogsId: 8 }]),
    ]);

    expect(result).toEqual([
      { tier: 'hist1d', personId: 42 },
      { tier: 'hist1d', personId: 7 },
      { tier: 'lib', personId: 8 },
    ]);
  });

  it('dedupes duplicates within a single source too', async () => {
    const { resolveMbid } = fakeResolver({});
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('hist7d', [{ discogsId: 9 }, { discogsId: 9 }, { discogsId: 10 }]),
    ]);

    expect(result).toEqual([
      { tier: 'hist7d', personId: 9 },
      { tier: 'hist7d', personId: 10 },
    ]);
  });

  it('resolves mbids to discogs ids and skips those that do not resolve', async () => {
    const { resolveMbid, asked } = fakeResolver({ 'mbid-good': 100, 'mbid-bad': null });
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('hist1d', [{ mbid: 'mbid-good' }, { mbid: 'mbid-bad' }]),
    ]);

    // Only the resolvable mbid survives; the unresolvable one is skipped (no throw).
    expect(result).toEqual([{ tier: 'hist1d', personId: 100 }]);
    expect(asked).toEqual(['mbid-good', 'mbid-bad']);
  });

  it('prefers an explicit discogsId over resolving the mbid', async () => {
    const { resolveMbid, asked } = fakeResolver({ 'mbid-x': 999 });
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('hist1d', [{ discogsId: 55, mbid: 'mbid-x' }]),
    ]);

    // discogsId wins -> the resolver is never consulted for this entry.
    expect(result).toEqual([{ tier: 'hist1d', personId: 55 }]);
    expect(asked).toEqual([]);
  });

  it('skips name-only entries (name resolution is out of scope for this task)', async () => {
    const { resolveMbid } = fakeResolver({});
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('hist1d', [{ name: 'Some Artist' }, { discogsId: 1 }]),
    ]);

    expect(result).toEqual([{ tier: 'hist1d', personId: 1 }]);
  });

  it('isolates a failing source so the others still contribute', async () => {
    const { resolveMbid } = fakeResolver({});
    const collector = new OrbitSeedCollector(resolveMbid);

    const result = await collector.collect([
      source('hist1d', [{ discogsId: 1 }]),
      throwingSource('hist7d'),
      source('hist30d', [{ discogsId: 3 }]),
    ]);

    // The throwing hist7d source contributes nothing, but hist1d and hist30d do.
    expect(result).toEqual([
      { tier: 'hist1d', personId: 1 },
      { tier: 'hist30d', personId: 3 },
    ]);
  });
});
