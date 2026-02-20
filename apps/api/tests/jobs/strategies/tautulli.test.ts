import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks — TautulliService (dynamic import)
// ---------------------------------------------------------------------------

const mockGetTopArtists = vi.fn();

vi.mock('../../../src/services/tautulli.js', () => ({
  TautulliService: function MockTautulliService() {
    return { getTopArtists: mockGetTopArtists };
  },
}));

// ---------------------------------------------------------------------------
// Mocks — LastfmService
// ---------------------------------------------------------------------------

const mockGetSimilarArtists = vi.fn();

vi.mock('../../../src/services/lastfm.js', () => ({
  LastfmService: function MockLastfmService() {
    return { getSimilarArtists: mockGetSimilarArtists };
  },
}));

// ---------------------------------------------------------------------------
// Mocks — type guards
// ---------------------------------------------------------------------------

vi.mock('../../../src/types/connections.js', () => ({
  isLastFMConfig: vi.fn().mockReturnValue(true),
  isTautulliConfig: vi.fn().mockReturnValue(true),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/tautulli.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with valid Tautulli + Last.fm connections. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['tautulli', {
        id: 1,
        type: 'tautulli',
        config: {
          tautulliUrl: 'http://tautulli:8181',
          tautulliApiKey: 'tau-key',
          plexUserId: 1,
          plexLibraryId: 2,
        },
      }],
      ['lastfm', {
        id: 2,
        type: 'lastfm',
        config: { apiKey: 'lfm-key' },
      }],
    ]),
  };
}

/** Build a context with NO Tautulli connection (Last.fm only). */
function makeContextNoTautulli(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['lastfm', { id: 2, type: 'lastfm', config: { apiKey: 'lfm-key' } }],
    ]),
  };
}

