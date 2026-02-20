import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks — Authenticated (DeezerOAuthService)
// ---------------------------------------------------------------------------

const mockGetAllFavoriteTracks = vi.fn();
const mockGetAllListeningHistory = vi.fn();
const mockGetFlow = vi.fn();
const mockGetAllPlaylistTracks = vi.fn();
const mockGetAllPlaylists = vi.fn();

vi.mock('../../../src/services/deezer-oauth.js', () => ({
  DeezerOAuthService: function MockDeezerOAuthService() {
    return {
      getAllFavoriteTracks: mockGetAllFavoriteTracks,
      getAllListeningHistory: mockGetAllListeningHistory,
      getFlow: mockGetFlow,
      getAllPlaylistTracks: mockGetAllPlaylistTracks,
      getAllPlaylists: mockGetAllPlaylists,
    };
  },
}));

// ---------------------------------------------------------------------------
// Mocks — Public API functions
// ---------------------------------------------------------------------------

const mockGetDeezerChartArtists = vi.fn();
const mockGetDeezerGenreArtists = vi.fn();
const mockSearchDeezerArtists = vi.fn();

vi.mock('../../../src/services/deezer.js', () => ({
  getDeezerChartArtists: (...args: unknown[]) => mockGetDeezerChartArtists(...args),
  getDeezerGenreArtists: (...args: unknown[]) => mockGetDeezerGenreArtists(...args),
  searchDeezerArtists: (...args: unknown[]) => mockSearchDeezerArtists(...args),
}));

// isDeezerConfig type guard — always returns true unless overridden
vi.mock('../../../src/types/connections.js', () => ({
  isDeezerConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/deezer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with a valid Deezer connection. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['deezer', {
        id: 1,
        type: 'deezer',
        config: { appId: 'app-id', appSecret: 'app-secret', accessToken: 'token' },
      }],
    ]),
  };
}

