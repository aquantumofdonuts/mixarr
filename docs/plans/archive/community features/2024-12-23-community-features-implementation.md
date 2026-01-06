# Community Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement 8 community-requested features across 5 phases.

**Architecture:** Schema extensions for album support, new services for ListenBrainz/Bandcamp/Discogs, aggregation layer for deduplication.

**Tech Stack:** TypeScript, Express, Prisma, Vitest

---

## Phase 1: Album-Level Imports + Release Type Filtering

### Task 1.1: Schema Migration for Album Support

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/XXXXXX_album_support/migration.sql`

**Step 1:** Add fields to SubscriptionResult model

```prisma
// In SubscriptionResult model, add after imageUrl:
albumMbid     String?   @map("album_mbid") @db.VarChar(36)
releaseDate   String?   @map("release_date") @db.VarChar(20)
releaseType   String?   @map("release_type") @db.VarChar(20)
sources       Json      @default("[]")
matchCount    Int       @default(1) @map("match_count")
```

**Step 2:** Add fields to ReviewItem model

```prisma
// In ReviewItem model, add after mbid:
albumMbid     String?   @map("album_mbid") @db.VarChar(36)
releaseDate   String?   @map("release_date") @db.VarChar(20)
releaseType   String?   @map("release_type") @db.VarChar(20)
itemType      String    @default("artist") @map("item_type") @db.VarChar(20)
```

**Step 3:** Run migration

```bash
cd apps/api && npx prisma migrate dev --name album_support
```

**Step 4:** Commit

```bash
git add -A && git commit -m "feat(schema): add album support fields to SubscriptionResult and ReviewItem"
```

---

### Task 1.2: Lidarr addAlbum Service Method

**Files:**
- Modify: `apps/api/src/services/lidarr.ts`
- Test: `apps/api/tests/api/search.test.ts`

**Step 1:** Write failing test

```typescript
// Add to search.test.ts
describe('LidarrService.addAlbum', () => {
  it('should add artist unmonitored then monitor specific album', async () => {
    const mockLidarr = createMockLidarr();
    mockLidarr.addArtist.mockResolvedValue({ id: 1, artistName: 'Test' });
    mockLidarr.getAlbums.mockResolvedValue([{ id: 10, foreignAlbumId: 'album-mbid', monitored: false }]);
    mockLidarr.updateAlbum.mockResolvedValue({ id: 10, monitored: true });
    
    const result = await mockLidarr.addAlbum('artist-mbid', 'album-mbid', 1, 1, '/music');
    expect(result.albumId).toBe(10);
  });
});
```

**Step 2:** Run test to verify fail

```bash
cd apps/api && npx vitest run tests/api/search.test.ts -t "addAlbum"
```

**Step 3:** Implement in lidarr.ts

```typescript
async addAlbum(
  artistMbid: string,
  albumMbid: string,
  qualityProfileId: number,
  metadataProfileId: number,
  rootFolderPath: string
): Promise<{ artistId: number; albumId: number }> {
  // Check if artist exists
  let artist = await this.getArtistByMbid(artistMbid);
  
  if (!artist) {
    // Add artist with all albums unmonitored
    artist = await this.addArtistUnmonitored(artistMbid, qualityProfileId, metadataProfileId, rootFolderPath);
  }
  
  // Find and monitor the specific album
  const albums = await this.getAlbums(artist.id);
  const album = albums.find(a => a.foreignAlbumId === albumMbid);
  
  if (!album) {
    throw new Error(`Album ${albumMbid} not found for artist ${artistMbid}`);
  }
  
  // Monitor this album
  await this.updateAlbum(album.id, { monitored: true });
  
  // Trigger search for this album
  await this.searchAlbum(album.id);
  
  return { artistId: artist.id, albumId: album.id };
}

async addArtistUnmonitored(
  mbid: string,
  qualityProfileId: number,
  metadataProfileId: number,
  rootFolderPath: string
): Promise<LidarrArtist> {
  const searchResults = await this.searchArtist(mbid);
  if (!searchResults.length) {
    throw new Error(`Artist not found: ${mbid}`);
  }
  
  const artistData = {
    ...searchResults[0],
    qualityProfileId,
    metadataProfileId,
    rootFolderPath,
    monitored: true,
    addOptions: { monitor: 'none', searchForMissingAlbums: false }
  };
  
  return this.request<LidarrArtist>('/artist', {
    method: 'POST',
    body: JSON.stringify(artistData)
  });
}

async getAlbums(artistId: number): Promise<LidarrAlbum[]> {
  return this.request<LidarrAlbum[]>(`/album?artistId=${artistId}`);
}

async updateAlbum(albumId: number, data: Partial<LidarrAlbum>): Promise<LidarrAlbum> {
  const album = await this.request<LidarrAlbum>(`/album/${albumId}`);
  return this.request<LidarrAlbum>(`/album/${albumId}`, {
    method: 'PUT',
    body: JSON.stringify({ ...album, ...data })
  });
}

