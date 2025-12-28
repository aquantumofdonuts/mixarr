/**
 * ListenBrainz Service Tests
 * 
 * Tests:
 * - User validation
 * - Top artists retrieval
 * - Recommendations (top_artist, similar_artist)
 * - Similar users
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ListenBrainzService, VALID_PERIODS } from '../../src/services/listenbrainz.js';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Helper to create a mock fetch response with both json() and text() methods
function mockResponse(data: unknown, ok = true, status = 200, statusText = 'OK'): Partial<Response> {
  const jsonStr = JSON.stringify(data);
  return {
    ok,
    status,
    statusText,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(jsonStr),
  };
}

// Helper for error responses
function mockErrorResponse(status: number, statusText: string, errorData?: { error?: string; code?: number }): Partial<Response> {
  const jsonStr = errorData ? JSON.stringify(errorData) : '';
  return {
    ok: false,
    status,
    statusText,
    json: () => errorData ? Promise.resolve(errorData) : Promise.reject(new Error('No body')),
    text: () => Promise.resolve(jsonStr),
  };
}

describe('ListenBrainz Service', () => {
  let service: ListenBrainzService;
  let mockFetch: ReturnType<typeof vi.fn>;
  const testUsername = 'testuser';
  const testToken = 'test-token-12345';

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    service = new ListenBrainzService(testUsername);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with username only', () => {
      const svc = new ListenBrainzService('myuser');
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });

    it('should create service with username and token', () => {
      const svc = new ListenBrainzService('myuser', 'my-token');
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });

    it('should throw error for empty username', () => {
      expect(() => new ListenBrainzService('')).toThrow('ListenBrainz username is required');
    });

    it('should throw error for whitespace-only username', () => {
      expect(() => new ListenBrainzService('   ')).toThrow('ListenBrainz username is required');
    });

    it('should trim whitespace from username', () => {
      const svc = new ListenBrainzService('  myuser  ', 'token');
      // Service should work without error, username is trimmed internally
      expect(svc).toBeInstanceOf(ListenBrainzService);
    });
  });

  describe('validateUser', () => {
    it('should return true for valid user (without token, uses stats endpoint)', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { artists: [], count: 0 },
      }));

      const result = await service.validateUser();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/stats/user/${testUsername}/artists?range=all_time&count=1`,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
          }),
        })
      );
    });

    it('should return true for valid token (uses validate-token endpoint with Authorization header)', async () => {
      const serviceWithToken = new ListenBrainzService(testUsername, 'test-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername,
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(true);
      // Token should be in Authorization header, NOT in URL
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.listenbrainz.org/1/validate-token',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Accept': 'application/json',
            'Authorization': 'Token test-token',
          }),
        })
      );
    });

    it('should return false when token is invalid', async () => {
      const serviceWithToken = new ListenBrainzService(testUsername, 'invalid-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: false,
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(false);
    });

    it('should return false when token username does not match', async () => {
      const serviceWithToken = new ListenBrainzService('differentuser', 'test-token');
      
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername, // Different from 'differentuser'
      }));

      const result = await serviceWithToken.validateUser();

      expect(result).toBe(false);
    });

    it('should return false for non-existent user', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      const result = await service.validateUser();

      expect(result).toBe(false);
    });

    it('should throw on server error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.validateUser()).rejects.toThrow('ListenBrainz API error: 500 Internal Server Error');
    });
  });

  describe('getUserTopArtists', () => {
    it('should return top artists for a period', async () => {
      const responseData = {
        payload: {
          artists: [
            { artist_name: 'Artist One', listen_count: 100, artist_mbid: 'mbid-1' },
            { artist_name: 'Artist Two', listen_count: 80, artist_mbid: 'mbid-2' },
          ],
          count: 2,
          total_artist_count: 50,
          range: 'month',
          user_id: testUsername,
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getUserTopArtists('month', 25);

      expect(result.artists).toHaveLength(2);
      expect(result.artists[0].artist_name).toBe('Artist One');
      expect(result.artists[0].listen_count).toBe(100);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/stats/user/${testUsername}/artists?range=month&count=25`,
        expect.any(Object)
      );
    });

    it('should handle all valid periods', async () => {
      const periods = ['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time'] as const;

      for (const period of periods) {
        mockFetch.mockResolvedValue(mockResponse({
          payload: { artists: [], count: 0, total_artist_count: 0 },
        }));

        const result = await service.getUserTopArtists(period, 10);

        expect(result.artists).toEqual([]);
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining(`range=${period}`),
          expect.any(Object)
        );
      }
    });

    it('should use default count if not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { artists: [], count: 0, total_artist_count: 0 },
      }));

      await service.getUserTopArtists('month');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('count=25'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(400, 'Bad Request'));

      await expect(service.getUserTopArtists('month', 10)).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getRecommendations', () => {
    it('should return top_artist recommendations', async () => {
      const responseData = {
        payload: {
          mbids: [
            { recording_mbid: 'rec-1', score: 0.95 },
            { recording_mbid: 'rec-2', score: 0.90 },
          ],
          count: 2,
          user_name: testUsername,
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getRecommendations('top_artist', 10);

      expect(result.mbids).toHaveLength(2);
      expect(result.mbids[0].recording_mbid).toBe('rec-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/cf/recommendation/user/${testUsername}/recording?artist_type=top_artist&count=10`,
        expect.any(Object)
      );
    });

    it('should return similar_artist recommendations', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { mbids: [], count: 0 },
      }));

      await service.getRecommendations('similar_artist', 5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('artist_type=similar_artist'),
        expect.any(Object)
      );
    });

    it('should use default count if not provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { mbids: [], count: 0 },
      }));

      await service.getRecommendations('top_artist');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('count=25'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      await expect(service.getRecommendations('top_artist', 10)).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getSimilarUsers', () => {
    it('should return similar users', async () => {
      const responseData = {
        payload: [
          { user_name: 'user1', similarity: 0.85 },
          { user_name: 'user2', similarity: 0.72 },
        ],
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getSimilarUsers();

      expect(result).toHaveLength(2);
      expect(result[0].user_name).toBe('user1');
      expect(result[0].similarity).toBe(0.85);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/user/${testUsername}/similar-users`,
        expect.any(Object)
      );
    });

    it('should return empty array when no similar users', async () => {
      mockFetch.mockResolvedValue(mockResponse({ payload: [] }));

      const result = await service.getSimilarUsers();

      expect(result).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getSimilarUsers()).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('with token', () => {
    beforeEach(() => {
      service = new ListenBrainzService(testUsername, testToken);
    });

    it('should include Authorization header when token is provided', async () => {
      mockFetch.mockResolvedValue(mockResponse({ payload: [] }));

      await service.getSimilarUsers();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': `Token ${testToken}`,
          }),
        })
      );
    });
  });

  describe('timeout handling', () => {
    it('should abort request on timeout', async () => {
      // Create service with short timeout
      const shortTimeoutService = new ListenBrainzService(testUsername, testToken, 100);
      
      // Mock fetch to simulate slow response - delay longer than timeout
      mockFetch.mockImplementation((_url, options) => {
        return new Promise((resolve, reject) => {
          // Listen for abort signal
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const error = new Error('AbortError');
              error.name = 'AbortError';
              reject(error);
            });
          }
          // Never resolve naturally
        });
      });

      await expect(shortTimeoutService.validateUser()).rejects.toThrow('ListenBrainz API request timed out');
    }, 5000); // Test timeout of 5 seconds

    it('should complete successfully within timeout', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        valid: true,
        user_name: testUsername,
      }));

      const result = await service.validateUser();

      expect(result).toBe(true);
    });
  });

  describe('VALID_PERIODS constant', () => {
    it('should export valid periods array', () => {
      expect(VALID_PERIODS).toEqual(['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time']);
    });

    it('should contain all expected periods', () => {
      expect(VALID_PERIODS).toContain('week');
      expect(VALID_PERIODS).toContain('month');
      expect(VALID_PERIODS).toContain('quarter');
      expect(VALID_PERIODS).toContain('half_yearly');
      expect(VALID_PERIODS).toContain('year');
      expect(VALID_PERIODS).toContain('all_time');
    });
  });

  // ============================================================================
  // NEW LISTENBRAINZ DEEP INTEGRATION METHODS
  // ============================================================================

  describe('getFreshReleases', () => {
    it('should return fresh releases (trending/popular new music)', async () => {
      const responseData = {
        payload: {
          releases: [
            {
              artist_credit_name: 'Artist One',
              artist_mbids: ['mbid-1'],
              release_name: 'Album One',
              release_mbid: 'release-mbid-1',
              release_date: '2025-01-01',
            },
            {
              artist_credit_name: 'Artist Two',
              artist_mbids: ['mbid-2'],
              release_name: 'Album Two',
              release_mbid: 'release-mbid-2',
              release_date: '2025-01-02',
            },
          ],
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getFreshReleases();

      expect(result.releases).toHaveLength(2);
      expect(result.releases[0].artist_credit_name).toBe('Artist One');
      expect(result.releases[0].artist_mbids).toContain('mbid-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.listenbrainz.org/1/explore/fresh-releases',
        expect.any(Object)
      );
    });

    it('should return empty array when no releases', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { releases: [] },
      }));

      const result = await service.getFreshReleases();

      expect(result.releases).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getFreshReleases()).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getYearInMusic', () => {
    it('should return year in music stats with top artists', async () => {
      const responseData = {
        payload: {
          data: {
            top_artists: [
              { artist_name: 'Top Artist 1', artist_mbid: 'mbid-1', listen_count: 500 },
              { artist_name: 'Top Artist 2', artist_mbid: 'mbid-2', listen_count: 300 },
            ],
            total_listen_count: 5000,
          },
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getYearInMusic(2024);

      expect(result.topArtists).toHaveLength(2);
      expect(result.topArtists[0].artist_name).toBe('Top Artist 1');
      expect(result.topArtists[0].listen_count).toBe(500);
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/stats/user/${testUsername}/year-in-music/2024`,
        expect.any(Object)
      );
    });

    it('should use current year by default', async () => {
      const currentYear = new Date().getFullYear();
      mockFetch.mockResolvedValue(mockResponse({
        payload: { data: { top_artists: [] } },
      }));

      await service.getYearInMusic();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/year-in-music/${currentYear}`),
        expect.any(Object)
      );
    });

    it('should return empty array when no data', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { data: { top_artists: [] } },
      }));

      const result = await service.getYearInMusic(2024);

      expect(result.topArtists).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      await expect(service.getYearInMusic(2024)).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getUserPlaylists', () => {
    it('should return user playlists', async () => {
      const responseData = {
        playlists: [
          {
            playlist: {
              identifier: 'https://listenbrainz.org/playlist/playlist-1',
              title: 'My Playlist 1',
              creator: testUsername,
              track_count: 25,
            },
          },
          {
            playlist: {
              identifier: 'https://listenbrainz.org/playlist/playlist-2',
              title: 'My Playlist 2',
              creator: testUsername,
              track_count: 50,
            },
          },
        ],
        playlist_count: 2,
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getUserPlaylists();

      expect(result.playlists).toHaveLength(2);
      expect(result.playlists[0].title).toBe('My Playlist 1');
      expect(result.playlists[0].identifier).toBe('https://listenbrainz.org/playlist/playlist-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/user/${testUsername}/playlists`,
        expect.any(Object)
      );
    });

    it('should return empty array when no playlists', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        playlists: [],
        playlist_count: 0,
      }));

      const result = await service.getUserPlaylists();

      expect(result.playlists).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getUserPlaylists()).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getPlaylist', () => {
    it('should return playlist tracks with artist info', async () => {
      const responseData = {
        playlist: {
          identifier: 'https://listenbrainz.org/playlist/playlist-1',
          title: 'My Playlist',
          creator: testUsername,
          track: [
            {
              title: 'Track One',
              creator: 'Artist One',
              identifier: ['https://musicbrainz.org/recording/rec-1'],
              extension: {
                'https://musicbrainz.org/doc/jspf#track': {
                  artist_identifiers: ['https://musicbrainz.org/artist/mbid-1'],
                },
              },
            },
            {
              title: 'Track Two',
              creator: 'Artist Two',
              identifier: ['https://musicbrainz.org/recording/rec-2'],
              extension: {
                'https://musicbrainz.org/doc/jspf#track': {
                  artist_identifiers: ['https://musicbrainz.org/artist/mbid-2'],
                },
              },
            },
          ],
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getPlaylist('playlist-1');

      expect(result.tracks).toHaveLength(2);
      expect(result.tracks[0].artist_name).toBe('Artist One');
      expect(result.tracks[0].artist_mbid).toBe('mbid-1');
      expect(result.title).toBe('My Playlist');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.listenbrainz.org/1/playlist/playlist-1',
        expect.any(Object)
      );
    });

    it('should return empty tracks when playlist is empty', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        playlist: {
          identifier: 'https://listenbrainz.org/playlist/playlist-1',
          title: 'Empty Playlist',
          creator: testUsername,
          track: [],
        },
      }));

      const result = await service.getPlaylist('playlist-1');

      expect(result.tracks).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(404, 'Not Found'));

      await expect(service.getPlaylist('nonexistent')).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getArtistRadio', () => {
    it('should return radio recommendations for an artist', async () => {
      const responseData = {
        payload: {
          jspf: {
            playlist: {
              track: [
                {
                  title: 'Radio Track 1',
                  creator: 'Related Artist 1',
                  extension: {
                    'https://musicbrainz.org/doc/jspf#track': {
                      artist_identifiers: ['https://musicbrainz.org/artist/radio-mbid-1'],
                    },
                  },
                },
                {
                  title: 'Radio Track 2',
                  creator: 'Related Artist 2',
                  extension: {
                    'https://musicbrainz.org/doc/jspf#track': {
                      artist_identifiers: ['https://musicbrainz.org/artist/radio-mbid-2'],
                    },
                  },
                },
              ],
            },
          },
        },
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getArtistRadio('source-artist-mbid');

      expect(result.tracks).toHaveLength(2);
      expect(result.tracks[0].artist_name).toBe('Related Artist 1');
      expect(result.tracks[0].artist_mbid).toBe('radio-mbid-1');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.listenbrainz.org/1/explore/lb-radio'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('prompt=artist:(source-artist-mbid)'),
        expect.any(Object)
      );
    });

    it('should support different radio modes', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { jspf: { playlist: { track: [] } } },
      }));

      await service.getArtistRadio('mbid', 'easy');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mode=easy'),
        expect.any(Object)
      );
    });

    it('should use medium mode by default', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        payload: { jspf: { playlist: { track: [] } } },
      }));

      await service.getArtistRadio('mbid');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('mode=medium'),
        expect.any(Object)
      );
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getArtistRadio('mbid')).rejects.toThrow('ListenBrainz API error');
    });
  });

  describe('getLovedTracks', () => {
    it('should return loved/favorited tracks with artist info', async () => {
      const responseData = {
        feedback: [
          {
            recording_mbid: 'rec-1',
            score: 1,
            track_metadata: {
              artist_name: 'Loved Artist 1',
              track_name: 'Loved Track 1',
              mbid_mapping: {
                artist_mbids: ['loved-mbid-1'],
              },
            },
          },
          {
            recording_mbid: 'rec-2',
            score: 1,
            track_metadata: {
              artist_name: 'Loved Artist 2',
              track_name: 'Loved Track 2',
              mbid_mapping: {
                artist_mbids: ['loved-mbid-2'],
              },
            },
          },
        ],
        count: 2,
        total_count: 100,
        offset: 0,
      };

      mockFetch.mockResolvedValue(mockResponse(responseData));

      const result = await service.getLovedTracks();

      expect(result.feedback).toHaveLength(2);
      expect(result.feedback[0].artist_name).toBe('Loved Artist 1');
      expect(result.feedback[0].artist_mbid).toBe('loved-mbid-1');
      expect(mockFetch).toHaveBeenCalledWith(
        `https://api.listenbrainz.org/1/feedback/user/${testUsername}/get-feedback?score=1`,
        expect.any(Object)
      );
    });

    it('should support pagination with count and offset', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        feedback: [],
        count: 0,
        total_count: 0,
        offset: 50,
      }));

      await service.getLovedTracks(50, 50);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('count=50'),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('offset=50'),
        expect.any(Object)
      );
    });

    it('should return empty array when no loved tracks', async () => {
      mockFetch.mockResolvedValue(mockResponse({
        feedback: [],
        count: 0,
        total_count: 0,
        offset: 0,
      }));

      const result = await service.getLovedTracks();

      expect(result.feedback).toEqual([]);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValue(mockErrorResponse(500, 'Internal Server Error'));

      await expect(service.getLovedTracks()).rejects.toThrow('ListenBrainz API error');
    });
  });
});
