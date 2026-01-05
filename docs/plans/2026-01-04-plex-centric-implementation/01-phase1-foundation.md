# Phase 1: Foundation - New Connections

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Plex, Prowlarr, SABnzbd, and slskd service integrations with connection management.

---

## Task 1: Add New Connection Types to Schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Update ConnectionType enum**

Add new connection types to the existing enum:

```prisma
enum ConnectionType {
  lidarr
  spotify
  lastfm
  tautulli
  deezer
  tidal
  listenbrainz
  discogs
  plex
  prowlarr
  sabnzbd
  slskd
}
```

**Step 2: Add DownloadJob model**

Add after the Connection model:

```prisma
model DownloadJob {
  id              Int             @id @default(autoincrement())
  userId          Int             @map("user_id")
  status          DownloadStatus  @default(pending)
  artist          String          @db.VarChar(255)
  album           String          @db.VarChar(255)
  year            Int?
  source          DownloadSource
  sourceId        String?         @map("source_id") @db.VarChar(255)
  downloadPath    String?         @map("download_path") @db.VarChar(500)
  destinationPath String?         @map("destination_path") @db.VarChar(500)
  retryCount      Int             @default(0) @map("retry_count")
  lastError       String?         @map("last_error") @db.Text
  metadata        Json?
  createdAt       DateTime        @default(now()) @map("created_at")
  updatedAt       DateTime        @updatedAt @map("updated_at")
  completedAt     DateTime?       @map("completed_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([status])
  @@index([sourceId])
  @@map("download_jobs")
}

enum DownloadStatus {
  pending
  searching
  downloading
  processing
  complete
  failed
}

enum DownloadSource {
  usenet
  soulseek
  lidarr
}
```

**Step 3: Add relation to User model**

Add to the User model relations:

```prisma
downloadJobs         DownloadJob[]
```

**Step 4: Generate migration**

Run: `cd apps/api && npx prisma migrate dev --name add_plex_download_models`

**Step 5: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add plex, prowlarr, sabnzbd, slskd connection types and download job model"
```

---

## Task 2: Create Plex Service - Types and Constructor

**Files:**
- Create: `apps/api/src/services/plex.ts`
- Create: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test for PlexService constructor**

```typescript
// apps/api/tests/services/plex.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Plex Service', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create service with valid config', async () => {
      const { PlexService } = await import('../../src/services/plex.js');
      
      const service = new PlexService({
        url: 'http://192.168.1.100:32400',
        token: 'test-token',
        musicLibraryId: 1,
      });

      expect(service).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: FAIL - module not found

**Step 3: Write minimal PlexService implementation**

```typescript
// apps/api/src/services/plex.ts
/**
 * Plex Service
 * 
 * Handles interactions with the Plex Media Server API.
 * Used for library state checks and triggering scans.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Plex');

export interface PlexConfig {
  url: string;
  token: string;
  musicLibraryId?: number;
  remotePath?: string;   // Path Plex sees
  localPath?: string;    // Path Mixarr sees
}

export interface PlexArtist {
  ratingKey: string;
  title: string;
  thumb?: string;
  art?: string;
  addedAt: number;
}

export interface PlexAlbum {
  ratingKey: string;
  parentRatingKey: string;  // Artist ID
  title: string;
  parentTitle: string;      // Artist name
  year?: number;
  thumb?: string;
  addedAt: number;
}

export interface PlexLibrary {
  key: string;
  title: string;
  type: string;
}

export class PlexService {
  private url: string;
  private token: string;
  private musicLibraryId?: number;
  private remotePath?: string;
  private localPath?: string;

  constructor(config: PlexConfig) {
    this.url = config.url.replace(/\/$/, ''); // Remove trailing slash
    this.token = config.token;
    this.musicLibraryId = config.musicLibraryId;
    this.remotePath = config.remotePath;
    this.localPath = config.localPath;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add PlexService with types and constructor"
```

---

## Task 3: Plex Service - HTTP Request Helper

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test for request method**

Add to the test file:

