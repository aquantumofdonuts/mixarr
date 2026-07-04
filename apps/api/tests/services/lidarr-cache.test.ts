import { describe, it, expect, vi } from 'vitest';
import { LidarrCache } from '../../src/services/lidarr.js';
import type { LidarrService } from '../../src/services/lidarr.js';

function makeFakeService(callCounter: { count: number }) {
  return {
    getArtists: vi.fn(async () => {
      callCounter.count++;
      await new Promise((r) => setTimeout(r, 20));
      return [{ foreignArtistId: 'mbid-1', artistName: 'The Beatles' }];
    }),
  } as unknown as LidarrService;
}

/** Fake service whose getArtists() only resolves when release() is called. */
function makeDeferredService() {
  const counter = { count: 0 };
  const pending: Array<() => void> = [];
  const service = {
    getArtists: vi.fn(
      () =>
        new Promise((resolve) => {
          counter.count++;
          pending.push(() => resolve([{ foreignArtistId: 'mbid-1', artistName: 'The Beatles' }]));
        })
    ),
  } as unknown as LidarrService;
  return { service, counter, release: () => pending.shift()?.() };
}

describe('LidarrCache refresh coalescing', () => {
  it('concurrent exists() calls trigger a single refresh', async () => {
    const counter = { count: 0 };
    const cache = new LidarrCache(makeFakeService(counter));

    const checks = await Promise.all([
      cache.exists({ mbid: 'mbid-1' }),
      cache.exists({ name: 'The Beatles' }),
      cache.exists({ mbid: 'nope' }),
    ]);

    expect(checks).toEqual([true, true, false]);
    expect(counter.count).toBe(1);
  });

  it('does not refresh again within the TTL', async () => {
    const counter = { count: 0 };
    const cache = new LidarrCache(makeFakeService(counter));
    await cache.exists({ mbid: 'mbid-1' });
    await cache.exists({ mbid: 'mbid-1' });
    expect(counter.count).toBe(1);
  });
});

describe('LidarrCache stale-while-revalidate', () => {
  it('serves stale data without waiting once populated', async () => {
    const { service, counter, release } = makeDeferredService();
    const cache = new LidarrCache(service, 5); // 5ms TTL for the test

    // First use: blocking population (nothing to serve yet)
    const first = cache.exists({ mbid: 'mbid-1' });
    release();
    expect(await first).toBe(true);
    expect(counter.count).toBe(1);

    await new Promise((r) => setTimeout(r, 10)); // let the TTL expire

    // A background refresh starts but is deliberately NOT released:
    // exists() must still resolve immediately from stale data.
    const result = await cache.exists({ mbid: 'mbid-1' });
    expect(result).toBe(true);
    expect(counter.count).toBe(2); // background refresh was kicked off

    release(); // let the background refresh finish cleanly
  });
});
