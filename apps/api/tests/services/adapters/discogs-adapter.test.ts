// apps/api/tests/services/adapters/discogs-adapter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscogsMetadataAdapter } from '../../../src/services/adapters/discogs-adapter.js';
import { DiscogsService } from '../../../src/services/discogs.js';

// Mock the discogs service module
vi.mock('../../../src/services/discogs.js', () => {
  const MockDiscogsService = vi.fn().mockImplementation(() => ({
    searchLabels: vi.fn(),
    searchByStyle: vi.fn(),
    getLabelReleases: vi.fn(),
    getArtist: vi.fn(),
    testConnection: vi.fn(),
  }));
  
  return {
    DiscogsService: MockDiscogsService,
    parseDiscogsArtist: vi.fn((raw) => ({
      id: raw.id,
      name: raw.name,
      profile: raw.profile,
      images: raw.images || [],
      urls: raw.urls || [],
      nameVariations: raw.namevariations || [],
    })),
  };
});

// Mock the rate-limiter module
vi.mock('../../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('DiscogsMetadataAdapter', () => {
  let adapter: DiscogsMetadataAdapter;
  let mockService: ReturnType<typeof DiscogsService.prototype>;

  beforeEach(() => {
    mockService = {
      searchLabels: vi.fn(),
      searchByStyle: vi.fn(),
      getLabelReleases: vi.fn(),
      getArtist: vi.fn(),
      testConnection: vi.fn(),
    };
    adapter = new DiscogsMetadataAdapter(mockService as unknown as DiscogsService);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchMetadata', () => {
    it('should return normalized metadata with bio and images', async () => {
      // First call: database search
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [{ id: 123, title: 'Radiohead', type: 'artist' }],
          }),
        })
        // Second call: get artist details
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 123,
            name: 'Radiohead',
            profile: 'English alternative rock band from Oxfordshire formed in 1985.',
            images: [
              { type: 'primary', uri: 'https://discogs.com/img/primary.jpg', width: 600, height: 600 },
              { type: 'secondary', uri: 'https://discogs.com/img/secondary.jpg', width: 400, height: 400 },
            ],
            urls: ['https://radiohead.com'],
            namevariations: ['Radio Head'],
          }),
        });

      const result = await adapter.fetchMetadata('Radiohead');

      expect(result.source).toBe('discogs');
      expect(result.overview).toBe('English alternative rock band from Oxfordshire formed in 1985.');
      expect(result.overviewLength).toBe(62);
      expect(result.images).toHaveLength(2);
      expect(result.images![0].url).toBe('https://discogs.com/img/primary.jpg');
      expect(result.images![0].type).toBe('poster');
    });

    it('should use primary image as poster', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [{ id: 456, title: 'Test Artist', type: 'artist' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 456,
            name: 'Test Artist',
            profile: 'A test artist bio.',
            images: [
              { type: 'secondary', uri: 'https://discogs.com/secondary.jpg', width: 300, height: 300 },
              { type: 'primary', uri: 'https://discogs.com/primary.jpg', width: 600, height: 600 },
            ],
          }),
        });

      const result = await adapter.fetchMetadata('Test Artist');

      // Primary image should be first and typed as poster
      const primaryImage = result.images?.find(img => img.type === 'poster');
      expect(primaryImage).toBeDefined();
      expect(primaryImage?.url).toBe('https://discogs.com/primary.jpg');
    });

    it('should handle no search results', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      const result = await adapter.fetchMetadata('Unknown Artist');

      expect(result.source).toBe('discogs');
      expect(result.overview).toBeUndefined();
      expect(result.images).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('API error'));

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.source).toBe('discogs');
      expect(result.overview).toBeUndefined();
      expect(result.fetchedAt).toBeDefined();
    });

    it('should handle missing profile gracefully', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            results: [{ id: 789, title: 'Minimal Artist', type: 'artist' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            id: 789,
            name: 'Minimal Artist',
            // No profile field
          }),
        });

      const result = await adapter.fetchMetadata('Minimal Artist');

      expect(result.source).toBe('discogs');
      expect(result.overview).toBeUndefined();
    });

    it('should handle rate limit errors', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.source).toBe('discogs');
      expect(result.overview).toBeUndefined();
      expect(result.fetchedAt).toBeDefined();
    });
  });
});