async searchAlbum(albumId: number): Promise<void> {
  await this.request('/command', {
    method: 'POST',
    body: JSON.stringify({ name: 'AlbumSearch', albumIds: [albumId] })
  });
}
```

**Step 4:** Run test, verify pass

**Step 5:** Commit

```bash
git add -A && git commit -m "feat(lidarr): add addAlbum method for album-level imports"
```

---

### Task 1.3: Review Queue Album Support

**Files:**
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/web/src/app/(protected)/queue/page.tsx`

**Step 1:** Update approve endpoint to handle albums

```typescript
// In review.ts POST /:id/approve
const { itemType, mbid, albumMbid } = item;

if (itemType === 'album' && albumMbid) {
  await lidarr.addAlbum(mbid, albumMbid, qpId, mpId, rootFolder);
} else {
  await lidarr.addArtist(mbid, qpId, mpId, rootFolder);
}
```

**Step 2:** Update frontend to show album info

**Step 3:** Run tests, commit

```bash
git add -A && git commit -m "feat(review): support album-level approvals in review queue"
```

---

### Task 1.4: Release Type Filter Component

**Files:**
- Create: `apps/web/src/components/ReleaseTypeFilter.tsx`
- Modify: `apps/web/src/app/(protected)/discover/page.tsx`

**Step 1:** Create filter component

```tsx
'use client';
import { useState, useEffect } from 'react';

const RELEASE_TYPES = [
  { value: 'album', label: 'Album' },
  { value: 'ep', label: 'EP' },
  { value: 'single', label: 'Single' },
  { value: 'compilation', label: 'Compilation' },
  { value: 'soundtrack', label: 'Soundtrack' },
  { value: 'live', label: 'Live' },
  { value: 'remix', label: 'Remix' },
];

export function ReleaseTypeFilter({ 
  value, 
  onChange 
}: { 
  value: string[]; 
  onChange: (types: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {RELEASE_TYPES.map(type => (
        <label key={type.value} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={value.includes(type.value)}
            onChange={(e) => {
              if (e.target.checked) {
                onChange([...value, type.value]);
              } else {
                onChange(value.filter(v => v !== type.value));
              }
            }}
          />
          {type.label}
        </label>
      ))}
    </div>
  );
}
```

**Step 2:** Integrate into discover page

**Step 3:** Commit

```bash
git add -A && git commit -m "feat(web): add release type filter component"
```

---

## Phase 2: ListenBrainz Integration

### Task 2.1: Add ListenBrainz Connection Type

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add to ConnectionType enum)
- Run migration

```bash
# Add 'listenbrainz' to ConnectionType enum
git add -A && git commit -m "feat(schema): add listenbrainz connection type"
```

---

### Task 2.2: ListenBrainz Service

**Files:**
- Create: `apps/api/src/services/listenbrainz.ts`
- Test: `apps/api/tests/api/listenbrainz.test.ts`

**Step 1:** Create service with rate limiting

```typescript
import { rateLimit } from './rate-limiter.js';

const LISTENBRAINZ_API = 'https://api.listenbrainz.org';

export class ListenBrainzService {
  private username: string;
  private token?: string;

  constructor(username: string, token?: string) {
    this.username = username;
    this.token = token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await rateLimit('listenbrainz');
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Token ${this.token}`;
    
    const res = await fetch(`${LISTENBRAINZ_API}${endpoint}`, { headers });
    if (!res.ok) throw new Error(`ListenBrainz API error: ${res.status}`);
    return res.json();
  }

  async getUserTopArtists(period: string = 'all_time', count: number = 50) {
    return this.request<any>(`/1/stats/user/${this.username}/artists?range=${period}&count=${count}`);
  }

  async getRecommendations(type: 'top_artist' | 'similar_artist' = 'top_artist', count: number = 50) {
    return this.request<any>(`/1/cf/recommendation/user/${this.username}/recording?artist_type=${type}&count=${count}`);
  }

  async getSimilarUsers() {
    return this.request<any>(`/1/user/${this.username}/similar-users`);
  }

  async validateUser(): Promise<boolean> {
    try {
      await this.request(`/1/user/${this.username}`);
      return true;
    } catch {
      return false;
    }
  }
}
```

**Step 2:** Add tests, run, commit

```bash
git add -A && git commit -m "feat(api): add ListenBrainz service"
```

---

### Task 2.3: ListenBrainz Subscription Types

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (add to SubscriptionType enum)
- Modify: `apps/api/src/routes/subscriptions.ts` (add presets + handlers)

Add enum values:
```
listenbrainz_top
listenbrainz_similar
listenbrainz_recommendations
```

Add presets and handler in subscription runner.

**Step 3:** Commit

```bash
git add -A && git commit -m "feat(subscriptions): add ListenBrainz subscription types and presets"
```

---

## Phase 3: Multi-Source Aggregation

### Task 3.1: Deduplication Utility

**Files:**
- Create: `apps/api/src/utils/deduplication.ts`
- Test: `apps/api/tests/utils/deduplication.test.ts`

```typescript
export function normalizeArtistName(name: string): string {
  return name.toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9]/g, '');
}

