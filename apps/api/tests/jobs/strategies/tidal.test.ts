import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks — TidalService
// ---------------------------------------------------------------------------

const mockGetCollectionTracks = vi.fn();
const mockGetCollectionArtists = vi.fn();
const mockGetPlaylistTracks = vi.fn();
const mockGetPlaylists = vi.fn();
const mockGetDiscoveryMixTracks = vi.fn();
const mockGetNewArrivalTracks = vi.fn();
const mockGetMyMixes = vi.fn();

vi.mock('../../../src/services/tidal.js', () => ({
  TidalService: function MockTidalService() {
    return {
      getCollectionTracks: mockGetCollectionTracks,
      getCollectionArtists: mockGetCollectionArtists,
      getPlaylistTracks: mockGetPlaylistTracks,
      getPlaylists: mockGetPlaylists,
      getDiscoveryMixTracks: mockGetDiscoveryMixTracks,
      getNewArrivalTracks: mockGetNewArrivalTracks,
      getMyMixes: mockGetMyMixes,
    };
  },
}));

// isTidalConfig type guard — always returns true unless overridden
vi.mock('../../../src/types/connections.js', () => ({
  isTidalConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/tidal.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with a valid TIDAL connection. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['tidal', {
        id: 1,
        type: 'tidal',
        config: {
          clientId: 'cid',
          clientSecret: 'csecret',
          accessToken: 'atoken',
          refreshToken: 'rtoken',
        },
      }],
    ]),
  };
}

