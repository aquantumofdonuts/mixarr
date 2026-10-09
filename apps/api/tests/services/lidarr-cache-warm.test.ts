// apps/api/tests/services/lidarr-cache-warm.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the skyhook warmer
vi.mock('../../src/services/skyhook-cache-warmer.js', () => ({
  skyhookWarmer: {
    warmArtist: vi.fn(),
  },
}));

// Mock fetch for Lidarr API calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { LidarrService } from '../../src/services/lidarr.js';
import { skyhookWarmer } from '../../src/services/skyhook-cache-warmer.js';

describe('LidarrService.addArtistWithCacheWarm', () => {
  let lidarr: LidarrService;
  const mockWarmer = vi.mocked(skyhookWarmer);

  beforeEach(() => {
    lidarr = new LidarrService({
      url: 'http://localhost:8686',
      apiKey: 'test-api-key',
    });
    mockFetch.mockReset();
    mockWarmer.warmArtist.mockReset();
  });

  it('reports already-in-library only after an exact existing artist lookup', async () => {
    const mbid = 'df494a19-4657-4a77-92b6-80325c63510f';
    const artist = { id: 1, artistName: 'Existing Artist', foreignArtistId: mbid };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => [artist] });
    const result = await lidarr.addArtistWithCacheWarm(mbid, 1, 1, '/music');
    expect(result).toMatchObject({ artist, alreadyInLibrary: true, cacheWarmed: false });
    expect(mockWarmer.warmArtist).not.toHaveBeenCalled(); expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('warms cache before adding artist', async () => {
    mockWarmer.warmArtist.mockResolvedValue({
      success: true,
      attempts: 2,
      cached: false,
    });

    // Mock getArtists() - return empty so artist appears new (triggers cache warm)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    // Mock Lidarr search response (for addArtist lookup)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
        artistName: 'Test Artist',
      }]),
    });

    // Mock Lidarr add response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
      }),
    });

    const result = await lidarr.addArtistWithCacheWarm(
      'df494a19-4657-4a77-92b6-80325c63510f',
      1,
      1,
      '/music'
    );

    expect(mockWarmer.warmArtist).toHaveBeenCalledWith('df494a19-4657-4a77-92b6-80325c63510f', { signal: undefined });
    expect(result.cacheWarmed).toBe(true);
    expect(result.artist.artistName).toBe('Test Artist');
  });

  it('proceeds with add even if cache warm fails', async () => {
    mockWarmer.warmArtist.mockResolvedValue({
      success: false,
      attempts: 5,
      cached: false,
      error: 'timeout',
    });

    // Mock getArtists() - return empty so artist appears new
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
        artistName: 'Test Artist',
      }]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
      }),
    });

    const result = await lidarr.addArtistWithCacheWarm(
      'df494a19-4657-4a77-92b6-80325c63510f',
      1,
      1,
      '/music'
    );

    expect(result.cacheWarmed).toBe(false);
    expect(result.artist).toBeDefined();
  });

  it('reports wasAlreadyCached=true when artist was already in SkyHook cache', async () => {
    mockWarmer.warmArtist.mockResolvedValue({
      success: true,
      attempts: 1,
      cached: true,
    });

    // Mock getArtists() - return empty so artist appears new
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
        artistName: 'Test Artist',
      }]),
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        id: 1,
        artistName: 'Test Artist',
        foreignArtistId: 'df494a19-4657-4a77-92b6-80325c63510f',
      }),
    });

    const result = await lidarr.addArtistWithCacheWarm(
      'df494a19-4657-4a77-92b6-80325c63510f',
      1,
      1,
      '/music'
    );

    expect(result.cacheWarmed).toBe(true);
    expect(result.wasAlreadyCached).toBe(true);
  });
});
