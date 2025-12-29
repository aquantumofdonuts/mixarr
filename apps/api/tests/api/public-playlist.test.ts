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

    it('fetches and parses playlist data from embed endpoint', async () => {
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
