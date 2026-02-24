import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyContext } from '../../../src/jobs/strategies/types.js';
import { clearRegistry, getStrategy } from '../../../src/jobs/strategies/registry.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetUserTopArtists = vi.fn();
const mockGetSimilarUsers = vi.fn();
const mockGetRecommendations = vi.fn();
const mockGetFreshReleases = vi.fn();
const mockGetLatestCreatedForYouPlaylist = vi.fn();
const mockGetYearInMusic = vi.fn();
const mockGetPlaylist = vi.fn();
const mockGetArtistRadio = vi.fn();
const mockGetLovedTracks = vi.fn();

vi.mock('../../../src/services/listenbrainz.js', () => ({
  ListenBrainzService: function MockListenBrainzService() {
    return {
      getUserTopArtists: mockGetUserTopArtists,
      getSimilarUsers: mockGetSimilarUsers,
      getRecommendations: mockGetRecommendations,
      getFreshReleases: mockGetFreshReleases,
      getLatestCreatedForYouPlaylist: mockGetLatestCreatedForYouPlaylist,
      getYearInMusic: mockGetYearInMusic,
      getPlaylist: mockGetPlaylist,
      getArtistRadio: mockGetArtistRadio,
      getLovedTracks: mockGetLovedTracks,
    };
  },
  VALID_PERIODS: ['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time'],
}));

const mockGetRecording = vi.fn();

vi.mock('../../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: function MockMusicBrainzService() {
    return { getRecording: mockGetRecording };
  },
}));

vi.mock('../../../src/types/connections.js', () => ({
  isListenBrainzConfig: vi.fn().mockReturnValue(true),
}));

