import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscogsService } from '../../src/services/discogs.js';

// Mock the rate-limiter so the paginated fetch loop runs without real delays.
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('DiscogsService.getArtistReleases', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('hits the artist-releases endpoint and returns the raw items', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          pagination: { page: 1, pages: 1, per_page: 100, items: 2 },
          releases: [
            { id: 111, type: 'release', title: 'A', year: 1999 },
            { id: 222, type: 'master', title: 'B', year: 2001, main_release: 223 },
          ],
        }),
    });
    global.fetch = mockFetch;

    const service = new DiscogsService('test-token');
    const items = await service.getArtistReleases(42);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.discogs.com/artists/42/releases?page=1&per_page=100',
      expect.anything(),
    );
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 111, type: 'release', year: 1999 });
    expect(items[1]).toMatchObject({ id: 222, type: 'master', main_release: 223 });
  });

  it('follows pagination up to maxPages and concatenates the releases', async () => {
    const page1 = {
      pagination: { page: 1, pages: 3, per_page: 1, items: 3 },
      releases: [{ id: 1, type: 'release' }],
    };
    const page2 = {
      pagination: { page: 2, pages: 3, per_page: 1, items: 3 },
      releases: [{ id: 2, type: 'release' }],
    };
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page1) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(page2) });
    global.fetch = mockFetch;

    const service = new DiscogsService('test-token');
    // Cap at 2 pages even though the API reports 3.
    const items = await service.getArtistReleases(7, { maxPages: 2 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(items.map((r) => r.id)).toEqual([1, 2]);
  });

  it('throws on an API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    const service = new DiscogsService('test-token');
    await expect(service.getArtistReleases(99)).rejects.toThrow('Discogs API error');
  });
});
