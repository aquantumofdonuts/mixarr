import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAllFollowedArtists = vi.fn();

vi.mock('../../../src/services/spotify.js', () => ({
  SpotifyService: function MockSpotifyService() {
    return {
      getAllFollowedArtists: mockGetAllFollowedArtists,
    };
  },
}));

const mockGetTopArtists = vi.fn();

vi.mock('../../../src/services/lastfm.js', () => ({
  LastfmService: function MockLastfmService() {
    return {
      getTopArtists: mockGetTopArtists,
    };
  },
}));

const mockLoadSettings = vi.fn();
const mockGetRecommendationsWithStrategy = vi.fn();

vi.mock('../../../src/services/ai.js', () => ({
  AIService: function MockAIService() {
    return {
      loadSettings: mockLoadSettings,
      getRecommendationsWithStrategy: mockGetRecommendationsWithStrategy,
    };
  },
}));

// Type guards — always return true unless overridden per-test
vi.mock('../../../src/types/connections.js', () => ({
  isSpotifyConfig: vi.fn().mockReturnValue(true),
  isLastFMConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/ai.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a StrategyContext with both Spotify and Last.fm connections. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['spotify', {
        id: 1,
        type: 'spotify',
        config: { clientId: 'cid', clientSecret: 'cs', accessToken: 'at', refreshToken: 'rt' },
      }],
      ['lastfm', {
        id: 2,
        type: 'lastfm',
        config: { apiKey: 'test-key' },
      }],
    ]),
  };
}

/** Build a context with only a Spotify connection. */
function makeSpotifyContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['spotify', {
        id: 1,
        type: 'spotify',
        config: { clientId: 'cid', clientSecret: 'cs', accessToken: 'at', refreshToken: 'rt' },
      }],
    ]),
  };
}

/** Build a context with only a Last.fm connection. */
function makeLastfmContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['lastfm', {
        id: 2,
        type: 'lastfm',
        config: { apiKey: 'test-key' },
      }],
    ]),
  };
}

/** Build a context with NO connections. */
function makeEmptyContext(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AI recommendation strategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Spotify source
  // -----------------------------------------------------------------------
  describe('source = spotify', () => {
    it('fetches followed artists and returns AI recommendations', async () => {
      mockGetAllFollowedArtists.mockResolvedValue([
        { name: 'Seed A' },
        { name: 'Seed B' },
      ]);
      mockGetRecommendationsWithStrategy.mockResolvedValue([
        { name: 'Rec 1' },
        { name: 'Rec 2' },
      ]);

      const strategy = getStrategy('ai_recommendation')!;
      const result = await strategy.execute(
        makeContext({ source: 'spotify', strategy: 'similar', limit: 10 }),
      );

      expect(mockGetAllFollowedArtists).toHaveBeenCalled();
      expect(mockLoadSettings).toHaveBeenCalled();
      expect(mockGetRecommendationsWithStrategy).toHaveBeenCalledWith(
        ['Seed A', 'Seed B'],
        'similar',
        10,
      );
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Rec 1', source: 'ai-spotify-similar' });
      expect(result.artists[1]).toEqual({ name: 'Rec 2', source: 'ai-spotify-similar' });
      expect(result.albums).toHaveLength(0);
    });

    it('takes first 20 followed artists as seeds', async () => {
      const followed = Array.from({ length: 30 }, (_, i) => ({ name: `Artist ${i}` }));
      mockGetAllFollowedArtists.mockResolvedValue(followed);
      mockGetRecommendationsWithStrategy.mockResolvedValue([]);

      const strategy = getStrategy('ai_recommendation')!;
      await strategy.execute(makeContext({ source: 'spotify' }));

      const seeds = mockGetRecommendationsWithStrategy.mock.calls[0][0] as string[];
      expect(seeds).toHaveLength(20);
      expect(seeds[0]).toBe('Artist 0');
      expect(seeds[19]).toBe('Artist 19');
    });

    it('throws if no Spotify connection', async () => {
      const strategy = getStrategy('ai_recommendation')!;
      await expect(
        strategy.execute(makeLastfmContext({ source: 'spotify' })),
      ).rejects.toThrow('No active Spotify connection');
    });

    it('throws if Spotify returns no artists', async () => {
      mockGetAllFollowedArtists.mockResolvedValue([]);

      const strategy = getStrategy('ai_recommendation')!;
      await expect(
        strategy.execute(makeContext({ source: 'spotify' })),
      ).rejects.toThrow('No artists found in spotify library');
    });
  });

  // -----------------------------------------------------------------------
  // Last.fm source
  // -----------------------------------------------------------------------
  describe('source = lastfm', () => {
    it('fetches top artists and returns AI recommendations', async () => {
      mockGetTopArtists.mockResolvedValue({
        artists: [
          { name: 'LFM Seed A' },
          { name: 'LFM Seed B' },
        ],
      });
      mockGetRecommendationsWithStrategy.mockResolvedValue([
        { name: 'LFM Rec 1' },
      ]);

      const strategy = getStrategy('ai_recommendation')!;
      const result = await strategy.execute(
        makeContext({ source: 'lastfm', strategy: 'discovery', limit: 5 }),
      );

      expect(mockGetTopArtists).toHaveBeenCalledWith(20);
      expect(mockGetRecommendationsWithStrategy).toHaveBeenCalledWith(
        ['LFM Seed A', 'LFM Seed B'],
        'discovery',
        5,
      );
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'LFM Rec 1', source: 'ai-lastfm-discovery' });
    });

    it('throws if no Last.fm connection', async () => {
      const strategy = getStrategy('ai_recommendation')!;
      await expect(
        strategy.execute(makeSpotifyContext({ source: 'lastfm' })),
      ).rejects.toThrow('No active Last.fm connection');
    });

    it('throws if Last.fm returns no artists', async () => {
      mockGetTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('ai_recommendation')!;
      await expect(
        strategy.execute(makeContext({ source: 'lastfm' })),
      ).rejects.toThrow('No artists found in lastfm library');
    });
  });

  // -----------------------------------------------------------------------
  // Defaults
  // -----------------------------------------------------------------------
  describe('defaults', () => {
    it('uses "similar" as default strategy', async () => {
      mockGetAllFollowedArtists.mockResolvedValue([{ name: 'X' }]);
      mockGetRecommendationsWithStrategy.mockResolvedValue([]);

      const strategy = getStrategy('ai_recommendation')!;
      await strategy.execute(makeContext({ source: 'spotify' }));

      expect(mockGetRecommendationsWithStrategy).toHaveBeenCalledWith(
        ['X'],
        'similar',
        20,
      );
    });

    it('uses 20 as default limit', async () => {
      mockGetTopArtists.mockResolvedValue({ artists: [{ name: 'Y' }] });
      mockGetRecommendationsWithStrategy.mockResolvedValue([]);

      const strategy = getStrategy('ai_recommendation')!;
      await strategy.execute(makeContext({ source: 'lastfm' }));

      expect(mockGetRecommendationsWithStrategy).toHaveBeenCalledWith(
        ['Y'],
        'similar',
        20,
      );
    });
  });
});
