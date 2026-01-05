# Jellyfin Integration Design

**Date:** 2026-01-05  
**Status:** Approved  
**Priority:** Medium  
**Effort:** ~15-20 tasks  

## Overview

Add Jellyfin support for listening history-based recommendations, achieving parity with the existing Plex/Tautulli integration. Uses Jellyfin's native API directly (no third-party tool like Tautulli needed).

## Decisions

| Question | Decision |
|----------|----------|
| API approach | Use Jellyfin API directly (not Jellystat) |
| Subscription type name | `jellyfin_similar` |
| Auth method | API Key + User ID selection (matches Tautulli pattern) |
| Presets | 4 presets matching Tautulli (Week/Month/Year/All Time) |

---

## Design

### 1. Connection Type & Service

**New connection type:** `jellyfin`

**Connection config:**
```typescript
interface JellyfinConfig {
  jellyfinUrl: string;        // e.g., "http://192.168.1.100:8096"
  jellyfinApiKey: string;     // Generated in Jellyfin Dashboard → API Keys
  jellyfinUserId?: string;    // Selected from dropdown after connection test
  jellyfinLibraryId?: string; // Music library ID (optional filter)
}
```

**New service:** `apps/api/src/services/jellyfin.ts`

Mirrors TautulliService interface:
- `testConnection()` — Verify API key works
- `getUsers()` — List Jellyfin users for dropdown
- `getLibraries()` — List music libraries for dropdown
- `getTopArtists(config, { period, limit })` — Get most-played artists

**Jellyfin API endpoints used:**
| Endpoint | Purpose |
|----------|---------|
| `GET /System/Info` | Test connection |
| `GET /Users` | List users for selection |
| `GET /Library/VirtualFolders` | List libraries |
| `GET /Users/{userId}/Items?SortBy=PlayCount&IncludeItemTypes=MusicArtist` | Top artists by play count |

### 2. Subscription Type & Worker

**New subscription type:** `jellyfin_similar`

**Config options** (same as `tautulli_similar`):
```typescript
interface JellyfinSimilarConfig {
  period: 'week' | 'month' | 'year' | 'all';
  seedLimit: number;       // Default: 10
  similarPerSeed: number;  // Default: 5
  limit: number;           // Default: 50
  minMatchCount: number;   // Default: 1
}
```

**Worker logic** (mirrors `tautulli_similar`):
1. Fetch top artists from Jellyfin by play count (filtered by period)
2. For each seed artist, query Last.fm for similar artists
3. Aggregate: artists appearing from multiple seeds rank higher
4. Filter by `minMatchCount`, sort by frequency then match score
5. Return top N artists

**Dependency:** Requires active Last.fm connection

**Presets:**
| Preset Name | Period |
|-------------|--------|
| Jellyfin Similar (Week) | `week` |
| Jellyfin Similar (Month) | `month` |
| Jellyfin Similar (Year) | `year` |
| Jellyfin Similar (All Time) | `all` |

### 3. UI Components

**Connection form** — Multi-step config:
1. Enter URL + API Key → Test connection
2. Select user from dropdown
3. Optionally select music library
4. Save

**Subscription form:**
- Add `jellyfin_similar` to type dropdown
- Show period selector when type is `jellyfin_similar`

**Preset picker:**
- Add 4 Jellyfin presets to preset array

---

## Files Changed

### New Files
| File | Purpose |
|------|---------|
| `apps/api/src/services/jellyfin.ts` | JellyfinService class |
| `apps/api/tests/services/jellyfin.test.ts` | Unit tests |

### Modified Files
| File | Changes |
|------|---------|
| `apps/api/prisma/schema.prisma` | Add `jellyfin` to ConnectionType, `jellyfin_similar` to SubscriptionType |
| `apps/api/prisma/migrations/` | New migration for enum additions |
| `packages/shared-types/src/index.ts` | Add `jellyfin_similar` to SubscriptionType |
| `apps/api/src/routes/subscriptions.ts` | Add 4 Jellyfin presets |
| `apps/api/src/routes/connections.ts` | Add Jellyfin test connection handler |
| `apps/api/src/jobs/subscription-worker.ts` | Add `jellyfin_similar` case |
| `apps/web/src/app/connections/page.tsx` | Add Jellyfin connection form |
| `apps/web/src/app/subscriptions/page.tsx` | Add type to dropdown, icon mapping |
| `README.md` | Add Jellyfin to supported services |

---

## Implementation Notes

### Period Filtering

Jellyfin API doesn't have a native "play count in last week" filter. Implementation options:

1. **Client-side filtering** — Fetch all play data, filter by `LastPlayedDate` in service
2. **Use `MinDateLastPlayed` parameter** — Jellyfin supports this query param

Recommend option 2 if supported, fallback to option 1.

### Jellyfin API Authentication

All requests include header:
```
X-Emby-Token: {apiKey}
```

Or query parameter:
```
?api_key={apiKey}
```

### Error Handling

- Invalid API key → "Invalid Jellyfin API key. Generate one in Dashboard → API Keys"
- No music library → "No music libraries found in Jellyfin"
- User has no play history → "No listening history found for this user"
