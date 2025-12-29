import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseSpotifyPlaylistUrl, fetchPublicPlaylist, extractArtistsFromPlaylist } from '../../src/services/public-playlist';
import express from 'express';
import request from 'supertest';

describe('Public Playlist Import', () => {
  describe('parseSpotifyPlaylistUrl', () => {
    it('parses standard playlist URL', () => {
      const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
      expect(parseSpotifyPlaylistUrl(url)).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('parses playlist URL with query params', () => {
      const url = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123';
      expect(parseSpotifyPlaylistUrl(url)).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('parses spotify URI format', () => {
      const url = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M';
      expect(parseSpotifyPlaylistUrl(url)).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('parses intl subdomain URL', () => {
      const url = 'https://open.spotify.com/intl-de/playlist/37i9dQZF1DXcBWIGoYBM5M';
      expect(parseSpotifyPlaylistUrl(url)).toBe('37i9dQZF1DXcBWIGoYBM5M');
    });

    it('returns null for invalid URL', () => {
      expect(parseSpotifyPlaylistUrl('https://example.com')).toBeNull();
      expect(parseSpotifyPlaylistUrl('')).toBeNull();
      expect(parseSpotifyPlaylistUrl('https://open.spotify.com/album/123')).toBeNull();
    });

    it('returns null for track URL', () => {
      const url = 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh';
      expect(parseSpotifyPlaylistUrl(url)).toBeNull();
    });
  });

  describe('extractArtistsFromPlaylist', () => {
    it('extracts unique artist names', () => {
      const tracks = [
        { name: 'Song 1', artists: [{ name: 'Artist A' }] },
        { name: 'Song 2', artists: [{ name: 'Artist B' }] },
        { name: 'Song 3', artists: [{ name: 'Artist A' }] }, // duplicate
      ];
      
      const artists = extractArtistsFromPlaylist(tracks);
      expect(artists).toEqual(['Artist A', 'Artist B']);
    });

    it('extracts primary artist from collaborations', () => {
      const tracks = [
        { name: 'Collab Song', artists: [{ name: 'Artist A' }, { name: 'Artist B' }] },
      ];
      
      const artists = extractArtistsFromPlaylist(tracks);
      expect(artists).toEqual(['Artist A']);
    });

    it('handles empty playlist', () => {
      const artists = extractArtistsFromPlaylist([]);
      expect(artists).toEqual([]);
    });

    it('includes all collaborators when option is set', () => {
      const tracks = [
        { name: 'Collab Song', artists: [{ name: 'Artist A' }, { name: 'Artist B' }] },
      ];
      
      const artists = extractArtistsFromPlaylist(tracks, { includeAllArtists: true });
      expect(artists).toContain('Artist A');
      expect(artists).toContain('Artist B');
    });
  });

  describe('fetchPublicPlaylist', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fetches and parses playlist data from embed endpoint (legacy format)', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "state": {
                    "data": {
                      "entity": {
                        "name": "Test Playlist",
                        "trackList": [
                          {"track": {"name": "Song 1", "artists": [{"name": "Artist A"}]}},
                          {"track": {"name": "Song 2", "artists": [{"name": "Artist B"}]}}
                        ]
                      }
                    }
                  }
                }
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await fetchPublicPlaylist('testPlaylistId');
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Playlist');
      expect(result?.tracks).toHaveLength(2);
      expect(result?.tracks[0].artists[0].name).toBe('Artist A');
    });

    it('fetches and parses playlist data from new Spotify format (title/subtitle)', async () => {
      // New Spotify embed format uses title for song name and subtitle for artist
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "state": {
                    "data": {
                      "entity": {
                        "title": "Christmas Hits",
                        "trackList": [
                          {"title": "Rockin' Around The Christmas Tree", "subtitle": "Brenda Lee"},
                          {"title": "All I Want for Christmas Is You", "subtitle": "Mariah Carey"},
                          {"title": "Last Christmas", "subtitle": "Wham!"}
                        ]
                      }
                    }
                  }
                }
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await fetchPublicPlaylist('newFormatPlaylist');
      
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Christmas Hits');
      expect(result?.tracks).toHaveLength(3);
      expect(result?.tracks[0].name).toBe("Rockin' Around The Christmas Tree");
      expect(result?.tracks[0].artists[0].name).toBe('Brenda Lee');
      expect(result?.tracks[1].artists[0].name).toBe('Mariah Carey');
      expect(result?.tracks[2].artists[0].name).toBe('Wham!');
    });

    it('handles comma-separated artists in subtitle', async () => {
      const mockHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <script id="__NEXT_DATA__" type="application/json">
            {
              "props": {
                "pageProps": {
                  "state": {
                    "data": {
                      "entity": {
                        "title": "Collabs Playlist",
                        "trackList": [
                          {"title": "Collab Song", "subtitle": "Artist A, Artist B, Artist C"}
                        ]
                      }
                    }
                  }
                }
              }
            }
          </script>
        </head>
        <body></body>
        </html>
      `;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockHtml),
      });

      const result = await fetchPublicPlaylist('collabPlaylist');
      
      expect(result?.tracks[0].artists).toHaveLength(3);
      expect(result?.tracks[0].artists[0].name).toBe('Artist A');
      expect(result?.tracks[0].artists[1].name).toBe('Artist B');
      expect(result?.tracks[0].artists[2].name).toBe('Artist C');
    });

    it('throws error for invalid playlist ID', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchPublicPlaylist('invalidId')).rejects.toThrow('Failed to fetch playlist');
    });

    it('throws error when no data found in HTML', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('<html><body>No data</body></html>'),
      });

      await expect(fetchPublicPlaylist('testId')).rejects.toThrow('Could not parse playlist data');
    });
  });
});
