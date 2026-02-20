import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTopArtists = vi.fn();
const mockGetTagTopArtists = vi.fn();
const mockGetGeoTopArtists = vi.fn();
const mockGetUserTopArtists = vi.fn();
const mockGetSimilarArtists = vi.fn();

vi.mock('../../../src/services/lastfm.js', () => ({
  LastfmService: function MockLastfmService() {
    return {
      getTopArtists: mockGetTopArtists,
      getTagTopArtists: mockGetTagTopArtists,
      getGeoTopArtists: mockGetGeoTopArtists,
      getUserTopArtists: mockGetUserTopArtists,
      getSimilarArtists: mockGetSimilarArtists,
    };
  },
}));

// isLastFMConfig type guard — always returns true unless the test overrides
vi.mock('../../../src/types/connections.js', () => ({
  isLastFMConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/lastfm.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with a valid Last.fm connection (with username). */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['lastfm', { id: 1, type: 'lastfm', config: { apiKey: 'test-key', username: 'testuser' } }],
    ]),
  };
}

/** Build a context with a Last.fm connection that has NO username. */
function makeContextNoUsername(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['lastfm', { id: 1, type: 'lastfm', config: { apiKey: 'test-key' } }],
    ]),
  };
}

/** Build a context with NO Last.fm connection. */
function makeContextNoLastfm(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Last.fm strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // lastfm_chart
  // -----------------------------------------------------------------------
  describe('lastfm_chart', () => {
    it('returns top chart artists with mbid', async () => {
      mockGetTopArtists.mockResolvedValue({
        artists: [
          { name: 'Artist A', mbid: 'mbid-a' },
          { name: 'Artist B', mbid: 'mbid-b' },
        ],
      });

      const strategy = getStrategy('lastfm_chart')!;
      const result = await strategy.execute(makeContext({ limit: 25 }));

      expect(mockGetTopArtists).toHaveBeenCalledWith(25);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', mbid: 'mbid-a', source: 'lastfm-chart' });
      expect(result.artists[1]).toEqual({ name: 'Artist B', mbid: 'mbid-b', source: 'lastfm-chart' });
      expect(result.albums).toHaveLength(0);
    });

    it('uses default limit of 50', async () => {
      mockGetTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('lastfm_chart')!;
      await strategy.execute(makeContext());

      expect(mockGetTopArtists).toHaveBeenCalledWith(50);
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('lastfm_chart')!;
      await expect(strategy.execute(makeContextNoLastfm())).rejects.toThrow(
        'No active Last.fm connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // lastfm_tag
  // -----------------------------------------------------------------------
  describe('lastfm_tag', () => {
    it('returns top artists for a tag', async () => {
      mockGetTagTopArtists.mockResolvedValue({
        artists: [
          { name: 'Rock Artist', mbid: 'mbid-r' },
        ],
      });

      const strategy = getStrategy('lastfm_tag')!;
      const result = await strategy.execute(makeContext({ tag: 'rock', limit: 10 }));

      expect(mockGetTagTopArtists).toHaveBeenCalledWith('rock', 10);
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Rock Artist', mbid: 'mbid-r', source: 'lastfm-tag-rock' });
    });

    it('uses default limit of 50', async () => {
      mockGetTagTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('lastfm_tag')!;
      await strategy.execute(makeContext({ tag: 'jazz' }));

      expect(mockGetTagTopArtists).toHaveBeenCalledWith('jazz', 50);
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('lastfm_tag')!;
      await expect(strategy.execute(makeContextNoLastfm({ tag: 'rock' }))).rejects.toThrow(
        'No active Last.fm connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // lastfm_geo
  // -----------------------------------------------------------------------
  describe('lastfm_geo', () => {
    it('returns top artists for a country', async () => {
      mockGetGeoTopArtists.mockResolvedValue({
        artists: [
          { name: 'German Artist', mbid: 'mbid-g' },
        ],
      });

      const strategy = getStrategy('lastfm_geo')!;
      const result = await strategy.execute(makeContext({ country: 'germany', limit: 20 }));

      expect(mockGetGeoTopArtists).toHaveBeenCalledWith('germany', 20);
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'German Artist', mbid: 'mbid-g', source: 'lastfm-geo-germany' });
    });

    it('uses default limit of 50', async () => {
      mockGetGeoTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('lastfm_geo')!;
      await strategy.execute(makeContext({ country: 'france' }));

      expect(mockGetGeoTopArtists).toHaveBeenCalledWith('france', 50);
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('lastfm_geo')!;
      await expect(strategy.execute(makeContextNoLastfm({ country: 'uk' }))).rejects.toThrow(
        'No active Last.fm connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // lastfm_library
  // -----------------------------------------------------------------------
  describe('lastfm_library', () => {
    it('returns user top artists with period and username', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [
          { name: 'Fav Artist', mbid: 'mbid-f' },
        ],
      });

      const strategy = getStrategy('lastfm_library')!;
      const result = await strategy.execute(makeContext({ period: '3month', limit: 30 }));

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('testuser', '3month', 30);
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Fav Artist', mbid: 'mbid-f', source: 'lastfm-library-3month' });
    });

    it('uses default period "overall" and limit 100', async () => {
      mockGetUserTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('lastfm_library')!;
      await strategy.execute(makeContext());

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('testuser', 'overall', 100);
    });

    it('throws when username is missing', async () => {
      const strategy = getStrategy('lastfm_library')!;
      await expect(strategy.execute(makeContextNoUsername())).rejects.toThrow(
        'Last.fm connection is missing username',
      );
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('lastfm_library')!;
      await expect(strategy.execute(makeContextNoLastfm())).rejects.toThrow(
        'No active Last.fm connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // lastfm_similar
  // -----------------------------------------------------------------------
  describe('lastfm_similar', () => {
    it('gets similar artists from user top artists as seeds', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [
          { name: 'Seed 1' },
          { name: 'Seed 2' },
        ],
      });
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Similar A', mbid: 'mbid-sa', match: 0.9 },
          { name: 'Similar B', mbid: 'mbid-sb', match: 0.7 },
        ])
        .mockResolvedValueOnce([
          { name: 'Similar A', mbid: 'mbid-sa', match: 0.8 }, // duplicate
          { name: 'Similar C', mbid: 'mbid-sc', match: 0.6 },
        ]);

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext({
        topArtistsLimit: 2,
        similarPerArtist: 5,
        period: '6month',
        limit: 10,
      }));

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('testuser', '6month', 2);
      expect(mockGetSimilarArtists).toHaveBeenCalledTimes(2);
      expect(mockGetSimilarArtists).toHaveBeenCalledWith('Seed 1', 5);
      expect(mockGetSimilarArtists).toHaveBeenCalledWith('Seed 2', 5);

      // Similar A appears from 2 seeds → seedCount=2, should be first
      expect(result.artists).toHaveLength(3);
      expect(result.artists[0].name).toBe('Similar A');
      expect(result.artists[0].source).toBe('lastfm-similar-6month');
      // Similar B and C each have seedCount=1, B has higher match (0.7 > 0.6)
      expect(result.artists[1].name).toBe('Similar B');
      expect(result.artists[2].name).toBe('Similar C');
    });

    it('deduplicates by lowercase name and keeps highest match', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [{ name: 'Seed' }],
      });
      mockGetSimilarArtists.mockResolvedValue([
        { name: 'Artist X', mbid: 'mbid-x', match: 0.5 },
        { name: 'artist x', mbid: 'mbid-x2', match: 0.9 }, // same artist, different case
      ]);

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext());

      // Should only have one entry for "artist x" (case-insensitive dedup)
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Artist X'); // first occurrence wins for name
    });

    it('sorts by seedCount DESC, then match DESC', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [{ name: 'Seed 1' }, { name: 'Seed 2' }, { name: 'Seed 3' }],
      });
      // All three seeds return "Popular" (seedCount=3, match=0.5)
      // Seed 1 and 2 return "Medium" (seedCount=2, match=0.8)
      // Only Seed 1 returns "Niche High" (seedCount=1, match=0.95) and "Niche Low" (seedCount=1, match=0.1)
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Popular', match: 0.5 },
          { name: 'Medium', match: 0.8 },
          { name: 'Niche High', match: 0.95 },
          { name: 'Niche Low', match: 0.1 },
        ])
        .mockResolvedValueOnce([
          { name: 'Popular', match: 0.4 },
          { name: 'Medium', match: 0.6 },
        ])
        .mockResolvedValueOnce([
          { name: 'Popular', match: 0.3 },
        ]);

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext({ topArtistsLimit: 3, similarPerArtist: 5 }));

      expect(result.artists.map(a => a.name)).toEqual([
        'Popular',    // seedCount=3
        'Medium',     // seedCount=2
        'Niche High', // seedCount=1, match=0.95
        'Niche Low',  // seedCount=1, match=0.1
      ]);
    });

    it('slices results to totalLimit', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [{ name: 'Seed' }],
      });
      mockGetSimilarArtists.mockResolvedValue([
        { name: 'A', match: 0.9 },
        { name: 'B', match: 0.8 },
        { name: 'C', match: 0.7 },
        { name: 'D', match: 0.6 },
        { name: 'E', match: 0.5 },
      ]);

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext({ limit: 3 }));

      expect(result.artists).toHaveLength(3);
    });

    it('skips seeds that fail and continues', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [
          { name: 'Good Seed' },
          { name: 'Bad Seed' },
          { name: 'Another Good Seed' },
        ],
      });
      mockGetSimilarArtists
        .mockResolvedValueOnce([{ name: 'Result A', match: 0.8 }])
        .mockRejectedValueOnce(new Error('API rate limited'))
        .mockResolvedValueOnce([{ name: 'Result B', match: 0.7 }]);

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext());

      // Should still get results from the non-failing seeds
      expect(result.artists).toHaveLength(2);
      expect(result.artists.map(a => a.name)).toEqual(['Result A', 'Result B']);
    });

    it('uses default config values', async () => {
      mockGetUserTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('lastfm_similar')!;
      await strategy.execute(makeContext());

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('testuser', 'overall', 20);
    });

    it('throws when username is missing', async () => {
      const strategy = getStrategy('lastfm_similar')!;
      await expect(strategy.execute(makeContextNoUsername())).rejects.toThrow(
        'Last.fm connection is missing username',
      );
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('lastfm_similar')!;
      await expect(strategy.execute(makeContextNoLastfm())).rejects.toThrow(
        'No active Last.fm connection',
      );
    });

    it('returns empty when all seeds fail', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [{ name: 'Seed 1' }, { name: 'Seed 2' }],
      });
      mockGetSimilarArtists.mockRejectedValue(new Error('API error'));

      const strategy = getStrategy('lastfm_similar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Registration completeness
  // -----------------------------------------------------------------------
  describe('registration', () => {
    it('registers all 5 Last.fm strategy types', () => {
      const types = [
        'lastfm_chart',
        'lastfm_tag',
        'lastfm_geo',
        'lastfm_library',
        'lastfm_similar',
      ] as const;

      for (const type of types) {
        expect(getStrategy(type), `strategy for ${type} should be registered`).toBeDefined();
      }
    });
  });
});
