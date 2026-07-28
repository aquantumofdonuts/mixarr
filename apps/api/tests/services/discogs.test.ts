import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DiscogsService,
  parseDiscogsArtist,
  formatDiscogsImageUrl,
} from '../../src/services/discogs.js';

// Mock the rate-limiter module
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Discogs Service', () => {
  describe('parseDiscogsArtist', () => {
    it('parses artist data correctly', () => {
      const raw = {
        id: 123,
        name: 'Test Artist',
        profile: 'A test artist bio',
        images: [
          { type: 'primary', uri: 'http://example.com/img1.jpg', width: 600, height: 600 },
          { type: 'secondary', uri: 'http://example.com/img2.jpg', width: 400, height: 400 },
        ],
        urls: ['http://testartist.com', 'http://facebook.com/testartist'],
        namevariations: ['Test Artist alt', 'T. Artist'],
      };

      const parsed = parseDiscogsArtist(raw);

      expect(parsed.id).toBe(123);
      expect(parsed.name).toBe('Test Artist');
      expect(parsed.profile).toBe('A test artist bio');
      expect(parsed.images).toHaveLength(2);
      expect(parsed.images[0].type).toBe('primary');
      expect(parsed.urls).toContain('http://testartist.com');
      expect(parsed.nameVariations).toContain('Test Artist alt');
    });

    it('handles missing optional fields', () => {
      const raw = {
        id: 456,
        name: 'Minimal Artist',
      };

      const parsed = parseDiscogsArtist(raw);

      expect(parsed.id).toBe(456);
      expect(parsed.name).toBe('Minimal Artist');
      expect(parsed.profile).toBeUndefined();
      expect(parsed.images).toEqual([]);
      expect(parsed.urls).toEqual([]);
      expect(parsed.nameVariations).toEqual([]);
    });
  });

  describe('formatDiscogsImageUrl', () => {
    it('returns original URL if no size specified', () => {
      const url = formatDiscogsImageUrl('http://example.com/img.jpg');
      expect(url).toBe('http://example.com/img.jpg');
    });

    it('returns thumbnail URL when size is small', () => {
      const image = {
        uri: 'http://example.com/img.jpg',
        uri150: 'http://example.com/img_150.jpg',
      };
      const url = formatDiscogsImageUrl(image.uri, image.uri150, 'small');
      expect(url).toBe('http://example.com/img_150.jpg');
    });

    it('returns full URL when size is large', () => {
      const image = {
        uri: 'http://example.com/img.jpg',
        uri150: 'http://example.com/img_150.jpg',
      };
      const url = formatDiscogsImageUrl(image.uri, image.uri150, 'large');
      expect(url).toBe('http://example.com/img.jpg');
    });
  });

  describe('DiscogsService', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('creates service with valid token', () => {
      const service = new DiscogsService('test-token');
      expect(service).toBeDefined();
    });

    it('sends both Authorization and User-Agent headers when a token is provided', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'X' }),
      });
      global.fetch = fetchMock as any;

      const service = new DiscogsService('tok');
      await service.getArtist(1);

      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Discogs token=tok');
      expect(headers['User-Agent']).toBe('MixarrMusicDiscovery/1.0');
    });

    it('omits Authorization but keeps User-Agent when constructed without a token (public API)', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'X' }),
      });
      global.fetch = fetchMock as any;

      const service = new DiscogsService();
      await service.getArtist(1);

      const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
      expect(headers['User-Agent']).toBe('MixarrMusicDiscovery/1.0');
    });

    it('gets artist by ID', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 123,
          name: 'Test Artist',
          profile: 'Test bio',
          images: [],
          urls: [],
        }),
      });

      const service = new DiscogsService('test-token');
      const artist = await service.getArtist(123);

      expect(artist.id).toBe(123);
      expect(artist.name).toBe('Test Artist');
    });

    it('handles API errors gracefully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const service = new DiscogsService('test-token');
      
      await expect(service.getArtist(999)).rejects.toThrow('Discogs API error');
    });

    it('searches labels successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 1, per_page: 25, items: 2 },
          results: [
            { id: 1, title: 'Label One' },
            { id: 2, title: 'Label Two' },
          ],
        }),
      });

      const service = new DiscogsService('test-token');
      const response = await service.searchLabels('test');

      expect(response.results).toHaveLength(2);
      expect(response.results[0].title).toBe('Label One');
    });

    it('searches by style successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 1, per_page: 50, items: 1 },
          results: [
            { id: 1, title: 'Ambient Album', type: 'release', style: ['Ambient'] },
          ],
        }),
      });

      const service = new DiscogsService('test-token');
      const response = await service.searchByStyle('Ambient');

      expect(response.results).toHaveLength(1);
      expect(response.results[0].style).toContain('Ambient');
    });

    it('gets label releases', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 2, per_page: 50, items: 75 },
          releases: [
            { id: 1, title: 'Release One', artist: 'Artist A', year: 2024 },
          ],
        }),
      });

      const service = new DiscogsService('test-token');
      const response = await service.getLabelReleases(12345);

      expect(response.releases).toHaveLength(1);
      expect(response.releases[0].title).toBe('Release One');
    });

    it('tests connection successfully', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          pagination: { page: 1, pages: 1, per_page: 25, items: 0 },
          results: [],
        }),
      });

      const service = new DiscogsService('test-token');
      const result = await service.testConnection();

      expect(result.success).toBe(true);
    });

    it('returns error on connection test failure', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const service = new DiscogsService('invalid-token');
      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Discogs API error');
    });
  });

  describe('metadata extraction', () => {
    it('extracts primary image as poster', () => {
      const raw = {
        id: 1,
        name: 'Test',
        images: [
          { type: 'primary', uri: 'http://example.com/primary.jpg', width: 600, height: 600 },
          { type: 'secondary', uri: 'http://example.com/secondary.jpg', width: 400, height: 400 },
        ],
      };

      const parsed = parseDiscogsArtist(raw);
      const primaryImage = parsed.images.find(img => img.type === 'primary');
      
      expect(primaryImage).toBeDefined();
      expect(primaryImage?.uri).toBe('http://example.com/primary.jpg');
    });
  });
});
