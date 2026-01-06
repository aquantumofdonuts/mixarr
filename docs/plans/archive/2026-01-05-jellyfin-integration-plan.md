# Jellyfin Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Jellyfin support for listening history-based recommendations, achieving parity with the existing Plex/Tautulli integration.

**Architecture:** New `jellyfin` connection type uses Jellyfin's native REST API (no third-party tool). New `jellyfin_similar` subscription type mirrors `tautulli_similar` logic — fetch top artists by play count, then use Last.fm for similar artist discovery.

**Tech Stack:** Express.js, Prisma, TypeScript, Jellyfin REST API, Last.fm API

---

## Task 1: Add Database Enum Values

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/[timestamp]_add_jellyfin_support/migration.sql`

**Step 1: Update schema.prisma**

Add `jellyfin` to ConnectionType enum and `jellyfin_similar` to SubscriptionType enum:

```prisma
// In ConnectionType enum, add after 'discogs':
  jellyfin

// In SubscriptionType enum, add after 'tautulli_similar':
  jellyfin_similar
```

**Step 2: Generate migration**

```bash
cd apps/api && npx prisma migrate dev --name add_jellyfin_support
```

**Step 3: Verify migration created**

Check that migration SQL includes both enum alterations.

**Step 4: Commit**

```bash
git add apps/api/prisma && git commit -m "feat(db): add jellyfin connection and subscription types"
```

---

## Task 2: Add Shared Type

**Files:**
- Modify: `packages/shared-types/src/index.ts`

**Step 1: Add jellyfin_similar to SubscriptionType**

Find the `SubscriptionType` union and add after `tautulli_similar`:

```typescript
  | 'jellyfin_similar'
