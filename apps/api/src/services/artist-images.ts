/**
 * Cached artist image lookup.
 *
 * Drop-in replacement for the uncached fetchDeezerArtistImages():
 * Redis-backed (7-day positive TTL, 1-hour negative TTL), deduplicates
 * names that normalize identically, and bounds Deezer concurrency so a
 * 500-row page cannot burst-exhaust the public API quota.
 */

import { fetchDeezerArtistImage } from './deezer.js';
import {
  cacheService as defaultCacheService,
  CacheService,
  CACHE_MISS_SENTINEL,
  CACHE_TTLS,
  CACHE_KEYS,
} from './cache.js';
import { mapWithConcurrency } from '../lib/concurrency.js';

/** Max parallel Deezer calls per request. Matches FeedService enrichment. */
const IMAGE_FETCH_CONCURRENCY = 5;

/**
 * Normalize an artist name for cache keys and deduplication.
 * Must stay in sync with FeedService.normalizeName (Task 4 makes
 * FeedService import this one).
 */
export function normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve image URLs for a list of artist names.
 * Returns a Map keyed by the ORIGINAL input names (same contract as
 * fetchDeezerArtistImages) so call sites can swap imports 1:1.
 */
export async function getArtistImages(
  artistNames: string[],
  cache: CacheService | null = defaultCacheService
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();

  // Group original names by normalized key: fetch once per key.
  const byKey = new Map<string, string[]>();
  for (const name of artistNames) {
    if (!name) continue;
    const key = normalizeArtistName(name);
    if (!key) continue;
    const originals = byKey.get(key);
    if (originals) originals.push(name);
    else byKey.set(key, [name]);
  }

  await mapWithConcurrency([...byKey.entries()], IMAGE_FETCH_CONCURRENCY, async ([key, originals]) => {
    const cacheKey = CACHE_KEYS.deezerImage(key);

    if (cache) {
      const cached = await cache.get<string>(cacheKey);
      if (cached === CACHE_MISS_SENTINEL) return;
      if (cached !== null) {
        for (const name of originals) imageMap.set(name, cached);
        return;
      }
    }

    const imageUrl = await fetchDeezerArtistImage(originals[0]);
    if (imageUrl) {
      if (cache) await cache.set(cacheKey, imageUrl, CACHE_TTLS.DEEZER_IMAGE);
      for (const name of originals) imageMap.set(name, imageUrl);
    } else if (cache) {
      await cache.setMiss(cacheKey, CACHE_TTLS.MISS);
    }
  });

  return imageMap;
}
