import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetTagReleases = vi.fn();

vi.mock('../../../src/services/bandcamp.js', () => ({
  BandcampService: function MockBandcampService() {
    return {
      getTagReleases: mockGetTagReleases,
    };
  },
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/bandcamp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext (no connections needed for Bandcamp). */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Bandcamp strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // bandcamp_tag
  // -----------------------------------------------------------------------
  describe('bandcamp_tag', () => {
    it('returns unique artists from tag releases', async () => {
      mockGetTagReleases.mockResolvedValue({
        releases: [
          { artistName: 'Artist A', title: 'Album 1', type: 'a' },
          { artistName: 'Artist B', title: 'Album 2', type: 'a' },
          { artistName: 'Artist A', title: 'Album 3', type: 'a' }, // duplicate
        ],
      });

      const strategy = getStrategy('bandcamp_tag')!;
      const result = await strategy.execute(makeContext({ tag: 'electronic' }));

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', source: 'bandcamp-tag-electronic' });
      expect(result.artists[1]).toEqual({ name: 'Artist B', source: 'bandcamp-tag-electronic' });
      expect(result.albums).toHaveLength(0);
    });

    it('calls getTagReleases with the configured sort (default pop)', async () => {
      mockGetTagReleases.mockResolvedValue({ releases: [] });

      const strategy = getStrategy('bandcamp_tag')!;
      await strategy.execute(makeContext({ tag: 'jazz' }));

      expect(mockGetTagReleases).toHaveBeenCalledWith('jazz', 'pop', 0);
    });

    it('uses config.sort when provided', async () => {
      mockGetTagReleases.mockResolvedValue({ releases: [] });

      const strategy = getStrategy('bandcamp_tag')!;
      await strategy.execute(makeContext({ tag: 'jazz', sort: 'date' }));

      expect(mockGetTagReleases).toHaveBeenCalledWith('jazz', 'date', 0);
    });

    it('respects config.limit', async () => {
      const releases = Array.from({ length: 100 }, (_, i) => ({
        artistName: `Artist ${i}`,
        title: `Album ${i}`,
        type: 'a',
      }));
      mockGetTagReleases.mockResolvedValue({ releases });

      const strategy = getStrategy('bandcamp_tag')!;
      const result = await strategy.execute(makeContext({ tag: 'rock', limit: 5 }));

      expect(result.artists.length).toBeLessThanOrEqual(5);
    });

    it('throws if tag is missing', async () => {
      const strategy = getStrategy('bandcamp_tag')!;
      await expect(
        strategy.execute(makeContext()),
      ).rejects.toThrow('Tag is required');
    });

    it('skips releases without an artistName', async () => {
      mockGetTagReleases.mockResolvedValue({
        releases: [
          { artistName: '', title: 'No Artist', type: 'a' },
          { artistName: 'Real Artist', title: 'Real Album', type: 'a' },
        ],
      });

      const strategy = getStrategy('bandcamp_tag')!;
      const result = await strategy.execute(makeContext({ tag: 'ambient' }));

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Real Artist');
    });
  });

  // -----------------------------------------------------------------------
  // bandcamp_new
  // -----------------------------------------------------------------------
  describe('bandcamp_new', () => {
    it('returns albums sorted by date', async () => {
      mockGetTagReleases.mockResolvedValue({
        releases: [
          { title: 'New Album', artistName: 'Artist A', type: 'a' },
          { title: 'New Single', artistName: 'Artist B', type: 't' },
        ],
      });

      const strategy = getStrategy('bandcamp_new')!;
      const result = await strategy.execute(makeContext({ tag: 'electronic' }));

      expect(mockGetTagReleases).toHaveBeenCalledWith('electronic', 'date', 0);
      expect(result.artists).toHaveLength(0);
      expect(result.albums).toHaveLength(2);
      expect(result.albums[0]).toEqual({
        albumName: 'New Album',
        artistName: 'Artist A',
        releaseType: 'album',
        source: 'bandcamp-new-electronic',
      });
      expect(result.albums[1]).toEqual({
        albumName: 'New Single',
        artistName: 'Artist B',
        releaseType: 'single',
        source: 'bandcamp-new-electronic',
      });
    });

    it('defaults tag to "all"', async () => {
      mockGetTagReleases.mockResolvedValue({ releases: [] });

      const strategy = getStrategy('bandcamp_new')!;
      await strategy.execute(makeContext());

      expect(mockGetTagReleases).toHaveBeenCalledWith('all', 'date', 0);
    });

    it('respects config.limit', async () => {
      const releases = Array.from({ length: 100 }, (_, i) => ({
        title: `Album ${i}`,
        artistName: `Artist ${i}`,
        type: 'a',
      }));
      mockGetTagReleases.mockResolvedValue({ releases });

      const strategy = getStrategy('bandcamp_new')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.albums).toHaveLength(10);
    });

    it('defaults limit to 50', async () => {
      const releases = Array.from({ length: 60 }, (_, i) => ({
        title: `Album ${i}`,
        artistName: `Artist ${i}`,
        type: 'a',
      }));
      mockGetTagReleases.mockResolvedValue({ releases });

      const strategy = getStrategy('bandcamp_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(50);
    });

    it('maps type "a" to "album" and other types to "single"', async () => {
      mockGetTagReleases.mockResolvedValue({
        releases: [
          { title: 'Full Album', artistName: 'A1', type: 'a' },
          { title: 'Track', artistName: 'A2', type: 't' },
          { title: 'EP', artistName: 'A3', type: 'e' },
        ],
      });

      const strategy = getStrategy('bandcamp_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums[0].releaseType).toBe('album');
      expect(result.albums[1].releaseType).toBe('single');
      expect(result.albums[2].releaseType).toBe('single');
    });
  });
});
