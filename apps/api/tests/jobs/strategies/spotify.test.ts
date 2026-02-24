import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// SpotifyService mock
const mockGetAllFollowedArtists = vi.fn();
const mockGetAllSavedAlbums = vi.fn();
const mockGetAllLikedSongs = vi.fn();
const mockGetAllNewReleases = vi.fn();
const mockGetDiscoverWeeklyTracks = vi.fn();
const mockGetReleaseRadarTracks = vi.fn();
const mockGetDailyMixTracks = vi.fn();
const mockGetOnRepeatTracks = vi.fn();
const mockGetFeaturedPlaylistsArtists = vi.fn();
const mockGetCategoryArtists = vi.fn();

vi.mock('../../../src/services/spotify.js', () => ({
  SpotifyService: function MockSpotifyService() {
    return {
      getAllFollowedArtists: mockGetAllFollowedArtists,
      getAllSavedAlbums: mockGetAllSavedAlbums,
      getAllLikedSongs: mockGetAllLikedSongs,
      getAllNewReleases: mockGetAllNewReleases,
      getDiscoverWeeklyTracks: mockGetDiscoverWeeklyTracks,
      getReleaseRadarTracks: mockGetReleaseRadarTracks,
      getDailyMixTracks: mockGetDailyMixTracks,
      getOnRepeatTracks: mockGetOnRepeatTracks,
      getFeaturedPlaylistsArtists: mockGetFeaturedPlaylistsArtists,
      getCategoryArtists: mockGetCategoryArtists,
    };
  },
}));

// Public playlist mock
const mockFetchPublicPlaylist = vi.fn();
const mockParseSpotifyPlaylistUrl = vi.fn();
const mockExtractArtistsFromPlaylist = vi.fn();

vi.mock('../../../src/services/public-playlist.js', () => ({
  fetchPublicPlaylist: (...args: unknown[]) => mockFetchPublicPlaylist(...args),
  parseSpotifyPlaylistUrl: (...args: unknown[]) => mockParseSpotifyPlaylistUrl(...args),
  extractArtistsFromPlaylist: (...args: unknown[]) => mockExtractArtistsFromPlaylist(...args),
}));

// isSpotifyConfig type guard — always returns true unless the test overrides
vi.mock('../../../src/types/connections.js', () => ({
  isSpotifyConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/spotify.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with a valid Spotify connection. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['spotify', { id: 1, type: 'spotify', config: { clientId: 'id', clientSecret: 'secret' } }],
    ]),
  };
}

