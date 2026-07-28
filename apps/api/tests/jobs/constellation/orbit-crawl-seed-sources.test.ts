import { describe, it, expect } from 'vitest';
import { buildSeedSources } from '../../../src/jobs/constellation/orbit-crawl-worker.js';

describe('buildSeedSources', () => {
  it('wires Lidarr library artists to the lib tier as MBID refs', async () => {
    let seenUserId: number | undefined;
    const sources = buildSeedSources(7, {
      getLidarrArtists: async (userId) => {
        seenUserId = userId;
        return [{ foreignArtistId: 'mbid-1' }, { foreignArtistId: 'mbid-2' }];
      },
      getLastfmTopArtists: async () => [],
    });

    const lib = sources.find((s) => s.tier === 'lib');
    expect(lib).toBeDefined();

    const refs = await lib!.getArtists();
    expect(seenUserId).toBe(7);
    expect(refs).toEqual([{ mbid: 'mbid-1' }, { mbid: 'mbid-2' }]);
  });

  it('drops Lidarr artists with an empty/missing MBID', async () => {
    const sources = buildSeedSources(1, {
      getLidarrArtists: async () => [{ foreignArtistId: '' }, { foreignArtistId: 'm' }],
      getLastfmTopArtists: async () => [],
    });

    const refs = await sources.find((s) => s.tier === 'lib')!.getArtists();
    expect(refs).toEqual([{ mbid: 'm' }]);
  });

  it('wires Last.fm top artists to the hist30d tier as mbid/name refs', async () => {
    const sources = buildSeedSources(1, {
      getLidarrArtists: async () => [],
      getLastfmTopArtists: async () => [{ mbid: 'x', name: 'A' }, { name: 'B' }],
    });

    const hist = sources.find((s) => s.tier === 'hist30d');
    expect(hist).toBeDefined();

    const refs = await hist!.getArtists();
    expect(refs).toEqual([
      { mbid: 'x', name: 'A' },
      { mbid: undefined, name: 'B' },
    ]);
  });

  it('returns empty refs (never throws) when no connections are configured', async () => {
    const sources = buildSeedSources(1, {
      getLidarrArtists: async () => [],
      getLastfmTopArtists: async () => [],
    });
    for (const s of sources) {
      expect(await s.getArtists()).toEqual([]);
    }
  });
});