vi.mock('../../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Import AFTER mocks are set up (vi.mock is hoisted)
import '../../../src/jobs/strategies/listenbrainz.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal StrategyContext with a valid ListenBrainz connection. */
function makeContext(config: Record<string, unknown> = {}): StrategyContext {
  return {
    config,
    connections: new Map([
      ['listenbrainz', { id: 1, type: 'listenbrainz', config: { username: 'testuser', token: 'test-token' } }],
    ]),
  };
}

/** Build a context with NO ListenBrainz connection. */
function makeContextNoLB(config: Record<string, unknown> = {}): StrategyContext {
  return { config, connections: new Map() };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ListenBrainz strategies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // listenbrainz_top
  // -----------------------------------------------------------------------
  describe('listenbrainz_top', () => {
    it('returns top artists with default period and limit', async () => {
      mockGetUserTopArtists.mockResolvedValue({
        artists: [
          { artist_name: 'Artist A', artist_mbid: 'mbid-a' },
          { artist_name: 'Artist B', artist_mbid: 'mbid-b' },
        ],
      });

      const strategy = getStrategy('listenbrainz_top')!;
      const result = await strategy.execute(makeContext());

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('all_time', 50);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', mbid: 'mbid-a', source: 'listenbrainz-top-all_time' });
      expect(result.albums).toHaveLength(0);
    });

    it('validates period against VALID_PERIODS', async () => {
      mockGetUserTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('listenbrainz_top')!;
      await strategy.execute(makeContext({ period: 'month', limit: 25 }));

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('month', 25);
    });

    it('falls back to all_time for invalid period', async () => {
      mockGetUserTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('listenbrainz_top')!;
      await strategy.execute(makeContext({ period: 'invalid' }));

      expect(mockGetUserTopArtists).toHaveBeenCalledWith('all_time', 50);
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_top')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_similar
  // -----------------------------------------------------------------------
  describe('listenbrainz_similar', () => {
    it('collects artists from similar users and deduplicates by name', async () => {
      mockGetSimilarUsers.mockResolvedValue([
        { user_name: 'user1' },
        { user_name: 'user2' },
      ]);
      mockGetUserTopArtists
        .mockResolvedValueOnce({ artists: [{ artist_name: 'Shared Artist', artist_mbid: 'mbid-s' }] })
        .mockResolvedValueOnce({ artists: [{ artist_name: 'Shared Artist', artist_mbid: 'mbid-s' }, { artist_name: 'Unique', artist_mbid: 'mbid-u' }] });

      const strategy = getStrategy('listenbrainz_similar')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      // Shared Artist appears in both → count=2, should be first
      expect(result.artists[0]).toEqual({ name: 'Shared Artist', mbid: 'mbid-s', source: 'listenbrainz-similar' });
      expect(result.artists).toHaveLength(2);
    });

    it('limits to top 5 similar users', async () => {
      const users = Array.from({ length: 10 }, (_, i) => ({ user_name: `user${i}` }));
      mockGetSimilarUsers.mockResolvedValue(users);
      mockGetUserTopArtists.mockResolvedValue({ artists: [] });

      const strategy = getStrategy('listenbrainz_similar')!;
      await strategy.execute(makeContext());

      // 1 call for authenticated service (getSimilarUsers), then 5 calls for top 5 similar users
      expect(mockGetUserTopArtists).toHaveBeenCalledTimes(5);
    });

    it('continues if a similar user fetch fails', async () => {
      mockGetSimilarUsers.mockResolvedValue([
        { user_name: 'good_user' },
        { user_name: 'bad_user' },
      ]);
      mockGetUserTopArtists
        .mockResolvedValueOnce({ artists: [{ artist_name: 'Good Artist', artist_mbid: 'mbid-g' }] })
        .mockRejectedValueOnce(new Error('API error'));

      const strategy = getStrategy('listenbrainz_similar')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
      expect(result.artists[0].name).toBe('Good Artist');
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_similar')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_recommendations
  // -----------------------------------------------------------------------
  describe('listenbrainz_recommendations', () => {
    it('looks up artists via MusicBrainz from recording MBIDs', async () => {
      mockGetRecommendations.mockResolvedValue({
        mbids: [{ recording_mbid: 'rec-1' }, { recording_mbid: 'rec-2' }],
      });
      mockGetRecording
        .mockResolvedValueOnce({ 'artist-credit': [{ artist: { id: 'a1', name: 'Artist 1' } }] })
        .mockResolvedValueOnce({ 'artist-credit': [{ artist: { id: 'a2', name: 'Artist 2' } }] });

      const strategy = getStrategy('listenbrainz_recommendations')!;
      const result = await strategy.execute(makeContext());

      expect(mockGetRecommendations).toHaveBeenCalledWith('similar_artist', 50);
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist 1', mbid: 'a1', source: 'listenbrainz-recommendations-similar_artist' });
    });

    it('validates recommendation type', async () => {
      mockGetRecommendations.mockResolvedValue({ mbids: [] });

      const strategy = getStrategy('listenbrainz_recommendations')!;
      await strategy.execute(makeContext({ recommendationType: 'top_artist' }));

      expect(mockGetRecommendations).toHaveBeenCalledWith('top_artist', 50);
    });

    it('defaults to similar_artist for invalid recommendation type', async () => {
      mockGetRecommendations.mockResolvedValue({ mbids: [] });

      const strategy = getStrategy('listenbrainz_recommendations')!;
      await strategy.execute(makeContext({ recommendationType: 'bad_type' }));

      expect(mockGetRecommendations).toHaveBeenCalledWith('similar_artist', 50);
    });

    it('deduplicates by artist MBID', async () => {
      mockGetRecommendations.mockResolvedValue({
        mbids: [{ recording_mbid: 'rec-1' }, { recording_mbid: 'rec-2' }],
      });
      // Both recordings from the same artist
      mockGetRecording
        .mockResolvedValueOnce({ 'artist-credit': [{ artist: { id: 'a1', name: 'Artist 1' } }] })
        .mockResolvedValueOnce({ 'artist-credit': [{ artist: { id: 'a1', name: 'Artist 1' } }] });

      const strategy = getStrategy('listenbrainz_recommendations')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
    });

    it('skips recordings that fail lookup', async () => {
      mockGetRecommendations.mockResolvedValue({
        mbids: [{ recording_mbid: 'rec-1' }, { recording_mbid: 'rec-bad' }],
      });
      mockGetRecording
        .mockResolvedValueOnce({ 'artist-credit': [{ artist: { id: 'a1', name: 'Artist 1' } }] })
        .mockResolvedValueOnce(null);

      const strategy = getStrategy('listenbrainz_recommendations')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_recommendations')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_fresh_releases
  // -----------------------------------------------------------------------
  describe('listenbrainz_fresh_releases', () => {
    it('returns albums from fresh releases', async () => {
      mockGetFreshReleases.mockResolvedValue({
        releases: [
          {
            release_name: 'Album A',
            artist_credit_name: 'Artist A',
            release_mbid: 'rel-1',
            artist_mbids: ['art-1'],
            release_date: '2026-01-15',
          },
        ],
      });

      const strategy = getStrategy('listenbrainz_fresh_releases')!;
      const result = await strategy.execute(makeContext());

      expect(result.albums).toHaveLength(1);
      expect(result.albums[0]).toEqual({
        albumName: 'Album A',
        artistName: 'Artist A',
        albumMbid: 'rel-1',
        artistMbid: 'art-1',
        releaseDate: '2026-01-15',
        releaseYear: 2026,
        releaseType: 'album',
        source: 'listenbrainz-fresh-releases',
      });
      expect(result.artists).toHaveLength(0);
    });

    it('works without a ListenBrainz connection (falls back to anonymous)', async () => {
      mockGetFreshReleases.mockResolvedValue({ releases: [] });

      const strategy = getStrategy('listenbrainz_fresh_releases')!;
      const result = await strategy.execute(makeContextNoLB());

      expect(result.albums).toHaveLength(0);
      // Should not throw
    });

    it('respects limit', async () => {
      const releases = Array.from({ length: 100 }, (_, i) => ({
        release_name: `Album ${i}`,
        artist_credit_name: `Artist ${i}`,
        release_mbid: `rel-${i}`,
        artist_mbids: [`art-${i}`],
        release_date: '2026-01-01',
      }));
      mockGetFreshReleases.mockResolvedValue({ releases });

      const strategy = getStrategy('listenbrainz_fresh_releases')!;
      const result = await strategy.execute(makeContext({ limit: 10 }));

      expect(result.albums).toHaveLength(10);
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_weekly_jams
  // -----------------------------------------------------------------------
  describe('listenbrainz_weekly_jams', () => {
    it('extracts unique artists from weekly jams playlist', async () => {
      mockGetLatestCreatedForYouPlaylist.mockResolvedValue({
        tracks: [
          { artist_name: 'Artist A', artist_mbid: 'mbid-a' },
          { artist_name: 'Artist B', artist_mbid: 'mbid-b' },
          { artist_name: 'artist a', artist_mbid: 'mbid-a' }, // duplicate by lowercase
        ],
      });

      const strategy = getStrategy('listenbrainz_weekly_jams')!;
      const result = await strategy.execute(makeContext());

      expect(mockGetLatestCreatedForYouPlaylist).toHaveBeenCalledWith('weekly-jams');
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Artist A', mbid: 'mbid-a', source: 'listenbrainz-weekly-jams' });
    });

    it('returns empty when playlist is null', async () => {
      mockGetLatestCreatedForYouPlaylist.mockResolvedValue(null);

      const strategy = getStrategy('listenbrainz_weekly_jams')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(0);
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_weekly_jams')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_weekly_exploration
  // -----------------------------------------------------------------------
  describe('listenbrainz_weekly_exploration', () => {
    it('extracts unique artists from weekly exploration playlist', async () => {
      mockGetLatestCreatedForYouPlaylist.mockResolvedValue({
        tracks: [
          { artist_name: 'New Artist', artist_mbid: 'mbid-n' },
        ],
      });

      const strategy = getStrategy('listenbrainz_weekly_exploration')!;
      const result = await strategy.execute(makeContext());

      expect(mockGetLatestCreatedForYouPlaylist).toHaveBeenCalledWith('weekly-exploration');
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'New Artist', mbid: 'mbid-n', source: 'listenbrainz-weekly-exploration' });
    });

    it('returns empty when playlist is null', async () => {
      mockGetLatestCreatedForYouPlaylist.mockResolvedValue(null);

      const strategy = getStrategy('listenbrainz_weekly_exploration')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(0);
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_weekly_exploration')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_year
  // -----------------------------------------------------------------------
  describe('listenbrainz_year', () => {
    it('returns top artists from Year in Music', async () => {
      mockGetYearInMusic.mockResolvedValue({
        topArtists: [
          { artist_name: 'Year Artist', artist_mbid: 'mbid-y' },
        ],
      });

      const strategy = getStrategy('listenbrainz_year')!;
      const result = await strategy.execute(makeContext({ year: 2025 }));

      expect(mockGetYearInMusic).toHaveBeenCalledWith(2025);
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Year Artist', mbid: 'mbid-y', source: 'listenbrainz-year-2025' });
    });

    it('defaults to current year if not provided', async () => {
      mockGetYearInMusic.mockResolvedValue({ topArtists: [] });

      const strategy = getStrategy('listenbrainz_year')!;
      await strategy.execute(makeContext());

      expect(mockGetYearInMusic).toHaveBeenCalledWith(new Date().getFullYear());
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_year')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_playlist
  // -----------------------------------------------------------------------
  describe('listenbrainz_playlist', () => {
    it('extracts unique artists from a playlist', async () => {
      mockGetPlaylist.mockResolvedValue({
        tracks: [
          { artist_name: 'Playlist Artist', artist_mbid: 'mbid-p' },
          { artist_name: 'playlist artist', artist_mbid: 'mbid-p' }, // duplicate
        ],
      });

      const strategy = getStrategy('listenbrainz_playlist')!;
      const result = await strategy.execute(makeContext({ playlistId: 'pl-123' }));

      expect(mockGetPlaylist).toHaveBeenCalledWith('pl-123');
      expect(result.artists).toHaveLength(1);
      expect(result.artists[0]).toEqual({ name: 'Playlist Artist', mbid: 'mbid-p', source: 'listenbrainz-playlist' });
    });

    it('throws when playlistId is missing', async () => {
      const strategy = getStrategy('listenbrainz_playlist')!;
      await expect(strategy.execute(makeContext())).rejects.toThrow(
        'Playlist ID is required',
      );
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_playlist')!;
      await expect(strategy.execute(makeContextNoLB({ playlistId: 'pl-123' }))).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_radio
  // -----------------------------------------------------------------------
  describe('listenbrainz_radio', () => {
    it('extracts unique artists from artist radio', async () => {
      mockGetArtistRadio.mockResolvedValue({
        tracks: [
          { artist_name: 'Radio Artist', artist_mbid: 'mbid-r' },
          { artist_name: 'Another', artist_mbid: 'mbid-a' },
        ],
      });

      const strategy = getStrategy('listenbrainz_radio')!;
      const result = await strategy.execute(makeContext({ seedMbid: 'seed-1', mode: 'easy' }));

      expect(mockGetArtistRadio).toHaveBeenCalledWith('seed-1', 'easy');
      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Radio Artist', mbid: 'mbid-r', source: 'listenbrainz-radio' });
    });

    it('defaults mode to medium', async () => {
      mockGetArtistRadio.mockResolvedValue({ tracks: [] });

      const strategy = getStrategy('listenbrainz_radio')!;
      await strategy.execute(makeContext({ seedMbid: 'seed-1' }));

      expect(mockGetArtistRadio).toHaveBeenCalledWith('seed-1', 'medium');
    });

    it('works without a ListenBrainz connection (falls back to anonymous)', async () => {
      mockGetArtistRadio.mockResolvedValue({ tracks: [] });

      const strategy = getStrategy('listenbrainz_radio')!;
      const result = await strategy.execute(makeContextNoLB({ seedMbid: 'seed-1' }));

      expect(result.artists).toHaveLength(0);
      // Should not throw
    });

    it('throws when seedMbid is missing', async () => {
      const strategy = getStrategy('listenbrainz_radio')!;
      await expect(strategy.execute(makeContext())).rejects.toThrow(
        'Seed artist MBID is required',
      );
    });
  });

  // -----------------------------------------------------------------------
  // listenbrainz_loved
  // -----------------------------------------------------------------------
  describe('listenbrainz_loved', () => {
    it('extracts unique artists from loved tracks', async () => {
      mockGetLovedTracks.mockResolvedValue({
        feedback: [
          { artist_name: 'Loved Artist', artist_mbid: 'mbid-l' },
          { artist_name: 'loved artist', artist_mbid: 'mbid-l' }, // duplicate
          { artist_name: 'Another Loved', artist_mbid: 'mbid-al' },
        ],
      });

      const strategy = getStrategy('listenbrainz_loved')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0]).toEqual({ name: 'Loved Artist', mbid: 'mbid-l', source: 'listenbrainz-loved' });
    });

    it('skips feedback entries without artist_name', async () => {
      mockGetLovedTracks.mockResolvedValue({
        feedback: [
          { artist_name: 'Valid Artist', artist_mbid: 'mbid-v' },
          { artist_mbid: 'mbid-no-name' }, // no artist_name
        ],
      });

      const strategy = getStrategy('listenbrainz_loved')!;
      const result = await strategy.execute(makeContext());

      expect(result.artists).toHaveLength(1);
    });

    it('throws when no ListenBrainz connection', async () => {
      const strategy = getStrategy('listenbrainz_loved')!;
      await expect(strategy.execute(makeContextNoLB())).rejects.toThrow(
        'No active ListenBrainz connection',
      );
    });
  });
});
