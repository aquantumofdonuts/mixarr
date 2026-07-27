import { describe, it, expect, vi, afterEach } from 'vitest';
import { DiscogsService, type DiscogsCredit } from '../../src/services/discogs.js';

// Mock the rate-limiter module
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('DiscogsService.getReleaseCredits', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('parses release + per-track credits, drops id:0, merges duplicates, carries master_id', async () => {
    const payload = {
      id: 789,
      title: 'Test Release',
      master_id: 456,
      // Release/album-wide credits
      extraartists: [
        { id: 10, name: 'Jane Doe', role: 'Producer, Mixed By' },
        { id: 0, name: 'Some Studio', role: 'Recorded At' },
      ],
      tracklist: [
        {
          position: 'A1',
          title: 'Track One',
          extraartists: [{ id: 11, name: 'John Roe', role: 'Bass [Fretless]' }],
        },
        {
          position: 'A2',
          title: 'Track Two',
          // Artist 10 again, with a different role -> should merge/union
          extraartists: [{ id: 10, name: 'Jane Doe', role: 'Written-By' }],
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });

    const service = new DiscogsService('test-token');
    const credits: DiscogsCredit[] = await service.getReleaseCredits(789);

    // id:0 free-text credit must be dropped
    expect(credits.find((c) => c.artistId === 0)).toBeUndefined();

    // Two distinct artists remain
    expect(credits).toHaveLength(2);

    // Artist 10 merged across release-level + track-level with unioned roles
    const jane = credits.find((c) => c.artistId === 10);
    expect(jane).toBeDefined();
    expect(jane?.name).toBe('Jane Doe');
    expect([...(jane?.roles ?? [])].sort()).toEqual(
      ['composer', 'engineer', 'producer'].sort()
    );

    // Artist 11 present, from per-track credits, normalized to performer
    const john = credits.find((c) => c.artistId === 11);
    expect(john).toBeDefined();
    expect(john?.roles).toEqual(['performer']);

    // master_id carried onto every credit
    for (const credit of credits) {
      expect(credit.masterId).toBe(456);
    }
  });

  it('carries masterId as null when master_id is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 1,
          title: 'No Master',
          extraartists: [{ id: 5, name: 'Solo Producer', role: 'Producer' }],
          tracklist: [],
        }),
    });

    const service = new DiscogsService('test-token');
    const credits = await service.getReleaseCredits(1);

    expect(credits).toHaveLength(1);
    expect(credits[0].masterId).toBeNull();
    expect(credits[0].roles).toEqual(['producer']);
  });

  it('hits the correct release endpoint', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 42, extraartists: [], tracklist: [] }),
    });
    global.fetch = mockFetch;

    const service = new DiscogsService('test-token');
    await service.getReleaseCredits(42);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.discogs.com/releases/42',
      expect.anything()
    );
  });

  it('throws on API error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const service = new DiscogsService('test-token');
    await expect(service.getReleaseCredits(999)).rejects.toThrow('Discogs API error');
  });
});
