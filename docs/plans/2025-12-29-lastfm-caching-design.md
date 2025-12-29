# Last.fm Stats Caching Design

**Date:** 2025-12-29  
**Status:** Approved  
**Priority:** Medium (Performance)

## Problem

Search with `enrich=true` makes 50 individual Last.fm API calls sequentially. With rate limiting at 5 req/sec, this takes 10+ seconds.

## Solution

Cache Last.fm artist stats in Redis with 1-hour TTL. First search for an artist is slow (API call), subsequent searches are instant (cache hit).

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Cache location | Redis | Already in stack, fast, supports TTL |
| TTL | 1 hour | Keep stats fresh, balance API load |
| Cache key format | `lastfm:artist:stats:{name}` | Clear namespace, normalized name |
| Null handling | Cache null with shorter TTL | Prevent hammering API for unknown artists |

## Implementation

### File: `apps/api/src/services/lastfm.ts`

Update `getArtistStats` to use Redis cache:

```typescript
import { redis } from '../lib/redis.js';

const CACHE_TTL = 3600; // 1 hour
const NULL_CACHE_TTL = 300; // 5 min for null results

function normalizeForCache(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async getArtistStats(artistName: string): Promise<{
  listeners: number;
  playcount: number;
  tags: string[];
} | null> {
  const cacheKey = `lastfm:artist:stats:${normalizeForCache(artistName)}`;
  
  // Check cache first
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return cached === 'null' ? null : JSON.parse(cached);
  }
  
  // Fetch from API
  try {
    const info = await this.getArtistInfo(artistName);
    const stats = {
      listeners: parseInt(info.stats?.listeners || info.listeners || '0', 10),
      playcount: parseInt(info.stats?.playcount || info.playcount || '0', 10),
      tags: info.tags?.tag?.map(t => t.name) || []
    };
    
    // Cache result
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(stats));
    return stats;
  } catch {
    // Cache null to prevent repeated failed lookups
    await redis.setex(cacheKey, NULL_CACHE_TTL, 'null');
    return null;
  }
}
```

## Testing

### Unit Tests
1. Cache hit returns cached data (no API call)
2. Cache miss calls API and stores result
3. Expired cache refetches from API
4. Null responses cached with shorter TTL

### Performance Test
- First search with 50 artists: ~10 seconds (API calls)
- Second search with same artists: <100ms (cache hits)

## Tasks

1. Add Redis import to lastfm.ts
2. Add normalize function for cache keys
3. Add cache check at start of getArtistStats
4. Add cache write after successful fetch
5. Handle null caching for unknown artists
6. Write unit tests for cache behavior