/** Build a context with NO Last.fm connection (Tautulli only). */
function makeContextNoLastfm(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['tautulli', {
        id: 1,
        type: 'tautulli',
        config: {
          tautulliUrl: 'http://tautulli:8181',
          tautulliApiKey: 'tau-key',
          plexUserId: 1,
          plexLibraryId: 2,
        },
      }],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Tautulli strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('tautulli_similar', () => {
    it('returns similar artists from top listening history', async () => {
      mockGetTopArtists.mockResolvedValue([
        { name: 'Seed A' },
        { name: 'Seed B' },
      ]);
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Similar 1', mbid: 'mbid-1', match: 0.9 },
          { name: 'Similar 2', mbid: 'mbid-2', match: 0.7 },
        ])
        .mockResolvedValueOnce([
          { name: 'Similar 1', mbid: 'mbid-1', match: 0.8 }, // duplicate
          { name: 'Similar 3', mbid: 'mbid-3', match: 0.6 },
        ]);

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(3);
      // Similar 1 appears from 2 seeds → seedCount=2, highest match=0.9
      expect(result.artists[0]).toEqual({
        name: 'Similar 1',
        mbid: 'mbid-1',
        source: 'tautulli-similar-month',
      });
      expect(result.albums).toHaveLength(0);
    });

    it('uses default config values', async () => {
      mockGetTopArtists.mockResolvedValue([{ name: 'Seed' }]);
      mockGetSimilarArtists.mockResolvedValue([
        { name: 'Similar', mbid: 'mbid', match: 0.5 },
      ]);

      const strategy = getStrategy('tautulli_similar')!;
      await strategy.execute(makeContext());

      // Default period=month, seedLimit=10
      expect(mockGetTopArtists).toHaveBeenCalledWith(
        expect.objectContaining({
          tautulliUrl: 'http://tautulli:8181',
          tautulliApiKey: 'tau-key',
        }),
        { period: 'month', limit: 10 },
      );
      // Default similarPerSeed=5
      expect(mockGetSimilarArtists).toHaveBeenCalledWith('Seed', 5);
    });

    it('respects custom config values', async () => {
      mockGetTopArtists.mockResolvedValue([{ name: 'Seed' }]);
      mockGetSimilarArtists.mockResolvedValue([]);

      const strategy = getStrategy('tautulli_similar')!;
      await strategy.execute(makeContext({
        period: 'year',
        seedLimit: 5,
        similarPerSeed: 10,
        limit: 25,
        minMatchCount: 2,
      }));

      expect(mockGetTopArtists).toHaveBeenCalledWith(
        expect.anything(),
        { period: 'year', limit: 5 },
      );
      expect(mockGetSimilarArtists).toHaveBeenCalledWith('Seed', 10);
    });

    it('uses period in source string', async () => {
      mockGetTopArtists.mockResolvedValue([{ name: 'Seed' }]);
      mockGetSimilarArtists.mockResolvedValue([
        { name: 'Similar', mbid: 'mbid', match: 0.5 },
      ]);

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext({ period: 'year' }));

      expect(result.artists[0].source).toBe('tautulli-similar-year');
    });

    it('filters by minMatchCount', async () => {
      mockGetTopArtists.mockResolvedValue([
        { name: 'Seed A' },
        { name: 'Seed B' },
      ]);
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Common', mbid: 'mbid-c', match: 0.9 },
          { name: 'Unique A', mbid: 'mbid-a', match: 0.7 },
        ])
        .mockResolvedValueOnce([
          { name: 'Common', mbid: 'mbid-c', match: 0.8 },
          { name: 'Unique B', mbid: 'mbid-b', match: 0.6 },
        ]);

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext({ minMatchCount: 2 }));

      // Only "Common" has seedCount >= 2
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Common');
    });

    it('sorts by seedCount DESC then match DESC', async () => {
      mockGetTopArtists.mockResolvedValue([
        { name: 'Seed A' },
        { name: 'Seed B' },
        { name: 'Seed C' },
      ]);
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Multi', mbid: 'mbid-m', match: 0.5 },
          { name: 'HighMatch', mbid: 'mbid-h', match: 0.99 },
        ])
        .mockResolvedValueOnce([
          { name: 'Multi', mbid: 'mbid-m', match: 0.6 },
        ])
        .mockResolvedValueOnce([
          { name: 'Multi', mbid: 'mbid-m', match: 0.4 },
        ]);

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext());

      // Multi has seedCount=3, HighMatch has seedCount=1
      expect(result.artists[0].name).toBe('Multi');
      expect(result.artists[1].name).toBe('HighMatch');
    });

    it('respects totalLimit', async () => {
      mockGetTopArtists.mockResolvedValue([{ name: 'Seed' }]);
      mockGetSimilarArtists.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({
          name: `Similar ${i}`,
          mbid: `mbid-${i}`,
          match: 0.5,
        })),
      );

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext({ limit: 5 }));

      expect(result.artists).toHaveLength(5);
    });

    it('deduplicates by lowercase name and keeps highest match', async () => {
      mockGetTopArtists.mockResolvedValue([{ name: 'Seed' }]);
      mockGetSimilarArtists.mockResolvedValue([
        { name: 'Artist One', mbid: 'mbid-1', match: 0.5 },
        { name: 'artist one', mbid: 'mbid-1b', match: 0.9 }, // same artist, higher match
      ]);

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      // First occurrence name kept, but match updated to higher value
      expect(result.artists[0].name).toBe('Artist One');
    });

    it('throws when no Tautulli connection', async () => {
      const strategy = getStrategy('tautulli_similar')!;
      await expect(strategy.execute(makeContextNoTautulli())).rejects.toThrow(
        'No active Tautulli connection. Please add a Tautulli connection first.',
      );
    });

    it('throws when no Last.fm connection', async () => {
      const strategy = getStrategy('tautulli_similar')!;
      await expect(strategy.execute(makeContextNoLastfm())).rejects.toThrow(
        'No active Last.fm connection. Required for similar artist lookup.',
      );
    });

    it('throws when no listening history', async () => {
      mockGetTopArtists.mockResolvedValue([]);

      const strategy = getStrategy('tautulli_similar')!;
      await expect(strategy.execute(makeContext())).rejects.toThrow(
        'No listening history found for Plex user (period: month)',
      );
    });

    it('skips seeds that fail API calls', async () => {
      mockGetTopArtists.mockResolvedValue([
        { name: 'Good Seed' },
        { name: 'Bad Seed' },
      ]);
      mockGetSimilarArtists
        .mockResolvedValueOnce([
          { name: 'Similar', mbid: 'mbid-1', match: 0.8 },
        ])
        .mockRejectedValueOnce(new Error('API error'));

      const strategy = getStrategy('tautulli_similar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Similar');
    });
  });
});