/** Build a context with NO Spotify connection. */
function makeContextNoSpotify(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Spotify strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // spotify_playlist
  // -----------------------------------------------------------------------
  describe('spotify_playlist', () => {
    it('extracts unique artists from a public playlist', async () => {
      mockFetchPublicPlaylist.mockResolvedValue({
        tracks: [
          { artists: [{ name: 'Artist A' }, { name: 'Artist B' }] },
          { artists: [{ name: 'Artist A' }] },
          { artists: [{ name: 'Artist C' }] },
        ],
      });

      const strategy = getStrategy('spotify_playlist')!;
      const result = await strategy.execute(makeContext({ playlistId: 'abc123' }));

      expect(mockFetchPublicPlaylist).toHaveBeenCalledWith('abc123');
      expect(result.artists).toHaveLength(3);
      expect(result.artists.map(a => a.name)).toEqual(['Artist A', 'Artist B', 'Artist C']);
      expect(result.artists[0].source).toBe('spotify-playlist-abc123');
      expect(result.albums).toHaveLength(0);
    });

    it('throws when playlistId is missing', async () => {
      const strategy = getStrategy('spotify_playlist')!;
      await expect(strategy.execute(makeContext({}))).rejects.toThrow('Playlist ID is required');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_followed
  // -----------------------------------------------------------------------
  describe('spotify_followed', () => {
    it('returns followed artists', async () => {
      mockGetAllFollowedArtists.mockResolvedValue([
        { name: 'Followed 1' },
        { name: 'Followed 2' },
      ]);

      const strategy = getStrategy('spotify_followed')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Followed 1', source: 'spotify-followed' });
    });

    it('throws when no Spotify connection', async () => {
      const strategy = getStrategy('spotify_followed')!;
      await expect(strategy.execute(makeContextNoSpotify())).rejects.toThrow(
        'No active Spotify connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // spotify_saved_albums
  // -----------------------------------------------------------------------
  describe('spotify_saved_albums', () => {
    it('returns albums from saved albums', async () => {
      mockGetAllSavedAlbums.mockResolvedValue([
        { name: 'Album 1', artists: [{ name: 'Artist X' }], release_date: '2024-01-15' },
        { name: 'Album 2', artists: [{ name: 'Artist Y' }], release_date: '2023-06' },
      ]);

      const strategy = getStrategy('spotify_saved_albums')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(2);
      expect(result.albums[0]).toEqual({
        albumName: 'Album 1',
        artistName: 'Artist X',
        releaseDate: '2024-01-15',
        releaseYear: 2024,
        releaseType: 'album',
        source: 'spotify-saved-albums',
      });
      expect(result.artists).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // spotify_liked_songs
  // -----------------------------------------------------------------------
  describe('spotify_liked_songs', () => {
    it('extracts unique artists from liked tracks', async () => {
      mockGetAllLikedSongs.mockResolvedValue([
        { artists: [{ name: 'A' }] },
        { artists: [{ name: 'B' }, { name: 'A' }] },
      ]);

      const strategy = getStrategy('spotify_liked_songs')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0].source).toBe('spotify-liked-songs');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_new_releases
  // -----------------------------------------------------------------------
  describe('spotify_new_releases', () => {
    it('returns artists by default', async () => {
      mockGetAllNewReleases.mockResolvedValue([
        { name: 'NR Album', artists: [{ name: 'NR Artist' }], release_date: '2025-01-01' },
      ]);

      const strategy = getStrategy('spotify_new_releases')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'NR Artist', source: 'spotify-new-releases' });
      expect(result.albums).toHaveLength(0);
    });

    it('returns albums when discoverAlbums is true', async () => {
      mockGetAllNewReleases.mockResolvedValue([
        { name: 'NR Album', artists: [{ name: 'NR Artist' }], release_date: '2025-03-20' },
      ]);

      const strategy = getStrategy('spotify_new_releases')!;
      const result = await strategy.execute(makeContext({ discoverAlbums: true }));

      expect(result.albums).toHaveLength(1);
      expect(result.albums[0].albumName).toBe('NR Album');
      expect(result.albums[0].source).toBe('spotify-new-releases');
      expect(result.artists).toHaveLength(0);
    });

    it('passes limit and country to service', async () => {
      mockGetAllNewReleases.mockResolvedValue([]);

      const strategy = getStrategy('spotify_new_releases')!;
      await strategy.execute(makeContext({ limit: 25, country: 'US' }));

      expect(mockGetAllNewReleases).toHaveBeenCalledWith(25, 'US');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_discover_weekly
  // -----------------------------------------------------------------------
  describe('spotify_discover_weekly', () => {
    it('extracts artists from Discover Weekly tracks', async () => {
      mockGetDiscoverWeeklyTracks.mockResolvedValue([
        { artists: [{ name: 'DW1' }] },
        { artists: [{ name: 'DW2' }] },
      ]);

      const strategy = getStrategy('spotify_discover_weekly')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0].source).toBe('spotify-discover-weekly');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_release_radar
  // -----------------------------------------------------------------------
  describe('spotify_release_radar', () => {
    it('extracts artists from Release Radar tracks', async () => {
      mockGetReleaseRadarTracks.mockResolvedValue([
        { artists: [{ name: 'RR1' }] },
      ]);

      const strategy = getStrategy('spotify_release_radar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].source).toBe('spotify-release-radar');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_daily_mix
  // -----------------------------------------------------------------------
  describe('spotify_daily_mix', () => {
    it('extracts artists from Daily Mix tracks', async () => {
      mockGetDailyMixTracks.mockResolvedValue([
        { artists: [{ name: 'DM1' }, { name: 'DM2' }] },
      ]);

      const strategy = getStrategy('spotify_daily_mix')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0].source).toBe('spotify-daily-mix');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_on_repeat
  // -----------------------------------------------------------------------
  describe('spotify_on_repeat', () => {
    it('extracts artists from On Repeat tracks', async () => {
      mockGetOnRepeatTracks.mockResolvedValue([
        { artists: [{ name: 'OR1' }] },
      ]);

      const strategy = getStrategy('spotify_on_repeat')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].source).toBe('spotify-on-repeat');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_featured
  // -----------------------------------------------------------------------
  describe('spotify_featured', () => {
    it('returns featured artists', async () => {
      mockGetFeaturedPlaylistsArtists.mockResolvedValue([
        { name: 'Feat1' },
        { name: 'Feat2' },
      ]);

      const strategy = getStrategy('spotify_featured')!;
      const result = await strategy.execute(makeContext({ limit: 30 }));

      expect(mockGetFeaturedPlaylistsArtists).toHaveBeenCalledWith(30);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Feat1', source: 'spotify-featured' });
    });
  });

  // -----------------------------------------------------------------------
  // spotify_category
  // -----------------------------------------------------------------------
  describe('spotify_category', () => {
    it('returns category artists with dynamic source', async () => {
      mockGetCategoryArtists.mockResolvedValue([{ name: 'Cat1' }]);

      const strategy = getStrategy('spotify_category')!;
      const result = await strategy.execute(
        makeContext({ categoryId: 'rock', limit: 10 }),
      );

      expect(mockGetCategoryArtists).toHaveBeenCalledWith('rock', 10);
      expect(result.artists[0].source).toBe('spotify-category-rock');
    });

    it('throws when categoryId is missing', async () => {
      const strategy = getStrategy('spotify_category')!;
      await expect(strategy.execute(makeContext({}))).rejects.toThrow('Category ID is required');
    });
  });

  // -----------------------------------------------------------------------
  // spotify_library
  // -----------------------------------------------------------------------
  describe('spotify_library', () => {
    it('combines followed, liked, and saved albums into deduplicated artists', async () => {
      mockGetAllFollowedArtists.mockResolvedValue([{ name: 'Shared' }, { name: 'Followed Only' }]);
      mockGetAllLikedSongs.mockResolvedValue([
        { artists: [{ name: 'Shared' }, { name: 'Liked Only' }] },
      ]);
      mockGetAllSavedAlbums.mockResolvedValue([
        { artists: [{ name: 'Shared' }, { name: 'Album Only' }] },
      ]);

      const strategy = getStrategy('spotify_library')!;
      const result = await strategy.execute(makeContext());

      // 'Shared' appears in all three but should only be listed once
      expect(result.artists).toHaveLength(4);
      const names = result.artists.map(a => a.name);
      expect(names).toContain('Shared');
      expect(names).toContain('Followed Only');
      expect(names).toContain('Liked Only');
      expect(names).toContain('Album Only');
      // First occurrence wins, so Shared should have 'spotify-library-followed' source
      expect(result.artists.find(a => a.name === 'Shared')?.source).toBe(
        'spotify-library-followed',
      );
    });
  });

  // -----------------------------------------------------------------------
  // spotify_public_playlist
  // -----------------------------------------------------------------------
  describe('spotify_public_playlist', () => {
    it('extracts artists via extractArtistsFromPlaylist (default mode)', async () => {
      mockParseSpotifyPlaylistUrl.mockReturnValue('pl123');
      mockFetchPublicPlaylist.mockResolvedValue({
        tracks: [{ artists: [{ name: 'A' }] }],
      });
      mockExtractArtistsFromPlaylist.mockReturnValue(['A']);

      const strategy = getStrategy('spotify_public_playlist')!;
      const result = await strategy.execute(
        makeContext({ playlistUrl: 'https://open.spotify.com/playlist/pl123' }),
      );

      expect(mockParseSpotifyPlaylistUrl).toHaveBeenCalledWith(
        'https://open.spotify.com/playlist/pl123',
      );
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].source).toBe('spotify-public-playlist-pl123');
    });

    it('extracts albums when discoverAlbums is true', async () => {
      mockParseSpotifyPlaylistUrl.mockReturnValue('pl123');
      mockFetchPublicPlaylist.mockResolvedValue({
        tracks: [
          { name: 'Track 1', artists: [{ name: 'Art1' }] },
          { name: 'Track 2', artists: [{ name: 'Art2' }] },
        ],
      });

      const strategy = getStrategy('spotify_public_playlist')!;
      const result = await strategy.execute(
        makeContext({
          playlistUrl: 'https://open.spotify.com/playlist/pl123',
          discoverAlbums: true,
        }),
      );

      expect(result.albums).toHaveLength(2);
      expect(result.albums[0].source).toBe('spotify-public-playlist-pl123');
    });

    it('throws when playlistUrl is missing', async () => {
      const strategy = getStrategy('spotify_public_playlist')!;
      await expect(strategy.execute(makeContext({}))).rejects.toThrow(
        'Playlist URL is required',
      );
    });

    it('throws when URL cannot be parsed', async () => {
      mockParseSpotifyPlaylistUrl.mockReturnValue(null);
      const strategy = getStrategy('spotify_public_playlist')!;
      await expect(
        strategy.execute(makeContext({ playlistUrl: 'not-a-url' })),
      ).rejects.toThrow('Invalid Spotify playlist URL');
    });
  });

  // -----------------------------------------------------------------------
  // Registration completeness
  // -----------------------------------------------------------------------
  describe('registration', () => {
    it('registers all 13 Spotify strategy types', async () => {
      const types = [
        'spotify_playlist',
        'spotify_followed',
        'spotify_saved_albums',
        'spotify_liked_songs',
        'spotify_new_releases',
        'spotify_discover_weekly',
        'spotify_release_radar',
        'spotify_daily_mix',
        'spotify_on_repeat',
        'spotify_featured',
        'spotify_category',
        'spotify_library',
        'spotify_public_playlist',
      ] as const;

      for (const type of types) {
        expect(getStrategy(type), `strategy for ${type} should be registered`).toBeDefined();
      }
    });
  });
});
