import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetLabelReleases = vi.fn();
const mockSearchByStyle = vi.fn();

vi.mock('../../../src/services/discogs.js', () => ({
  DiscogsService: function MockDiscogsService(_token: string) {
    return {
      getLabelReleases: mockGetLabelReleases,
      searchByStyle: mockSearchByStyle,
    };
  },
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/discogs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a StrategyContext with a valid Discogs connection. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['discogs', { id: 1, type: 'discogs', config: { token: 'test-token' } }],
    ]),
  };
}

/** Build a context with NO Discogs connection. */
function makeContextNoDiscogs(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

/** Build a context with a Discogs connection but no token. */
function makeContextNoToken(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['discogs', { id: 1, type: 'discogs', config: {} }],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Discogs strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // discogs_label
  // -----------------------------------------------------------------------
  describe('discogs_label', () => {
    it('returns unique artists from label releases', async () => {
      mockGetLabelReleases.mockResolvedValue({
        releases: [
          { artist: 'Artist A' },
          { artist: 'Artist B' },
          { artist: 'Artist A' }, // duplicate
        ],
      });

      const strategy = getStrategy('discogs_label')!;
      const result = await strategy.execute(makeContext({ labelId: 42 }));

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', source: 'discogs-label-42' });
      expect(result.artists[1]).toEqual({ name: 'Artist B', source: 'discogs-label-42' });
      expect(result.albums).toHaveLength(0);
    });

    it('filters out "Various" artists', async () => {
      mockGetLabelReleases.mockResolvedValue({
        releases: [
          { artist: 'Various' },
          { artist: 'Artist C' },
        ],
      });

      const strategy = getStrategy('discogs_label')!;
      const result = await strategy.execute(makeContext({ labelId: 10 }));

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Artist C');
    });

    it('respects config.limit', async () => {
      const releases = Array.from({ length: 100 }, (_, i) => ({
        artist: `Artist ${i}`,
      }));
      mockGetLabelReleases.mockResolvedValue({ releases });

      const strategy = getStrategy('discogs_label')!;
      const result = await strategy.execute(makeContext({ labelId: 1, limit: 10 }));

      // At most 10 unique artists from first 10 releases
      expect(result.artists.length).toBeLessThanOrEqual(10);
    });

    it('throws if no Discogs connection', async () => {
      const strategy = getStrategy('discogs_label')!;
      await expect(
        strategy.execute(makeContextNoDiscogs({ labelId: 1 })),
      ).rejects.toThrow('No active Discogs connection');
    });

    it('throws if Discogs token is missing', async () => {
      const strategy = getStrategy('discogs_label')!;
      await expect(
        strategy.execute(makeContextNoToken({ labelId: 1 })),
      ).rejects.toThrow('Discogs token not configured');
    });

    it('throws if labelId is missing', async () => {
      const strategy = getStrategy('discogs_label')!;
      await expect(
        strategy.execute(makeContext()),
      ).rejects.toThrow('Label ID is required');
    });
  });

  // -----------------------------------------------------------------------
  // discogs_style
  // -----------------------------------------------------------------------
  describe('discogs_style', () => {
    it('returns unique artists parsed from "Artist - Album" titles', async () => {
      mockSearchByStyle.mockResolvedValue({
        results: [
          { title: 'Artist X - Great Album' },
          { title: 'Artist Y - Another Album' },
          { title: 'Artist X - Second Album' }, // duplicate artist
        ],
      });

      const strategy = getStrategy('discogs_style')!;
      const result = await strategy.execute(makeContext({ style: 'ambient' }));

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist X', source: 'discogs-style-ambient' });
      expect(result.artists[1]).toEqual({ name: 'Artist Y', source: 'discogs-style-ambient' });
      expect(result.albums).toHaveLength(0);
    });

    it('filters out "various" and "various artists" (case insensitive)', async () => {
      mockSearchByStyle.mockResolvedValue({
        results: [
          { title: 'Various - Compilation' },
          { title: 'Various Artists - Mix' },
          { title: 'VARIOUS - Big Set' },
          { title: 'Real Artist - Real Album' },
        ],
      });

      const strategy = getStrategy('discogs_style')!;
      const result = await strategy.execute(makeContext({ style: 'techno' }));

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Real Artist');
    });

    it('handles titles without " - " separator', async () => {
      mockSearchByStyle.mockResolvedValue({
        results: [
          { title: 'JustAnAlbumTitle' },
        ],
      });

      const strategy = getStrategy('discogs_style')!;
      const result = await strategy.execute(makeContext({ style: 'jazz' }));

      // The whole title becomes the "artist" name since there is no separator
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('JustAnAlbumTitle');
    });

    it('throws if no Discogs connection', async () => {
      const strategy = getStrategy('discogs_style')!;
      await expect(
        strategy.execute(makeContextNoDiscogs({ style: 'ambient' })),
      ).rejects.toThrow('No active Discogs connection');
    });

    it('throws if Discogs token is missing', async () => {
      const strategy = getStrategy('discogs_style')!;
      await expect(
        strategy.execute(makeContextNoToken({ style: 'ambient' })),
      ).rejects.toThrow('Discogs token not configured');
    });

    it('throws if style is missing', async () => {
      const strategy = getStrategy('discogs_style')!;
      await expect(
        strategy.execute(makeContext()),
      ).rejects.toThrow('Style is required');
    });

    it('respects config.limit', async () => {
      const results = Array.from({ length: 100 }, (_, i) => ({
        title: `Artist ${i} - Album ${i}`,
      }));
      mockSearchByStyle.mockResolvedValue({ results });

      const strategy = getStrategy('discogs_style')!;
      const result = await strategy.execute(makeContext({ style: 'funk', limit: 5 }));

      expect(result.artists.length).toBeLessThanOrEqual(5);
    });
  });
});
