import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSearchByYear = vi.fn();

vi.mock('../../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: function MockMusicBrainzService() {
    return {
      searchByYear: mockSearchByYear,
    };
  },
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/musicbrainz.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext (no connections needed). */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('MusicBrainz strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // musicbrainz_new
  // -----------------------------------------------------------------------
  describe('musicbrainz_new', () => {
    it('returns albums from MusicBrainz release groups', async () => {
      mockSearchByYear.mockResolvedValue({
        releaseGroups: [
          {
            title: 'Album One',
            id: 'rg-id-1',
            'artist-credit': [{ artist: { name: 'Artist A', id: 'artist-id-a' } }],
            'first-release-date': '2026-03-15',
            'primary-type': 'Album',
          },
          {
            title: 'Album Two',
            id: 'rg-id-2',
            'artist-credit': [{ artist: { name: 'Artist B', id: 'artist-id-b' } }],
            'first-release-date': '2026-01-10',
            'primary-type': 'Single',
          },
        ],
      });

      const strategy = getStrategy('musicbrainz_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(0);
      expect(result.albums).toHaveLength(2);
      expect(result.albums[0]).toEqual({
        albumName: 'Album One',
        artistName: 'Artist A',
        albumMbid: 'rg-id-1',
        artistMbid: 'artist-id-a',
        releaseDate: '2026-03-15',
        releaseYear: 2026,
        releaseType: 'Album',
        source: 'musicbrainz-new',
      });
      expect(result.albums[1]).toEqual({
        albumName: 'Album Two',
        artistName: 'Artist B',
        albumMbid: 'rg-id-2',
        artistMbid: 'artist-id-b',
        releaseDate: '2026-01-10',
        releaseYear: 2026,
        releaseType: 'Single',
        source: 'musicbrainz-new',
      });
    });

    it('defaults artist name to Unknown Artist when no credit', async () => {
      mockSearchByYear.mockResolvedValue({
        releaseGroups: [
          {
            title: 'Mystery Album',
            id: 'rg-mystery',
            'artist-credit': [],
            'first-release-date': '2026-06-01',
            'primary-type': 'Album',
          },
        ],
      });

      const strategy = getStrategy('musicbrainz_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums[0].artistName).toBe('Unknown Artist');
    });

    it('defaults releaseType to album when primary-type is missing', async () => {
      mockSearchByYear.mockResolvedValue({
        releaseGroups: [
          {
            title: 'Untyped Album',
            id: 'rg-untyped',
            'artist-credit': [{ artist: { name: 'Artist X', id: 'x' } }],
            'first-release-date': '2026-04-01',
          },
        ],
      });

      const strategy = getStrategy('musicbrainz_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums[0].releaseType).toBe('album');
    });

    it('uses current year when release date is missing', async () => {
      mockSearchByYear.mockResolvedValue({
        releaseGroups: [
          {
            title: 'Undated Album',
            id: 'rg-undated',
            'artist-credit': [{ artist: { name: 'Artist Y', id: 'y' } }],
          },
        ],
      });

      const strategy = getStrategy('musicbrainz_new')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums[0].releaseYear).toBe(new Date().getFullYear());
    });

    it('uses config.limit (default 50)', async () => {
      mockSearchByYear.mockResolvedValue({ releaseGroups: [] });

      const strategy = getStrategy('musicbrainz_new')!;
      await strategy.execute(makeContext({ limit: 25 }));

      expect(mockSearchByYear).toHaveBeenCalledWith(new Date().getFullYear(), 25);
    });

    it('defaults limit to 50', async () => {
      mockSearchByYear.mockResolvedValue({ releaseGroups: [] });

      const strategy = getStrategy('musicbrainz_new')!;
      await strategy.execute(makeContext());

      expect(mockSearchByYear).toHaveBeenCalledWith(new Date().getFullYear(), 50);
    });
  });
});