```

**Step 2: Commit**

```bash
git add packages/shared-types && git commit -m "feat(types): add jellyfin_similar subscription type"
```

---

## Task 3: Create JellyfinService - Types and Constructor

**Files:**
- Create: `apps/api/src/services/jellyfin.ts`
- Create: `apps/api/tests/services/jellyfin.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/jellyfin.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('JellyfinService', () => {
  describe('constructor', () => {
    it('should create service instance', async () => {
      const { JellyfinService } = await import('../../src/services/jellyfin.js');
      const service = new JellyfinService();
      expect(service).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npx vitest run tests/services/jellyfin.test.ts
```

Expected: FAIL - module not found

**Step 3: Create jellyfin.ts with types and constructor**

```typescript
// apps/api/src/services/jellyfin.ts
/**
 * Jellyfin Service
 * 
 * Handles interactions with Jellyfin API for listening history.
 */

import { rateLimit } from './rate-limiter.js';

export interface JellyfinConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId?: string;
  jellyfinLibraryId?: string;
}

export interface JellyfinUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface JellyfinLibrary {
  libraryId: string;
  name: string;
  type: string;
}

export interface JellyfinArtist {
  name: string;
  playCount: number;
  lastPlayed?: Date;
  thumb?: string;
}

export class JellyfinService {
  constructor() {}
}
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npx vitest run tests/services/jellyfin.test.ts
```

**Step 5: Commit**

```bash
git add apps/api/src/services/jellyfin.ts apps/api/tests/services/jellyfin.test.ts
git commit -m "feat(jellyfin): add JellyfinService types and constructor"
```

---

## Task 4: JellyfinService - testConnection

**Files:**
- Modify: `apps/api/src/services/jellyfin.ts`
- Modify: `apps/api/tests/services/jellyfin.test.ts`

**Step 1: Write failing test**

```typescript
describe('testConnection', () => {
  it('should return success for valid API key', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ServerName: 'My Jellyfin',
        Version: '10.8.0',
      }),
    });

    const service = new JellyfinService();
    const result = await service.testConnection({
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'valid-key',
    });

    expect(result.success).toBe(true);
  });

  it('should return error for invalid API key', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const service = new JellyfinService();
    const result = await service.testConnection({
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'invalid-key',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('401');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement testConnection**

```typescript
async testConnection(config: JellyfinConfig): Promise<{ success: boolean; error?: string; serverName?: string }> {
  try {
    const response = await this.callApi<{ ServerName: string; Version: string }>(
      config,
      '/System/Info/Public'
    );
    return { success: true, serverName: response.ServerName };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Connection failed' 
    };
  }
}

private async callApi<T>(config: JellyfinConfig, endpoint: string, params?: Record<string, string>): Promise<T> {
  await rateLimit('jellyfin');

  const url = new URL(endpoint, config.jellyfinUrl);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      'X-Emby-Token': config.jellyfinApiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Jellyfin API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/jellyfin.ts apps/api/tests/services/jellyfin.test.ts
git commit -m "feat(jellyfin): add testConnection method"
```

---

## Task 5: JellyfinService - getUsers

**Files:**
- Modify: `apps/api/src/services/jellyfin.ts`
- Modify: `apps/api/tests/services/jellyfin.test.ts`

**Step 1: Write failing test**

```typescript
describe('getUsers', () => {
  it('should return list of users', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { Id: 'user-1', Name: 'Alice', Policy: { IsAdministrator: true } },
        { Id: 'user-2', Name: 'Bob', Policy: { IsAdministrator: false } },
      ]),
    });

    const service = new JellyfinService();
    const users = await service.getUsers({
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'valid-key',
    });

    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ userId: 'user-1', username: 'Alice', isAdmin: true });
    expect(users[1]).toEqual({ userId: 'user-2', username: 'Bob', isAdmin: false });
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getUsers**

```typescript
async getUsers(config: JellyfinConfig): Promise<JellyfinUser[]> {
  interface JellyfinUserResponse {
    Id: string;
    Name: string;
    Policy: { IsAdministrator: boolean };
  }

  const users = await this.callApi<JellyfinUserResponse[]>(config, '/Users');
  
  return users.map(user => ({
    userId: user.Id,
    username: user.Name,
    isAdmin: user.Policy?.IsAdministrator ?? false,
  }));
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/jellyfin.ts apps/api/tests/services/jellyfin.test.ts
git commit -m "feat(jellyfin): add getUsers method"
```

---

## Task 6: JellyfinService - getLibraries

**Files:**
- Modify: `apps/api/src/services/jellyfin.ts`
- Modify: `apps/api/tests/services/jellyfin.test.ts`

**Step 1: Write failing test**

```typescript
describe('getLibraries', () => {
  it('should return music libraries only', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { ItemId: 'lib-1', Name: 'Music', CollectionType: 'music' },
        { ItemId: 'lib-2', Name: 'Movies', CollectionType: 'movies' },
        { ItemId: 'lib-3', Name: 'Audiobooks', CollectionType: 'music' },
      ]),
    });

    const service = new JellyfinService();
    const libraries = await service.getLibraries({
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'valid-key',
    });

    expect(libraries).toHaveLength(2);
    expect(libraries[0].name).toBe('Music');
    expect(libraries[1].name).toBe('Audiobooks');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getLibraries**

```typescript
async getLibraries(config: JellyfinConfig): Promise<JellyfinLibrary[]> {
  interface JellyfinLibraryResponse {
    ItemId: string;
    Name: string;
    CollectionType: string;
  }

  const libraries = await this.callApi<JellyfinLibraryResponse[]>(
    config,
    '/Library/VirtualFolders'
  );
  
  return libraries
    .filter(lib => lib.CollectionType === 'music')
    .map(lib => ({
      libraryId: lib.ItemId,
      name: lib.Name,
      type: lib.CollectionType,
    }));
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/jellyfin.ts apps/api/tests/services/jellyfin.test.ts
git commit -m "feat(jellyfin): add getLibraries method"
```

---

## Task 7: JellyfinService - getTopArtists

**Files:**
- Modify: `apps/api/src/services/jellyfin.ts`
- Modify: `apps/api/tests/services/jellyfin.test.ts`

**Step 1: Write failing test**

```typescript
describe('getTopArtists', () => {
  it('should return top artists by play count', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        Items: [
          { Name: 'Pink Floyd', UserData: { PlayCount: 150 }, Id: 'artist-1' },
          { Name: 'Led Zeppelin', UserData: { PlayCount: 100 }, Id: 'artist-2' },
        ],
        TotalRecordCount: 2,
      }),
    });

    const service = new JellyfinService();
    const artists = await service.getTopArtists(
      {
        jellyfinUrl: 'http://localhost:8096',
        jellyfinApiKey: 'valid-key',
        jellyfinUserId: 'user-1',
      },
      { period: 'month', limit: 10 }
    );

    expect(artists).toHaveLength(2);
    expect(artists[0].name).toBe('Pink Floyd');
    expect(artists[0].playCount).toBe(150);
  });

  it('should throw if userId not provided', async () => {
    const { JellyfinService } = await import('../../src/services/jellyfin.js');
    
    const service = new JellyfinService();
    
    await expect(service.getTopArtists(
      { jellyfinUrl: 'http://localhost:8096', jellyfinApiKey: 'key' },
      { period: 'month', limit: 10 }
    )).rejects.toThrow('Jellyfin user ID is required');
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getTopArtists**

```typescript
async getTopArtists(
  config: JellyfinConfig,
  options: { period: 'week' | 'month' | 'year' | 'all'; limit?: number }
): Promise<JellyfinArtist[]> {
  if (!config.jellyfinUserId) {
    throw new Error('Jellyfin user ID is required to fetch listening history');
  }

  const limit = options.limit || 25;
  const minDate = this.periodToDate(options.period);

  interface JellyfinItemsResponse {
    Items: Array<{
      Id: string;
      Name: string;
      UserData?: { PlayCount?: number; LastPlayedDate?: string };
      ImageTags?: { Primary?: string };
    }>;
    TotalRecordCount: number;
  }

  const params: Record<string, string> = {
    userId: config.jellyfinUserId,
    IncludeItemTypes: 'MusicArtist',
    SortBy: 'PlayCount',
    SortOrder: 'Descending',
    Recursive: 'true',
    Limit: limit.toString(),
  };

  if (config.jellyfinLibraryId) {
    params.ParentId = config.jellyfinLibraryId;
  }

  if (minDate) {
    params.MinDateLastPlayed = minDate.toISOString();
  }

  const response = await this.callApi<JellyfinItemsResponse>(
    config,
    `/Users/${config.jellyfinUserId}/Items`,
    params
  );

  return response.Items
    .filter(item => (item.UserData?.PlayCount || 0) > 0)
    .map(item => ({
      name: item.Name,
      playCount: item.UserData?.PlayCount || 0,
      lastPlayed: item.UserData?.LastPlayedDate 
        ? new Date(item.UserData.LastPlayedDate) 
        : undefined,
      thumb: item.ImageTags?.Primary 
        ? `${config.jellyfinUrl}/Items/${item.Id}/Images/Primary`
        : undefined,
    }));
}

private periodToDate(period: string): Date | null {
  const now = new Date();
  switch (period) {
    case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'year': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case 'all': return null;
    default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/jellyfin.ts apps/api/tests/services/jellyfin.test.ts
git commit -m "feat(jellyfin): add getTopArtists method"
```

---

## Task 8: Add Jellyfin Test Connection Route

**Files:**
- Modify: `apps/api/src/routes/connections.ts`

**Step 1: Find the test connection switch statement**

Search for `case 'tautulli':` in connections.ts

**Step 2: Add jellyfin case after tautulli**

```typescript
case 'jellyfin': {
  const { JellyfinService } = await import('../services/jellyfin.js');
  const service = new JellyfinService();
  const testResult = await service.testConnection({
    jellyfinUrl: config.jellyfinUrl,
    jellyfinApiKey: config.jellyfinApiKey,
  });
  result = {
    success: testResult.success,
    message: testResult.success 
      ? `Connected to ${testResult.serverName || 'Jellyfin'}` 
      : testResult.error || 'Connection failed',
  };
  break;
}
```

**Step 3: Add Jellyfin user/library fetch endpoints**

Add routes for fetching users and libraries after successful connection test (similar to Tautulli pattern).

**Step 4: Commit**

```bash
git add apps/api/src/routes/connections.ts
git commit -m "feat(jellyfin): add test connection route"
```

---

## Task 9: Add jellyfin_similar Subscription Worker Case

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Step 1: Find tautulli_similar case**

Search for `case 'tautulli_similar':` in subscription-worker.ts

**Step 2: Add jellyfin_similar case after tautulli_similar**

```typescript
case 'jellyfin_similar': {
  // Get artists similar to user's top Jellyfin listening history
  const jellyfinConn = connectionMap.get('jellyfin');
  if (!jellyfinConn) throw new Error('No active Jellyfin connection. Please add a Jellyfin connection first.');
  if (!lastfmConn) throw new Error('No active Last.fm connection. Required for similar artist lookup.');
  
  const jellyfinConfig = jellyfinConn.config as any;
  const lastfmConfigSim = lastfmConn.config as any;
  
  const { JellyfinService } = await import('../services/jellyfin.js');
  const jellyfin = new JellyfinService();
  const lastfmSim = new LastfmService({ apiKey: lastfmConfigSim.apiKey });
  
  // Config options (same as tautulli_similar)
  const period = config.period || 'month';
  const seedLimit = config.seedLimit || 10;
  const similarPerSeed = config.similarPerSeed || 5;
  const totalLimit = config.limit || 50;
  const minMatchCount = config.minMatchCount || 1;
  
  // Get top artists from Jellyfin listening history
  const topArtists = await jellyfin.getTopArtists(
    {
      jellyfinUrl: jellyfinConfig.jellyfinUrl,
      jellyfinApiKey: jellyfinConfig.jellyfinApiKey,
      jellyfinUserId: jellyfinConfig.jellyfinUserId,
      jellyfinLibraryId: jellyfinConfig.jellyfinLibraryId,
    },
    { period: period as 'week' | 'month' | 'year' | 'all', limit: seedLimit }
  );
  
  if (topArtists.length === 0) {
    throw new Error(`No listening history found for Jellyfin user (period: ${period})`);
  }
  
  // Collect similar artists from each seed using Last.fm
  const similarMap = new Map<string, { name: string; mbid?: string; match: number; seedCount: number; sources: string[] }>();
  
  for (const seed of topArtists) {
    try {
      const similarArtists = await lastfmSim.getSimilarArtists(seed.name, similarPerSeed);
      for (const similar of similarArtists) {
        const key = similar.name.toLowerCase();
        const existing = similarMap.get(key);
        if (existing) {
          existing.seedCount++;
          existing.sources.push(seed.name);
          if (similar.match > existing.match) {
            existing.match = similar.match;
          }
        } else {
          similarMap.set(key, {
            name: similar.name,
            mbid: similar.mbid,
            match: similar.match,
            seedCount: 1,
            sources: [seed.name],
          });
        }
      }
    } catch {
      // Skip this seed if API call fails
    }
  }
  
  // Filter by minMatchCount, sort by seedCount then match score
  const sortedSimilar = Array.from(similarMap.values())
    .filter(a => a.seedCount >= minMatchCount)
    .sort((a, b) => {
      if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
      return b.match - a.match;
    })
    .slice(0, totalLimit);
  
  artists = sortedSimilar.map(a => ({
    name: a.name,
    mbid: a.mbid,
    source: `jellyfin-similar-${period}`,
  }));
  break;
}
```

**Step 3: Add 'jellyfin' to connectionMap population**

Find where `connectionMap` is populated and ensure `jellyfin` connections are added.

**Step 4: Commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "feat(jellyfin): add jellyfin_similar subscription worker"
```

---

## Task 10: Add Jellyfin Subscription Presets

**Files:**
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Find Tautulli presets**

Search for `tautulli-similar-week` in subscriptions.ts

**Step 2: Add Jellyfin presets after Tautulli presets**

```typescript
// JELLYFIN
{
  id: 'jellyfin-similar-week',
  name: 'Jellyfin Similar Artists (Last Week)',
  description: 'Artists similar to your Jellyfin listening history from the past week',
  type: 'jellyfin_similar',
  category: 'library',
  config: { period: 'week', seedLimit: 10, similarPerSeed: 5, limit: 25, minMatchCount: 1 },
},
{
  id: 'jellyfin-similar-month',
  name: 'Jellyfin Similar Artists (Last Month)',
  description: 'Artists similar to your Jellyfin listening history from the past month',
  type: 'jellyfin_similar',
  category: 'library',
  config: { period: 'month', seedLimit: 15, similarPerSeed: 5, limit: 50, minMatchCount: 1 },
},
{
  id: 'jellyfin-similar-year',
  name: 'Jellyfin Similar Artists (Last Year)',
  description: 'Artists similar to your Jellyfin listening history from the past year',
  type: 'jellyfin_similar',
  category: 'library',
  config: { period: 'year', seedLimit: 20, similarPerSeed: 5, limit: 75, minMatchCount: 2 },
},
{
  id: 'jellyfin-similar-all',
  name: 'Jellyfin Similar Artists (All Time)',
  description: 'Artists similar to your all-time Jellyfin listening history',
  type: 'jellyfin_similar',
  category: 'library',
  config: { period: 'all', seedLimit: 25, similarPerSeed: 5, limit: 100, minMatchCount: 2 },
},
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/subscriptions.ts
git commit -m "feat(jellyfin): add subscription presets"
```

---

## Task 11: Add Jellyfin to UI Subscription Types

**Files:**
- Modify: `apps/web/src/app/subscriptions/page.tsx`

**Step 1: Find subscriptionTypes array**

Search for `tautulli_similar` in subscriptions/page.tsx

**Step 2: Add jellyfin_similar after tautulli_similar**

```typescript
{ value: 'jellyfin_similar', label: 'Jellyfin Similar', icon: Sparkles, description: 'Artists similar to your Jellyfin listening history' },
```

**Step 3: Add 'jellyfin' to preset categories if needed**

If there's a 'library' category for Plex, Jellyfin presets will automatically appear there.

**Step 4: Commit**

```bash
git add apps/web/src/app/subscriptions/page.tsx
git commit -m "feat(ui): add jellyfin_similar to subscription types"
```

---

## Task 12: Add Jellyfin Connection Form

**Files:**
- Modify: `apps/web/src/app/connections/page.tsx`

**Step 1: Add 'jellyfin' to connection types**

Find the connection type definitions and add Jellyfin.

**Step 2: Add Jellyfin-specific form fields**

```typescript
// Fields for Jellyfin connection
{type === 'jellyfin' && (
  <>
    <div className="space-y-2">
      <Label htmlFor="jellyfinUrl">Jellyfin URL</Label>
      <Input
        id="jellyfinUrl"
        placeholder="http://192.168.1.100:8096"
        value={config.jellyfinUrl || ''}
        onChange={(e) => setConfig({ ...config, jellyfinUrl: e.target.value })}
      />
    </div>
    <div className="space-y-2">
      <Label htmlFor="jellyfinApiKey">API Key</Label>
      <Input
        id="jellyfinApiKey"
        type="password"
        placeholder="Found in Dashboard → API Keys"
        value={config.jellyfinApiKey || ''}
        onChange={(e) => setConfig({ ...config, jellyfinApiKey: e.target.value })}
      />
    </div>
    {/* User dropdown populated after successful test */}
    {jellyfinUsers.length > 0 && (
      <div className="space-y-2">
        <Label htmlFor="jellyfinUserId">User</Label>
        <Select
          value={config.jellyfinUserId}
          onValueChange={(v) => setConfig({ ...config, jellyfinUserId: v })}
        >
          {jellyfinUsers.map(u => (
            <SelectItem key={u.userId} value={u.userId}>{u.username}</SelectItem>
          ))}
        </Select>
      </div>
    )}
    {/* Library dropdown (optional) */}
    {jellyfinLibraries.length > 0 && (
      <div className="space-y-2">
        <Label htmlFor="jellyfinLibraryId">Music Library (optional)</Label>
        <Select
          value={config.jellyfinLibraryId || ''}
          onValueChange={(v) => setConfig({ ...config, jellyfinLibraryId: v || undefined })}
        >
          <SelectItem value="">All Libraries</SelectItem>
          {jellyfinLibraries.map(l => (
            <SelectItem key={l.libraryId} value={l.libraryId}>{l.name}</SelectItem>
          ))}
        </Select>
      </div>
    )}
  </>
)}
```

**Step 3: Add fetch logic for users/libraries after test**

After successful connection test, fetch users and libraries from API.

**Step 4: Commit**

```bash
git add apps/web/src/app/connections/page.tsx
git commit -m "feat(ui): add Jellyfin connection form"
```

---

## Task 13: Add Jellyfin User/Library API Endpoints

**Files:**
- Modify: `apps/api/src/routes/connections.ts`

**Step 1: Add GET endpoint for Jellyfin users**

```typescript
// GET /api/connections/:id/jellyfin/users
router.get('/:id/jellyfin/users', requireAuth, async (req, res) => {
  // Fetch connection, instantiate JellyfinService, call getUsers()
});
```

**Step 2: Add GET endpoint for Jellyfin libraries**

```typescript
// GET /api/connections/:id/jellyfin/libraries
router.get('/:id/jellyfin/libraries', requireAuth, async (req, res) => {
  // Fetch connection, instantiate JellyfinService, call getLibraries()
});
```

**Step 3: Commit**

```bash
git add apps/api/src/routes/connections.ts
git commit -m "feat(api): add Jellyfin user and library endpoints"
```

---

## Task 14: Update README

**Files:**
- Modify: `README.md`

**Step 1: Add Jellyfin to supported services list**

Find "Plex/Tautulli" mentions and add Jellyfin alongside.

**Step 2: Add Jellyfin connection instructions**

```markdown
### Jellyfin
- Analyzes your Jellyfin listening history directly (no third-party tool needed)
- Get your API key from Jellyfin Dashboard → API Keys
- Similar artist recommendations based on play counts
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Jellyfin to supported services"
```

---

## Task 15: Integration Test

**Files:**
- Create: `apps/api/tests/services/jellyfin.integration.test.ts` (optional)

**Step 1: Run full test suite**

```bash
cd apps/api && npm test
```

**Step 2: Manual verification**

1. Start dev stack: `./start-dev.sh`
2. Add Jellyfin connection via UI
3. Create Jellyfin Similar subscription
4. Run subscription manually
5. Verify artists appear in results

**Step 3: Final commit**

```bash
git add -A && git commit -m "feat(jellyfin): complete integration"
```

---

## Summary

| Task | Description | Estimated Time |
|------|-------------|----------------|
| 1 | Database enum values | 5 min |
| 2 | Shared types | 2 min |
| 3 | JellyfinService base | 5 min |
| 4 | testConnection | 10 min |
| 5 | getUsers | 10 min |
| 6 | getLibraries | 10 min |
| 7 | getTopArtists | 15 min |
| 8 | Test connection route | 10 min |
| 9 | Subscription worker | 15 min |
| 10 | Subscription presets | 5 min |
| 11 | UI subscription types | 5 min |
| 12 | Connection form | 20 min |
| 13 | User/library endpoints | 10 min |
| 14 | README update | 5 min |
| 15 | Integration test | 15 min |

**Total:** ~2-3 hours
