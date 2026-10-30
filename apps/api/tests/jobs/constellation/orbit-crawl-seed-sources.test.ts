import { describe, it, expect, vi } from 'vitest';
import { buildSeedSources } from '../../../src/jobs/constellation/orbit-crawl-worker.js';
import type { OrbitTier } from '../../../src/services/constellation/OrbitSeedCollector.js';

const none = {
  getLidarrArtists: async () => [],
  getLastfmTopArtists: async () => [],
  getListenBrainzTopArtists: async () => [],
};

describe('buildSeedSources', () => {
  it('wires Lidarr library artists to the lib tier as MBID refs', async () => {
    let seenUserId: number | undefined;
    const sources = buildSeedSources(7, {
      ...none,
      getLidarrArtists: async (userId) => {
        seenUserId = userId;
        return [{ foreignArtistId: 'mbid-1' }, { foreignArtistId: 'mbid-2' }];
      },
    });

    const lib = sources.filter((s) => s.tier === 'lib');
    expect(lib).toHaveLength(1);

    const refs = await lib[0].getArtists();
    expect(seenUserId).toBe(7);
    expect(refs).toEqual([{ mbid: 'mbid-1' }, { mbid: 'mbid-2' }]);
  });

  it('drops Lidarr artists with an empty/missing MBID', async () => {
    const sources = buildSeedSources(1, {
      ...none,
      getLidarrArtists: async () => [{ foreignArtistId: '' }, { foreignArtistId: 'm' }],
    });

    const refs = await sources.find((s) => s.tier === 'lib')!.getArtists();
    expect(refs).toEqual([{ mbid: 'm' }]);
  });

  it('maps each history tier to the matching Last.fm period and ListenBrainz range', async () => {
    const getLastfmTopArtists = vi.fn(async () => []);
    const getListenBrainzTopArtists = vi.fn(async () => []);
    const sources = buildSeedSources(3, { ...none, getLastfmTopArtists, getListenBrainzTopArtists });

    for (const s of sources) await s.getArtists();

    expect(getLastfmTopArtists.mock.calls).toEqual([
      [3, '7day'],
      [3, '1month'],
      [3, 'overall'],
    ]);
    expect(getListenBrainzTopArtists.mock.calls).toEqual([
      [3, 'week'],
      [3, 'month'],
      [3, 'all_time'],
    ]);

    const tiers = sources.map((s) => s.tier);
    const expected: OrbitTier[] = ['hist7d', 'hist7d', 'hist30d', 'hist30d', 'libtop', 'libtop', 'lib'];
    expect(tiers).toEqual(expected);
  });

  it('wires Last.fm top artists as mbid/name refs (name-only refs pass through for the collector to skip)', async () => {
    const sources = buildSeedSources(1, {
      ...none,
      getLastfmTopArtists: async (_userId, period) =>
        period === '1month' ? [{ mbid: 'x', name: 'A' }, { name: 'B' }] : [],
    });

    const [hist] = sources.filter((s) => s.tier === 'hist30d');
    const refs = await hist.getArtists();
    expect(refs).toEqual([
      { mbid: 'x', name: 'A' },
      { mbid: undefined, name: 'B' },
    ]);
  });

  it('wires ListenBrainz top artists as mbid/name refs', async () => {
    const sources = buildSeedSources(1, {
      ...none,
      getListenBrainzTopArtists: async (_userId, range) =>
        range === 'week' ? [{ mbid: 'lb-1', name: 'LB' }, { mbid: '', name: 'NoMbid' }] : [],
    });

    const [, lb] = sources.filter((s) => s.tier === 'hist7d');
    const refs = await lb.getArtists();
    expect(refs).toEqual([
      { mbid: 'lb-1', name: 'LB' },
      { mbid: undefined, name: 'NoMbid' },
    ]);
  });

  it('does not emit a hist1d source (no backend exposes a one-day MBID window)', () => {
    const sources = buildSeedSources(1, none);
    expect(sources.some((s) => s.tier === 'hist1d')).toBe(false);
  });

  it('returns empty refs (never throws) when no connections are configured', async () => {
    const sources = buildSeedSources(1, none);
    for (const s of sources) {
      expect(await s.getArtists()).toEqual([]);
    }
  });
});