export function deduplicateResults(results: SubscriptionResult[]): SubscriptionResult[] {
  const seen = new Map<string, SubscriptionResult>();
  
  for (const result of results) {
    const key = result.mbid || normalizeArtistName(result.name);
    const existing = seen.get(key);
    
    if (existing) {
      // Merge sources
      const sources = new Set([
        ...(existing.sources as string[] || []),
        ...(result.sources as string[] || [])
      ]);
      existing.sources = Array.from(sources);
      existing.matchCount = sources.size;
    } else {
      seen.set(key, { ...result, sources: result.sources || [], matchCount: 1 });
    }
  }
  
  return Array.from(seen.values())
    .sort((a, b) => b.matchCount - a.matchCount);
}
```

```bash
git add -A && git commit -m "feat(utils): add result deduplication utility"
```

---

## Phase 4: Bandcamp & Discogs Integration

### Task 4.1: Discogs Service

**Files:**
- Create: `apps/api/src/services/discogs.ts`
- Add `discogs` to ConnectionType enum

```typescript
const DISCOGS_API = 'https://api.discogs.com';

export class DiscogsService {
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    await rateLimit('discogs');
    const res = await fetch(`${DISCOGS_API}${endpoint}`, {
      headers: { 'Authorization': `Discogs token=${this.token}` }
    });
    if (!res.ok) throw new Error(`Discogs error: ${res.status}`);
    return res.json();
  }

  async searchLabels(query: string) {
    return this.request<any>(`/database/search?type=label&q=${encodeURIComponent(query)}`);
  }

  async getLabelReleases(labelId: number, page: number = 1) {
    return this.request<any>(`/labels/${labelId}/releases?page=${page}&per_page=50`);
  }

  async searchByStyle(style: string) {
    return this.request<any>(`/database/search?type=release&style=${encodeURIComponent(style)}`);
  }
}
```

```bash
git add -A && git commit -m "feat(api): add Discogs service"
```

---

### Task 4.2: Bandcamp Service

**Files:**
- Create: `apps/api/src/services/bandcamp.ts`

```typescript
export class BandcampService {
  async getTagReleases(tag: string, sort: 'pop' | 'date' = 'pop', page: number = 1) {
    await rateLimit('bandcamp');
    const res = await fetch(
      `https://bandcamp.com/api/hub/2/dig_deeper`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag_norm_names: [tag], page, sort })
      }
    );
    if (!res.ok) throw new Error(`Bandcamp error: ${res.status}`);
    return res.json();
  }
}
```

```bash
git add -A && git commit -m "feat(api): add Bandcamp service"
```

---

### Task 4.3: Discogs/Bandcamp Subscription Types

Add to schema enum and create handlers/presets.

```bash
git add -A && git commit -m "feat(subscriptions): add Discogs and Bandcamp subscription types"
```

---

## Phase 5: Genre Display

### Task 5.1: Genre Utility

**Files:**
- Create: `apps/api/src/utils/genre.ts`

```typescript
const GENRE_MAP: Record<string, string> = {
  'hip-hop': 'Hip-Hop', 'hip hop': 'Hip-Hop', 'hiphop': 'Hip-Hop',
  'r&b': 'R&B', 'rnb': 'R&B', 'r and b': 'R&B',
  'rock': 'Rock', 'pop': 'Pop', 'jazz': 'Jazz',
  'electronic': 'Electronic', 'metal': 'Metal',
};

export function normalizeGenre(genre: string): string {
  const lower = genre.toLowerCase().trim();
  return GENRE_MAP[lower] || genre.charAt(0).toUpperCase() + genre.slice(1).toLowerCase();
}

export function mergeGenres(sources: string[][]): string[] {
  const counts = new Map<string, number>();
  for (const source of sources) {
    for (const g of source) {
      const norm = normalizeGenre(g);
      counts.set(norm, (counts.get(norm) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([g]) => g);
}
```

```bash
git add -A && git commit -m "feat(utils): add genre normalization utility"
```

---

### Task 5.2: Genre Display in UI

Add genre pills to search results and subscription results components.

```bash
git add -A && git commit -m "feat(web): display genre pills in search and subscription results"
```

---

## Summary

| Phase | Tasks | Est. Time |
|-------|-------|-----------|
| 1. Album Imports | 4 tasks | 2-3 hours |
| 2. ListenBrainz | 3 tasks | 1-2 hours |
| 3. Aggregation | 1 task | 30 min |
| 4. Bandcamp/Discogs | 3 tasks | 1-2 hours |
| 5. Genre Display | 2 tasks | 30 min |

**Total: ~13 tasks, 5-8 hours**