/** Build a context with NO Deezer connection (for public-API strategies). */
function makePublicContext(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Deezer strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // deezer_favorites
  // -----------------------------------------------------------------------
  describe('deezer_favorites', () => {
    it('returns unique artists from favorite tracks', async () => {
      mockGetAllFavoriteTracks.mockResolvedValue([
        { artist: { name: 'Artist A' } },
        { artist: { name: 'Artist B' } },
        { artist: { name: 'Artist A' } }, // duplicate
      ]);

      const strategy = getStrategy('deezer_favorites')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', source: 'deezer-favorites' });
      expect(result.artists[1]).toEqual({ name: 'Artist B', source: 'deezer-favorites' });
      expect(result.albums).toHaveLength(0);
    });

    it('slices to config.limit', async () => {
      const tracks = Array.from({ length: 100 }, (_, i) => ({
        artist: { name: `Artist ${i}` },
      }));
      mockGetAllFavoriteTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('deezer_favorites')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.artists).toHaveLength(10);
    });

    it('defaults limit to 50', async () => {
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artist: { name: `Artist ${i}` },
      }));
      mockGetAllFavoriteTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('deezer_favorites')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no Deezer connection', async () => {
      const strategy = getStrategy('deezer_favorites')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'No active Deezer connection',
      );
    });

    it('skips tracks without an artist', async () => {
      mockGetAllFavoriteTracks.mockResolvedValue([
        { artist: { name: 'Artist A' } },
        { title: 'No artist track' }, // no artist field
        { artist: null },
      ]);

      const strategy = getStrategy('deezer_favorites')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Artist A');
    });
  });

  // -----------------------------------------------------------------------
  // deezer_history
  // -----------------------------------------------------------------------
  describe('deezer_history', () => {
    it('returns unique artists from listening history', async () => {
      mockGetAllListeningHistory.mockResolvedValue([
        { artist: { name: 'History A' } },
        { artist: { name: 'History B' } },
      ]);

      const strategy = getStrategy('deezer_history')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'History A', source: 'deezer-history' });
      expect(result.artists[1]).toEqual({ name: 'History B', source: 'deezer-history' });
    });

    it('defaults limit to 50', async () => {
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artist: { name: `H ${i}` },
      }));
      mockGetAllListeningHistory.mockResolvedValue(tracks);

      const strategy = getStrategy('deezer_history')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no Deezer connection', async () => {
      const strategy = getStrategy('deezer_history')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'No active Deezer connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deezer_flow
  // -----------------------------------------------------------------------
  describe('deezer_flow', () => {
    it('returns unique artists from flow.data', async () => {
      mockGetFlow.mockResolvedValue({
        data: [
          { artist: { name: 'Flow A' } },
          { artist: { name: 'Flow B' } },
          { artist: { name: 'Flow A' } },
        ],
      });

      const strategy = getStrategy('deezer_flow')!;
      const result = await strategy.execute(makeContext({ limit: 30 }));

      expect(mockGetFlow).toHaveBeenCalledWith(30);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Flow A', source: 'deezer-flow' });
      expect(result.artists[1]).toEqual({ name: 'Flow B', source: 'deezer-flow' });
    });

    it('uses default limit of 50 for getFlow call', async () => {
      mockGetFlow.mockResolvedValue({ data: [] });

      const strategy = getStrategy('deezer_flow')!;
      await strategy.execute(makeContext());

      expect(mockGetFlow).toHaveBeenCalledWith(50);
    });

    it('throws when no Deezer connection', async () => {
      const strategy = getStrategy('deezer_flow')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'No active Deezer connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deezer_playlist
  // -----------------------------------------------------------------------
  describe('deezer_playlist', () => {
    it('returns unique artists from a single playlist', async () => {
      mockGetAllPlaylistTracks.mockResolvedValue([
        { artist: { name: 'PL Artist A' } },
        { artist: { name: 'PL Artist B' } },
      ]);

      const strategy = getStrategy('deezer_playlist')!;
      const result = await strategy.execute(makeContext({ playlistId: '12345' }));

      expect(mockGetAllPlaylistTracks).toHaveBeenCalledWith('12345');
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'PL Artist A', source: 'deezer-playlist-12345' });
      expect(result.artists[1]).toEqual({ name: 'PL Artist B', source: 'deezer-playlist-12345' });
    });

    it('throws when no Deezer connection', async () => {
      const strategy = getStrategy('deezer_playlist')!;
      await expect(strategy.execute(makePublicContext({ playlistId: '12345' }))).rejects.toThrow(
        'No active Deezer connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deezer_playlists
  // -----------------------------------------------------------------------
  describe('deezer_playlists', () => {
    it('collects unique artists from first 10 playlists', async () => {
      // 12 playlists — only first 10 should be processed
      const playlists = Array.from({ length: 12 }, (_, i) => ({ id: i + 1 }));
      mockGetAllPlaylists.mockResolvedValue(playlists);
      mockGetAllPlaylistTracks.mockResolvedValue([
        { artist: { name: 'Multi Artist' } },
      ]);

      const strategy = getStrategy('deezer_playlists')!;
      const result = await strategy.execute(makeContext());

      // Only first 10 playlists fetched
      expect(mockGetAllPlaylistTracks).toHaveBeenCalledTimes(10);
      // Deduped across playlists — same artist in each
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Multi Artist', source: 'deezer-playlists' });
    });

    it('slices result to config.limit', async () => {
      const playlists = [{ id: 1 }];
      mockGetAllPlaylists.mockResolvedValue(playlists);
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artist: { name: `PL Artist ${i}` },
      }));
      mockGetAllPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('deezer_playlists')!;
      const result = await strategy.execute(makeContext({ limit: 20 }));

      expect(result.artists).toHaveLength(20);
    });

    it('defaults limit to 50', async () => {
      const playlists = [{ id: 1 }];
      mockGetAllPlaylists.mockResolvedValue(playlists);
      const tracks = Array.from({ length: 60 }, (_, i) => ({
        artist: { name: `PL Artist ${i}` },
      }));
      mockGetAllPlaylistTracks.mockResolvedValue(tracks);

      const strategy = getStrategy('deezer_playlists')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(50);
    });

    it('throws when no Deezer connection', async () => {
      const strategy = getStrategy('deezer_playlists')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'No active Deezer connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deezer_chart (public — no auth)
  // -----------------------------------------------------------------------
  describe('deezer_chart', () => {
    it('returns chart artists from public API', async () => {
      mockGetDeezerChartArtists.mockResolvedValue([
        { name: 'Chart 1' },
        { name: 'Chart 2' },
      ]);

      const strategy = getStrategy('deezer_chart')!;
      const result = await strategy.execute(makePublicContext({ limit: 10 }));

      expect(mockGetDeezerChartArtists).toHaveBeenCalledWith(10);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Chart 1', source: 'deezer-chart' });
      expect(result.artists[1]).toEqual({ name: 'Chart 2', source: 'deezer-chart' });
    });

    it('uses default limit of 100', async () => {
      mockGetDeezerChartArtists.mockResolvedValue([]);

      const strategy = getStrategy('deezer_chart')!;
      await strategy.execute(makePublicContext());

      expect(mockGetDeezerChartArtists).toHaveBeenCalledWith(100);
    });
  });

  // -----------------------------------------------------------------------
  // deezer_genre (public — no auth)
  // -----------------------------------------------------------------------
  describe('deezer_genre', () => {
    it('returns artists for a genre from public API', async () => {
      mockGetDeezerGenreArtists.mockResolvedValue([
        { name: 'Genre Artist 1' },
      ]);

      const strategy = getStrategy('deezer_genre')!;
      const result = await strategy.execute(makePublicContext({ genreId: '132', limit: 20 }));

      expect(mockGetDeezerGenreArtists).toHaveBeenCalledWith('132', 20);
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Genre Artist 1', source: 'deezer-genre-132' });
    });

    it('uses default limit of 100', async () => {
      mockGetDeezerGenreArtists.mockResolvedValue([]);

      const strategy = getStrategy('deezer_genre')!;
      await strategy.execute(makePublicContext({ genreId: '1' }));

      expect(mockGetDeezerGenreArtists).toHaveBeenCalledWith('1', 100);
    });

    it('throws when genreId is missing', async () => {
      const strategy = getStrategy('deezer_genre')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'Genre ID is required',
      );
    });
  });

  // -----------------------------------------------------------------------
  // deezer_search (public — no auth)
  // -----------------------------------------------------------------------
  describe('deezer_search', () => {
    it('returns artists matching a search query', async () => {
      mockSearchDeezerArtists.mockResolvedValue([
        { name: 'Search Result 1' },
        { name: 'Search Result 2' },
      ]);

      const strategy = getStrategy('deezer_search')!;
      const result = await strategy.execute(makePublicContext({ query: 'rock', limit: 10 }));

      expect(mockSearchDeezerArtists).toHaveBeenCalledWith('rock', 10);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Search Result 1', source: 'deezer-search' });
      expect(result.artists[1]).toEqual({ name: 'Search Result 2', source: 'deezer-search' });
    });

    it('uses default limit of 25', async () => {
      mockSearchDeezerArtists.mockResolvedValue([]);

      const strategy = getStrategy('deezer_search')!;
      await strategy.execute(makePublicContext({ query: 'jazz' }));

      expect(mockSearchDeezerArtists).toHaveBeenCalledWith('jazz', 25);
    });

    it('throws when query is missing', async () => {
      const strategy = getStrategy('deezer_search')!;
      await expect(strategy.execute(makePublicContext())).rejects.toThrow(
        'Search query is required',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Registration completeness
  // -----------------------------------------------------------------------
  describe('registration', () => {
    it('registers all 8 Deezer strategy types', () => {
      const types = [
        'deezer_favorites',
        'deezer_history',
        'deezer_flow',
        'deezer_playlist',
        'deezer_playlists',
        'deezer_chart',
        'deezer_genre',
        'deezer_search',
      ] as const;

      for (const type of types) {
        expect(getStrategy(type), `strategy for ${type} should be registered`).toBeDefined();
      }
    });
  });
});