```typescript
describe('request', () => {
  it('should make authenticated request to Plex', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ MediaContainer: { size: 1 } }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    // Access private method via any cast for testing
    const result = await (service as any).request('/library/sections');

    expect(mockFetch).toHaveBeenCalledWith(
      'http://192.168.1.100:32400/library/sections',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'test-token',
          'Accept': 'application/json',
        }),
      })
    );
    expect(result.MediaContainer.size).toBe(1);
  });

  it('should throw on non-ok response', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'bad-token',
    });

    await expect((service as any).request('/library/sections'))
      .rejects.toThrow('Plex API error: 401 Unauthorized');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: FAIL - request method doesn't exist

**Step 3: Add request method to PlexService**

Add to PlexService class:

```typescript
private async request<T>(endpoint: string): Promise<T> {
  await rateLimit('plex');

  const response = await fetch(`${this.url}${endpoint}`, {
    headers: {
      'X-Plex-Token': this.token,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add authenticated request helper"
```

---

## Task 4: Plex Service - Test Connection

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('testConnection', () => {
  it('should return success with server name on valid connection', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          friendlyName: 'My Plex Server',
          version: '1.32.0',
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    const result = await service.testConnection();

    expect(result.success).toBe(true);
    expect(result.serverName).toBe('My Plex Server');
    expect(result.version).toBe('1.32.0');
  });

  it('should return failure on connection error', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: FAIL - testConnection not defined

**Step 3: Implement testConnection**

Add to PlexService class:

```typescript
async testConnection(): Promise<{
  success: boolean;
  serverName?: string;
  version?: string;
  error?: string;
}> {
  try {
    const response = await this.request<{
      MediaContainer: { friendlyName: string; version: string };
    }>('/');

    return {
      success: true,
      serverName: response.MediaContainer.friendlyName,
      version: response.MediaContainer.version,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add testConnection method"
```

---

## Task 5: Plex Service - Get Libraries

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('getLibraries', () => {
  it('should return list of libraries', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Music', type: 'artist' },
            { key: '2', title: 'Movies', type: 'movie' },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    const libraries = await service.getLibraries();

    expect(libraries).toHaveLength(2);
    expect(libraries[0]).toEqual({ key: '1', title: 'Music', type: 'artist' });
  });

  it('should filter to music libraries only when requested', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Directory: [
            { key: '1', title: 'Music', type: 'artist' },
            { key: '2', title: 'Movies', type: 'movie' },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    const musicLibraries = await service.getLibraries({ musicOnly: true });

    expect(musicLibraries).toHaveLength(1);
    expect(musicLibraries[0].title).toBe('Music');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement getLibraries**

```typescript
async getLibraries(options?: { musicOnly?: boolean }): Promise<PlexLibrary[]> {
  const response = await this.request<{
    MediaContainer: {
      Directory: Array<{ key: string; title: string; type: string }>;
    };
  }>('/library/sections');

  let libraries = response.MediaContainer.Directory.map(dir => ({
    key: dir.key,
    title: dir.title,
    type: dir.type,
  }));

  if (options?.musicOnly) {
    libraries = libraries.filter(lib => lib.type === 'artist');
  }

  return libraries;
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add getLibraries method"
```

---

## Task 6: Plex Service - Get Artists

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('getArtists', () => {
  it('should return artists from music library', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [
            { ratingKey: '100', title: 'Pink Floyd', thumb: '/thumb/100', addedAt: 1700000000 },
            { ratingKey: '101', title: 'Led Zeppelin', addedAt: 1700000001 },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const artists = await service.getArtists();

    expect(artists).toHaveLength(2);
    expect(artists[0].title).toBe('Pink Floyd');
    expect(artists[0].ratingKey).toBe('100');
  });

  it('should throw if no music library configured', async () => {
    const { PlexService } = await import('../../src/services/plex.js');

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
    });

    await expect(service.getArtists()).rejects.toThrow('No music library configured');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement getArtists**

```typescript
async getArtists(): Promise<PlexArtist[]> {
  if (!this.musicLibraryId) {
    throw new Error('No music library configured');
  }

  const response = await this.request<{
    MediaContainer: {
      Metadata?: Array<{
        ratingKey: string;
        title: string;
        thumb?: string;
        art?: string;
        addedAt: number;
      }>;
    };
  }>(`/library/sections/${this.musicLibraryId}/all?type=8`); // type=8 is artist

  return (response.MediaContainer.Metadata || []).map(artist => ({
    ratingKey: artist.ratingKey,
    title: artist.title,
    thumb: artist.thumb,
    art: artist.art,
    addedAt: artist.addedAt,
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add getArtists method"
```

---

## Task 7: Plex Service - Get Albums for Artist

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('getAlbumsForArtist', () => {
  it('should return albums for a specific artist', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [
            { 
              ratingKey: '200', 
              parentRatingKey: '100',
              title: 'The Dark Side of the Moon', 
              parentTitle: 'Pink Floyd',
              year: 1973,
              addedAt: 1700000000,
            },
            { 
              ratingKey: '201', 
              parentRatingKey: '100',
              title: 'Wish You Were Here', 
              parentTitle: 'Pink Floyd',
              year: 1975,
              addedAt: 1700000001,
            },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const albums = await service.getAlbumsForArtist('100');

    expect(albums).toHaveLength(2);
    expect(albums[0].title).toBe('The Dark Side of the Moon');
    expect(albums[0].year).toBe(1973);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement getAlbumsForArtist**

```typescript
async getAlbumsForArtist(artistRatingKey: string): Promise<PlexAlbum[]> {
  const response = await this.request<{
    MediaContainer: {
      Metadata?: Array<{
        ratingKey: string;
        parentRatingKey: string;
        title: string;
        parentTitle: string;
        year?: number;
        thumb?: string;
        addedAt: number;
      }>;
    };
  }>(`/library/metadata/${artistRatingKey}/children`);

  return (response.MediaContainer.Metadata || []).map(album => ({
    ratingKey: album.ratingKey,
    parentRatingKey: album.parentRatingKey,
    title: album.title,
    parentTitle: album.parentTitle,
    year: album.year,
    thumb: album.thumb,
    addedAt: album.addedAt,
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add getAlbumsForArtist method"
```

---

## Task 8: Plex Service - Check Artist Exists

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('artistExists', () => {
  it('should return true if artist exists in library', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [
            { ratingKey: '100', title: 'Pink Floyd' },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const exists = await service.artistExists('Pink Floyd');

    expect(exists).toBe(true);
  });

  it('should return false if artist not in library', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const exists = await service.artistExists('Unknown Artist');

    expect(exists).toBe(false);
  });

  it('should normalize artist names for comparison', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [
            { ratingKey: '100', title: 'The Beatles' },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    // Should match without "The" prefix
    const exists = await service.artistExists('Beatles');

    expect(exists).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement artistExists**

```typescript
private normalizeArtistName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, '')  // Remove leading "The "
    .replace(/[^a-z0-9]/g, '') // Remove special chars
    .trim();
}

async artistExists(artistName: string): Promise<boolean> {
  if (!this.musicLibraryId) {
    throw new Error('No music library configured');
  }

  const encodedName = encodeURIComponent(artistName);
  const response = await this.request<{
    MediaContainer: {
      Metadata?: Array<{ ratingKey: string; title: string }>;
    };
  }>(`/library/sections/${this.musicLibraryId}/all?type=8&title=${encodedName}`);

  const normalizedSearch = this.normalizeArtistName(artistName);
  
  return (response.MediaContainer.Metadata || []).some(
    artist => this.normalizeArtistName(artist.title) === normalizedSearch
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add artistExists method with name normalization"
```

---

## Task 9: Plex Service - Check Album Exists

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('albumExists', () => {
  it('should return true if album exists for artist', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    // First call: search for artist
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [{ ratingKey: '100', title: 'Pink Floyd' }],
        },
      }),
    });
    
    // Second call: get albums for artist
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: {
          Metadata: [
            { ratingKey: '200', title: 'The Dark Side of the Moon', year: 1973 },
          ],
        },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const exists = await service.albumExists('Pink Floyd', 'The Dark Side of the Moon');

    expect(exists).toBe(true);
  });

  it('should return false if artist not in library', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        MediaContainer: { Metadata: [] },
      }),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    const exists = await service.albumExists('Unknown Artist', 'Unknown Album');

    expect(exists).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement albumExists**

```typescript
private normalizeAlbumTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')  // Remove parenthetical like "(Remaster)"
    .replace(/\s*\[[^\]]*\]\s*/g, '') // Remove brackets like "[Deluxe]"
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async albumExists(artistName: string, albumTitle: string): Promise<boolean> {
  if (!this.musicLibraryId) {
    throw new Error('No music library configured');
  }

  // Find artist first
  const encodedArtist = encodeURIComponent(artistName);
  const artistResponse = await this.request<{
    MediaContainer: {
      Metadata?: Array<{ ratingKey: string; title: string }>;
    };
  }>(`/library/sections/${this.musicLibraryId}/all?type=8&title=${encodedArtist}`);

  const normalizedArtist = this.normalizeArtistName(artistName);
  const artist = (artistResponse.MediaContainer.Metadata || []).find(
    a => this.normalizeArtistName(a.title) === normalizedArtist
  );

  if (!artist) {
    return false;
  }

  // Get albums for artist
  const albums = await this.getAlbumsForArtist(artist.ratingKey);
  const normalizedAlbum = this.normalizeAlbumTitle(albumTitle);

  return albums.some(
    album => this.normalizeAlbumTitle(album.title) === normalizedAlbum
  );
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add albumExists method"
```

---

## Task 10: Plex Service - Trigger Library Scan

**Files:**
- Modify: `apps/api/src/services/plex.ts`
- Modify: `apps/api/tests/services/plex.test.ts`

**Step 1: Write failing test**

```typescript
describe('scanLibrary', () => {
  it('should trigger full library scan', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
    });

    await service.scanLibrary();

    expect(mockFetch).toHaveBeenCalledWith(
      'http://192.168.1.100:32400/library/sections/1/refresh',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Plex-Token': 'test-token',
        }),
      })
    );
  });

  it('should trigger partial scan for specific path', async () => {
    const { PlexService } = await import('../../src/services/plex.js');
    
    mockFetch.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(''),
    });

    const service = new PlexService({
      url: 'http://192.168.1.100:32400',
      token: 'test-token',
      musicLibraryId: 1,
      remotePath: '/music',
      localPath: '/data/music',
    });

    await service.scanLibrary('/data/music/Pink Floyd');

    // Path should be translated from local to remote
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/library/sections/1/refresh?path='),
      expect.any(Object)
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 3: Implement scanLibrary**

```typescript
async scanLibrary(localPath?: string): Promise<void> {
  if (!this.musicLibraryId) {
    throw new Error('No music library configured');
  }

  let endpoint = `/library/sections/${this.musicLibraryId}/refresh`;

  if (localPath && this.localPath && this.remotePath) {
    // Translate local path to Plex's remote path
    const plexPath = localPath.replace(this.localPath, this.remotePath);
    endpoint += `?path=${encodeURIComponent(plexPath)}`;
  }

  await rateLimit('plex');

  const response = await fetch(`${this.url}${endpoint}`, {
    headers: {
      'X-Plex-Token': this.token,
    },
  });

  if (!response.ok) {
    throw new Error(`Plex scan failed: ${response.status} ${response.statusText}`);
  }

  log.info(`Triggered library scan${localPath ? ` for ${localPath}` : ''}`);
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/api && npx vitest run tests/services/plex.test.ts -v`

**Step 5: Commit**

```bash
git add apps/api/src/services/plex.ts apps/api/tests/services/plex.test.ts
git commit -m "feat(plex): add scanLibrary method with path translation"
```

---

## Remaining Tasks in Phase 1

Tasks 11-15: **Plex OAuth Flow** (PIN request, poll, server discovery)
Tasks 16-20: **Prowlarr Service** (search indexers, get results)
Tasks 21-25: **SABnzbd Service** (add NZB, check status, get history)
Tasks 26-30: **slskd Service** (search, download, check status)
Tasks 31-35: **Connection Routes** (CRUD for new connection types)
Tasks 36-40: **Rate Limiter Updates** (add plex, prowlarr, sabnzbd, slskd)
Tasks 41-45: **Integration Tests** (end-to-end connection flows)

See [01b-phase1-continued.md](01b-phase1-continued.md) for remaining Phase 1 tasks.
