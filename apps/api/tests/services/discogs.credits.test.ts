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

  it('returns [] for a payload with no extraartists and no tracklist', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 7, title: 'Bare' }),
    });

    const service = new DiscogsService('test-token');
    const credits = await service.getReleaseCredits(7);

    expect(credits).toEqual([]);
  });

  it('does not throw when a track has no extraartists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 8,
          extraartists: [{ id: 20, name: 'Prod', role: 'Producer' }],
          tracklist: [{ position: 'A1', title: 'No Credits Track' }],
        }),
    });

    const service = new DiscogsService('test-token');
    const credits = await service.getReleaseCredits(8);

    expect(credits).toHaveLength(1);
    expect(credits[0].artistId).toBe(20);
    expect(credits[0].roles).toEqual(['producer']);
  });

  it('does not throw when a credit is missing its role (regression)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 9,
          extraartists: [{ id: 30, name: 'Roleless Artist' }],
          tracklist: [],
        }),
    });

    const service = new DiscogsService('test-token');
    const credits = await service.getReleaseCredits(9);

    // Artist is still emitted, with whatever roles remain (here: none).
    expect(credits).toHaveLength(1);
    expect(credits[0].artistId).toBe(30);
    expect(credits[0].roles).toEqual([]);
  });

  it('emits empty roles for a credit with an empty role string', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 10,
          extraartists: [{ id: 40, name: 'Empty Role', role: '' }],
          tracklist: [],
        }),
    });

    const service = new DiscogsService('test-token');
    const credits = await service.getReleaseCredits(10);

    expect(credits).toHaveLength(1);
    expect(credits[0].roles).toEqual([]);
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