/** Build a context with NO TIDAL connection. */
function makeContextWithoutTidal(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('TIDAL strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // tidal_favorites
  // -----------------------------------------------------------------------
  describe('tidal_favorites', () => {
    it('returns unique artists from collection tracks', async () => {
      mockGetCollectionTracks.mockResolvedValue([
        { artists: [{ name: 'Artist A' }] },
        { artists: [{ name: 'Artist B' }] },
        { artists: [{ name: 'Artist A' }] }, // duplicate
      ]);

      const strategy = getStrategy('tidal_favorites')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', source: 'tidal-favorites' });
      expect(result.artists[1]).toEqual({ name: 'Artist B', source: 'tidal-favorites' });
      expect(result.albums).toHaveLength(0);
    });

    it('passes limit to getCollectionTracks', async () => {
      mockGetCollectionTracks.mockResolvedValue([]);

      const strategy = getStrategy('tidal_favorites')!;
      await strategy.execute(makeContext({ limit: 25 }));

      expect(mockGetCollectionTracks).toHaveBeenCalledWith(25);
    });

    it('defaults limit to 50', async () => {
      mockGetCollectionTracks.mockResolvedValue([]);

      const strategy = getStrategy('tidal_favorites')!;
      await strategy.execute(makeContext());

      expect(mockGetCollectionTracks).toHaveBeenCalledWith(50);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_favorites')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_followed_artists
  // -----------------------------------------------------------------------
  describe('tidal_followed_artists', () => {
    it('returns artists from followed artists', async () => {
      mockGetCollectionArtists.mockResolvedValue([
        { name: 'Followed A' },
        { name: 'Followed B' },
      ]);

      const strategy = getStrategy('tidal_followed_artists')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Followed A', source: 'tidal-followed' });
      expect(result.artists[1]).toEqual({ name: 'Followed B', source: 'tidal-followed' });
      expect(result.albums).toHaveLength(0);
    });

    it('passes limit to getCollectionArtists', async () => {
      mockGetCollectionArtists.mockResolvedValue([]);

      const strategy = getStrategy('tidal_followed_artists')!;
      await strategy.execute(makeContext({ limit: 30 }));

      expect(mockGetCollectionArtists).toHaveBeenCalledWith(30);
    });

    it('defaults limit to 100', async () => {
      mockGetCollectionArtists.mockResolvedValue([]);

      const strategy = getStrategy('tidal_followed_artists')!;
      await strategy.execute(makeContext());

      expect(mockGetCollectionArtists).toHaveBeenCalledWith(100);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_followed_artists')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_playlist
  // -----------------------------------------------------------------------
  describe('tidal_playlist', () => {
    it('returns unique artists from a single playlist', async () => {
      mockGetPlaylistTracks.mockResolvedValue([
        { artists: [{ name: 'PL Artist A' }] },
        { artists: [{ name: 'PL Artist B' }, { name: 'PL Artist A' }] },
      ]);

      const strategy = getStrategy('tidal_playlist')!;
      const result = await strategy.execute(makeContext({ playlistId: 'abc-123' }));

      expect(mockGetPlaylistTracks).toHaveBeenCalledWith('abc-123', 50);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'PL Artist A', source: 'tidal-playlist-abc-123' });
      expect(result.artists[1]).toEqual({ name: 'PL Artist B', source: 'tidal-playlist-abc-123' });
      expect(result.albums).toHaveLength(0);
    });

    it('passes custom limit to getPlaylistTracks', async () => {
      mockGetPlaylistTracks.mockResolvedValue([]);

      const strategy = getStrategy('tidal_playlist')!;
      await strategy.execute(makeContext({ playlistId: 'xyz', limit: 20 }));

      expect(mockGetPlaylistTracks).toHaveBeenCalledWith('xyz', 20);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_playlist')!;
      await expect(strategy.execute(makeContextWithoutTidal({ playlistId: 'abc' }))).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_playlists
  // -----------------------------------------------------------------------
  describe('tidal_playlists', () => {
    it('collects unique artists from first 10 playlists', async () => {
      const playlists = Array.from({ length: 12 }, (_, i) => ({ id: `pl-${i}` }));
      mockGetPlaylists.mockResolvedValue(playlists);
      mockGetPlaylistTracks.mockResolvedValue([
        { artists: [{ name: 'Multi Artist' }] },
      ]);

      const strategy = getStrategy('tidal_playlists')!;
      const result = await strategy.execute(makeContext());

      // Only first 10 playlists fetched
      expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(10);
      // Deduped across playlists — same artist in each
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Multi Artist', source: 'tidal-playlists' });
    });

    it('slices result to config.limit', async () => {
      const playlists = [{ id: 'pl-1' }];
      mockGetPlaylists.mockResolvedValue(playlists);
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artists: [{ name: `PL Artist ${i}` }],
      }));
      mockGetPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_playlists')!;
      const result = await strategy.execute(makeContext({ limit: 20 }));

      expect(result.artists).toHaveLength(20);
    });

    it('defaults limit to 50', async () => {
      const playlists = [{ id: 'pl-1' }];
      mockGetPlaylists.mockResolvedValue(playlists);
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artists: [{ name: `PL Artist ${i}` }],
      }));
      mockGetPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_playlists')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_playlists')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_discovery
  // -----------------------------------------------------------------------
  describe('tidal_discovery', () => {
    it('returns unique artists from discovery mix tracks', async () => {
      mockGetDiscoveryMixTracks.mockResolvedValue([
        { artists: [{ name: 'Disco A' }] },
        { artists: [{ name: 'Disco B' }] },
        { artists: [{ name: 'Disco A' }] },
      ]);

      const strategy = getStrategy('tidal_discovery')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Disco A', source: 'tidal-discovery' });
      expect(result.artists[1]).toEqual({ name: 'Disco B', source: 'tidal-discovery' });
      expect(result.albums).toHaveLength(0);
    });

    it('slices to config.limit', async () => {
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        artists: [{ name: `Disco ${i}` }],
      }));
      mockGetDiscoveryMixTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_discovery')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.artists).toHaveLength(10);
    });

    it('defaults limit to 50', async () => {
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        artists: [{ name: `Disco ${i}` }],
      }));
      mockGetDiscoveryMixTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_discovery')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_discovery')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_new_arrivals (ALBUMS, not artists)
  // -----------------------------------------------------------------------
  describe('tidal_new_arrivals', () => {
    it('returns albums (not artists) from new arrival tracks', async () => {
      mockGetNewArrivalTracks.mockResolvedValue([
        {
          album: { id: 'alb-1', title: 'Album One' },
          artists: [{ name: 'Artist X' }],
        },
        {
          album: { id: 'alb-2', title: 'Album Two' },
          artists: [{ name: 'Artist Y' }],
        },
        {
          // Duplicate album id — should be deduped
          album: { id: 'alb-1', title: 'Album One' },
          artists: [{ name: 'Artist X' }],
        },
      ]);

      const strategy = getStrategy('tidal_new_arrivals')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(0);
      expect(result.albums).toHaveLength(2);
      expect(result.albums[0]).toEqual({
        albumName: 'Album One',
        artistName: 'Artist X',
        releaseType: 'album',
        source: 'tidal-new-arrivals',
      });
      expect(result.albums[1]).toEqual({
        albumName: 'Album Two',
        artistName: 'Artist Y',
        releaseType: 'album',
        source: 'tidal-new-arrivals',
      });
    });

    it('uses "Unknown Artist" when track has no artists', async () => {
      mockGetNewArrivalTracks.mockResolvedValue([
        {
          album: { id: 'alb-1', title: 'Mystery Album' },
          artists: [],
        },
      ]);

      const strategy = getStrategy('tidal_new_arrivals')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(1);
      expect(result.albums[0].artistName).toBe('Unknown Artist');
    });

    it('skips tracks without an album', async () => {
      mockGetNewArrivalTracks.mockResolvedValue([
        {
          album: { id: 'alb-1', title: 'Real Album' },
          artists: [{ name: 'Artist A' }],
        },
        {
          album: null,
          artists: [{ name: 'Artist B' }],
        },
      ]);

      const strategy = getStrategy('tidal_new_arrivals')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(1);
      expect(result.albums[0].albumName).toBe('Real Album');
    });

    it('slices to config.limit', async () => {
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        album: { id: `alb-${i}`, title: `Album ${i}` },
        artists: [{ name: `Artist ${i}` }],
      }));
      mockGetNewArrivalTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_new_arrivals')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.albums).toHaveLength(10);
    });

    it('defaults limit to 50', async () => {
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        album: { id: `alb-${i}`, title: `Album ${i}` },
        artists: [{ name: `Artist ${i}` }],
      }));
      mockGetNewArrivalTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_new_arrivals')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(50);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_new_arrivals')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // tidal_mix
  // -----------------------------------------------------------------------
  describe('tidal_mix', () => {
    it('returns unique artists from first 3 mixes', async () => {
      const mixes = Array.from({ length: 5 }, (_, i) => ({ id: `mix-${i}` }));
      mockGetMyMixes.mockResolvedValue(mixes);
      mockGetPlaylistTracks.mockImplementation(async (id: string) => [
        { artists: [{ name: `Artist from ${id}` }] },
        { artists: [{ name: 'Shared Artist' }] },
      ]);

      const strategy = getStrategy('tidal_mix')!;
      const result = await strategy.execute(makeContext());

      // Only first 3 mixes processed
      expect(mockGetPlaylistTracks).toHaveBeenCalledTimes(3);
      expect(mockGetPlaylistTracks).toHaveBeenCalledWith('mix-0', 50);
      expect(mockGetPlaylistTracks).toHaveBeenCalledWith('mix-1', 50);
      expect(mockGetPlaylistTracks).toHaveBeenCalledWith('mix-2', 50);
      // 3 unique per-mix artists + 1 shared = 4
      expect(result.artists).toHaveLength(4);
      expect(result.artists.map(a => a.name)).toContain('Shared Artist');
      expect(result.albums).toHaveLength(0);
    });

    it('all results have source "tidal-mix"', async () => {
      mockGetMyMixes.mockResolvedValue([{ id: 'mix-1' }]);
      mockGetPlaylistTracks.mockResolvedValue([
        { artists: [{ name: 'Some Artist' }] },
      ]);

      const strategy = getStrategy('tidal_mix')!;
      const result = await strategy.execute(makeContext());

      for (const artist of result.artists) {
        expect(artist.source).toBe('tidal-mix');
      }
    });

    it('slices to config.limit', async () => {
      mockGetMyMixes.mockResolvedValue([{ id: 'mix-1' }]);
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        artists: [{ name: `Mix Artist ${i}` }],
      }));
      mockGetPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_mix')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.artists).toHaveLength(10);
    });

    it('defaults limit to 50', async () => {
      mockGetMyMixes.mockResolvedValue([{ id: 'mix-1' }]);
      const tracks = Array.from({ length: 80 }, (_, i) => ({
        artists: [{ name: `Mix Artist ${i}` }],
      }));
      mockGetPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('tidal_mix')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no TIDAL connection', async () => {
      const strategy = getStrategy('tidal_mix')!;
      await expect(strategy.execute(makeContextWithoutTidal())).rejects.toThrow(
        'No active TIDAL connection. Please add a TIDAL connection first.',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Registration completeness
  // -----------------------------------------------------------------------
  describe('registration', () => {
    it('registers all 7 TIDAL strategy types', () => {
      const types = [
        'tidal_favorites',
        'tidal_followed_artists',
        'tidal_playlist',
        'tidal_playlists',
        'tidal_discovery',
        'tidal_new_arrivals',
        'tidal_mix',
      ] as const;

      for (const type of types) {
        expect(getStrategy(type), `strategy for ${type} should be registered`).toBeDefined();
      }
    });
  });
});
