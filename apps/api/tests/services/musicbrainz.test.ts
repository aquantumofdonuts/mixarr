/**
 * MusicBrainz Service Tests
 * 
 * Tests for artist matching logic, particularly the findBestMatch function
 * that determines which MusicBrainz artist corresponds to a search query.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MusicBrainzService } from '../../src/services/musicbrainz.js';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('MusicBrainzService', () => {
  let service: MusicBrainzService;

  beforeEach(() => {
    service = new MusicBrainzService();
    vi.clearAllMocks();
  });

  describe('findBestMatch', () => {
    it('should reject high-score results that have no word overlap with search query', async () => {
      // Mock searchArtist to return "Neil Young" with high score for "neil amsterdam" query
      const mockSearchArtist = vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([
        {
          id: 'neil-young-mbid',
          name: 'Neil Young',
          'sort-name': 'Young, Neil',
          score: 98,  // High score but wrong artist
        },
        {
          id: 'some-other-neil-mbid',
          name: 'Neil Diamond',
          'sort-name': 'Diamond, Neil',
          score: 95,
        },
      ]);

      // When searching for "neil amsterdam", should NOT return Neil Young
      // even though MusicBrainz gives it a high score
      const result = await service.findBestMatch('neil amsterdam');

      // Should return null because no artist name has sufficient word overlap
      // "Neil Young" shares only "neil" with "neil amsterdam" - not enough
      expect(result).toBeNull();
      expect(mockSearchArtist).toHaveBeenCalledWith('neil amsterdam', 10);
    });

    it('should accept exact name match regardless of score', async () => {
      vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([
        {
          id: 'neil-amsterdam-mbid',
          name: 'Neil Amsterdam',
          'sort-name': 'Amsterdam, Neil',
          score: 85,  // Lower score but exact match
        },
        {
          id: 'neil-young-mbid',
          name: 'Neil Young',
          'sort-name': 'Young, Neil',
          score: 98,  // Higher score but wrong artist
        },
      ]);

      const result = await service.findBestMatch('neil amsterdam');

      // Should return the exact match, not the higher-scored wrong artist
      expect(result).not.toBeNull();
      expect(result!.id).toBe('neil-amsterdam-mbid');
      expect(result!.name).toBe('Neil Amsterdam');
    });

    it('should accept high-score result when all search words are in artist name', async () => {
      // "The Beatles" searching should match "The Beatles" with high score
      vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([
        {
          id: 'beatles-mbid',
          name: 'The Beatles',
          'sort-name': 'Beatles, The',
          score: 100,
        },
      ]);

      const result = await service.findBestMatch('the beatles');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('beatles-mbid');
    });

    it('should accept alias match over high-score non-match', async () => {
      vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([
        {
          id: 'prince-mbid',
          name: 'Prince',
          'sort-name': 'Prince',
          score: 90,
          aliases: [
            { name: 'The Artist Formerly Known as Prince', primary: false },
            { name: 'TAFKAP', primary: false },
          ],
        },
      ]);

      const result = await service.findBestMatch('TAFKAP');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('prince-mbid');
    });

    it('should handle single-word artist names correctly', async () => {
      // Searching for "Madonna" should match "Madonna"
      vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([
        {
          id: 'madonna-mbid',
          name: 'Madonna',
          'sort-name': 'Madonna',
          score: 100,
        },
      ]);

      const result = await service.findBestMatch('Madonna');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('madonna-mbid');
    });

    it('should return null when no results found', async () => {
      vi.spyOn(service, 'searchArtist' as any).mockResolvedValue([]);

      const result = await service.findBestMatch('completely unknown artist xyz123');

      expect(result).toBeNull();
    });
  });

  describe('lookupArtistDiscogsId', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    function mockFetch(body: unknown, ok = true) {
      const fn = vi.fn(async () => ({ ok, json: async () => body }) as unknown as Response);
      global.fetch = fn as unknown as typeof fetch;
      return fn;
    }

    it('parses the numeric Discogs id from a bare /artist/{id} url-rel', async () => {
      const fetchMock = mockFetch({
        relations: [
          { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/12345' } },
        ],
      });

      const result = await service.lookupArtistDiscogsId('mbid-1');

      expect(result).toBe(12345);
      // Hit the artist url-rels endpoint.
      const url = String(fetchMock.mock.calls[0][0]);
      expect(url).toContain('/artist/mbid-1');
      expect(url).toContain('inc=url-rels');
    });

    it('parses the id from a slugged /artist/{id}-Name url-rel', async () => {
      mockFetch({
        relations: [
          { type: 'discogs', url: { resource: 'https://www.discogs.com/artist/67890-Some-Artist-Name' } },
        ],
      });

      const result = await service.lookupArtistDiscogsId('mbid-2');

      expect(result).toBe(67890);
    });

    it('returns null when the artist has no discogs url-rel', async () => {
      mockFetch({
        relations: [
          { type: 'wikidata', url: { resource: 'https://www.wikidata.org/wiki/Q123' } },
        ],
      });

      const result = await service.lookupArtistDiscogsId('mbid-3');

      expect(result).toBeNull();
    });

    it('degrades to null when the MB request fails', async () => {
      const fn = vi.fn(async () => {
        throw new Error('MusicBrainz unavailable');
      });
      global.fetch = fn as unknown as typeof fetch;

      const result = await service.lookupArtistDiscogsId('mbid-4');

      expect(result).toBeNull();
    });
  });
});
