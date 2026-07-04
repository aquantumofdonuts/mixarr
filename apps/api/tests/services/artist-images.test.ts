import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImage: vi.fn(),
}));

import { fetchDeezerArtistImage } from '../../src/services/deezer.js';
import { getArtistImages, normalizeArtistName } from '../../src/services/artist-images.js';
import { CACHE_MISS_SENTINEL } from '../../src/services/cache.js';
import type { CacheService } from '../../src/services/cache.js';

function makeFakeCache(store: Map<string, unknown> = new Map()) {
  return {
    store,
    get: vi.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    setMiss: vi.fn(async (key: string) => {
      store.set(key, CACHE_MISS_SENTINEL);
    }),
  } as unknown as CacheService & { store: Map<string, unknown> };
}

describe('normalizeArtistName', () => {
  it('lowercases, strips "The " prefix and non-alphanumerics', () => {
    expect(normalizeArtistName('The Beatles')).toBe('beatles');
    expect(normalizeArtistName('AC/DC')).toBe('acdc');
  });
});

describe('getArtistImages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cached URLs without calling Deezer', async () => {
    const cache = makeFakeCache(new Map([['deezer:image:beatles', 'https://img/beatles.jpg']]));
    const result = await getArtistImages(['The Beatles'], cache);
    expect(result.get('The Beatles')).toBe('https://img/beatles.jpg');
    expect(fetchDeezerArtistImage).not.toHaveBeenCalled();
  });

  it('fetches on cache miss and stores the result', async () => {
    vi.mocked(fetchDeezerArtistImage).mockResolvedValueOnce('https://img/acdc.jpg');
    const cache = makeFakeCache();
    const result = await getArtistImages(['AC/DC'], cache);
    expect(result.get('AC/DC')).toBe('https://img/acdc.jpg');
    expect(cache.set).toHaveBeenCalledWith('deezer:image:acdc', 'https://img/acdc.jpg', expect.any(Number));
  });

  it('caches negative results and skips refetching them', async () => {
    vi.mocked(fetchDeezerArtistImage).mockResolvedValueOnce(undefined);
    const cache = makeFakeCache();
    const first = await getArtistImages(['Nobody'], cache);
    expect(first.has('Nobody')).toBe(false);
    expect(cache.setMiss).toHaveBeenCalledWith('deezer:image:nobody', expect.any(Number));

    // Second call: sentinel hit, no fetch
    const second = await getArtistImages(['Nobody'], cache);
    expect(second.has('Nobody')).toBe(false);
    expect(fetchDeezerArtistImage).toHaveBeenCalledTimes(1);
  });

  it('fetches once for names that normalize identically, maps to all originals', async () => {
    vi.mocked(fetchDeezerArtistImage).mockResolvedValueOnce('https://img/beatles.jpg');
    const cache = makeFakeCache();
    const result = await getArtistImages(['The Beatles', 'the beatles!'], cache);
    expect(fetchDeezerArtistImage).toHaveBeenCalledTimes(1);
    expect(result.get('The Beatles')).toBe('https://img/beatles.jpg');
    expect(result.get('the beatles!')).toBe('https://img/beatles.jpg');
  });

  it('ignores empty/blank names', async () => {
    const cache = makeFakeCache();
    const result = await getArtistImages(['', '   ', '!!!'], cache);
    expect(result.size).toBe(0);
    expect(fetchDeezerArtistImage).not.toHaveBeenCalled();
  });
});
