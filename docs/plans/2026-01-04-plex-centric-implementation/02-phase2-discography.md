# Phase 2: Discography Layer

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create unified discography service that fetches artist/album data from multiple sources with fallback chain.

---

## Task 1: Create Unified Types

**Files:**
- Create: `apps/api/src/services/discography.types.ts`

**Step 1: Create the types file**

```typescript
// apps/api/src/services/discography.types.ts
/**
 * Unified types for multi-source discography data.
 */

export type DiscographySource = 'lidarr' | 'spotify' | 'musicbrainz' | 'discogs';

export interface UnifiedArtist {
  name: string;
  sourceId: string;
  source: DiscographySource;
  mbid?: string;           // MusicBrainz ID if available
  imageUrl?: string;
  genres?: string[];
  overview?: string;
}

export interface UnifiedAlbum {
  title: string;
  year?: number;
  sourceId: string;
  source: DiscographySource;
  mbid?: string;
  artistName: string;
  artistSourceId: string;
  trackCount?: number;
  albumType?: 'album' | 'single' | 'ep' | 'compilation' | 'live' | 'other';
  imageUrl?: string;
  releaseDate?: string;
}

export interface DiscographyResult {
  artist: UnifiedArtist;
  albums: UnifiedAlbum[];
  source: DiscographySource;
  cached: boolean;
  fetchedAt: Date;
}

export interface ArtistSearchResult {
  artists: UnifiedArtist[];
  source: DiscographySource;
}
```

**Step 2: Commit**

```bash
git add apps/api/src/services/discography.types.ts
git commit -m "feat(discography): add unified types for multi-source data"
```

---

## Task 2: Create Discography Service - Base Structure

**Files:**
- Create: `apps/api/src/services/discography.ts`
- Create: `apps/api/tests/services/discography.test.ts`

**Step 1: Write failing test**

```typescript
// apps/api/tests/services/discography.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

describe('Discography Service', () => {
  describe('constructor', () => {
    it('should create service with source services', async () => {
      const { DiscographyService } = await import('../../src/services/discography.js');
      
      const service = new DiscographyService({});

      expect(service).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/api && npx vitest run tests/services/discography.test.ts -v`

**Step 3: Create DiscographyService base**

```typescript
// apps/api/src/services/discography.ts
/**
 * Discography Service
 * 
 * Unified service for fetching artist discography from multiple sources.
 * Implements fallback chain: Lidarr → Spotify → MusicBrainz → Discogs
 */

import { createLogger } from '../lib/logger.js';
import { LidarrService } from './lidarr.js';
import { SpotifyService } from './spotify.js';
import { MusicBrainzService } from './musicbrainz.js';
import { DiscogsService } from './discogs.js';
import type {
  DiscographySource,
  UnifiedArtist,
  UnifiedAlbum,
  DiscographyResult,
  ArtistSearchResult,
} from './discography.types.js';

const log = createLogger('Discography');

export interface DiscographyConfig {
  lidarr?: LidarrService;
  spotify?: SpotifyService;
  musicbrainz?: MusicBrainzService;
  discogs?: DiscogsService;
  cacheEnabled?: boolean;
  cacheTtlMs?: number;
}

export class DiscographyService {
  private lidarr?: LidarrService;
  private spotify?: SpotifyService;
  private musicbrainz: MusicBrainzService;
  private discogs?: DiscogsService;
  private cacheEnabled: boolean;
  private cacheTtlMs: number;

  // In-memory cache (could be Redis in production)
  private cache: Map<string, { data: DiscographyResult; expiresAt: number }> = new Map();

  constructor(config: DiscographyConfig) {
    this.lidarr = config.lidarr;
    this.spotify = config.spotify;
    this.musicbrainz = config.musicbrainz || new MusicBrainzService();
    this.discogs = config.discogs;
    this.cacheEnabled = config.cacheEnabled ?? true;
    this.cacheTtlMs = config.cacheTtlMs ?? 24 * 60 * 60 * 1000; // 24 hours
  }

  private getCacheKey(type: string, identifier: string): string {
    return `${type}:${identifier.toLowerCase()}`;
  }

  private getFromCache(key: string): DiscographyResult | null {
    if (!this.cacheEnabled) return null;
    
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { ...cached.data, cached: true };
    }
    
    this.cache.delete(key);
    return null;
  }

  private setCache(key: string, data: DiscographyResult): void {
    if (!this.cacheEnabled) return;
    
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}

export * from './discography.types.js';
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/discography.ts apps/api/tests/services/discography.test.ts
git commit -m "feat(discography): add DiscographyService base structure"
```

---

## Task 3: Discography Service - Search Artist

**Files:**
- Modify: `apps/api/src/services/discography.ts`
- Modify: `apps/api/tests/services/discography.test.ts`

**Step 1: Write failing test**

```typescript
describe('searchArtist', () => {
  it('should search Lidarr first when available', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockLidarr = {
      searchArtist: vi.fn().mockResolvedValue([
        { foreignArtistId: 'mbid-123', artistName: 'Pink Floyd' },
      ]),
    };

    const service = new DiscographyService({
      lidarr: mockLidarr as any,
    });

    const results = await service.searchArtist('Pink Floyd');

    expect(mockLidarr.searchArtist).toHaveBeenCalledWith('Pink Floyd');
    expect(results.artists).toHaveLength(1);
    expect(results.artists[0].name).toBe('Pink Floyd');
    expect(results.source).toBe('lidarr');
  });

  it('should fallback to Spotify when Lidarr fails', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockLidarr = {
      searchArtist: vi.fn().mockRejectedValue(new Error('Lidarr unavailable')),
    };
    
    const mockSpotify = {
      searchArtists: vi.fn().mockResolvedValue({
        artists: { items: [{ id: 'spotify-123', name: 'Pink Floyd' }] },
      }),
    };

    const service = new DiscographyService({
      lidarr: mockLidarr as any,
      spotify: mockSpotify as any,
    });

    const results = await service.searchArtist('Pink Floyd');

    expect(results.source).toBe('spotify');
    expect(results.artists).toHaveLength(1);
  });

  it('should fallback to MusicBrainz when Spotify unavailable', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockMusicBrainz = {
      searchArtist: vi.fn().mockResolvedValue([
        { id: 'mbid-123', name: 'Pink Floyd', score: 100 },
      ]),
    };

    const service = new DiscographyService({
      musicbrainz: mockMusicBrainz as any,
    });

    const results = await service.searchArtist('Pink Floyd');

    expect(results.source).toBe('musicbrainz');
    expect(results.artists).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement searchArtist**

```typescript
async searchArtist(name: string): Promise<ArtistSearchResult> {
  const errors: string[] = [];

  // Try Lidarr first
  if (this.lidarr) {
    try {
      log.debug(`Searching Lidarr for: ${name}`);
      const results = await this.lidarr.searchArtist(name);
      
      if (results.length > 0) {
        return {
          artists: results.map(r => this.normalizeFromLidarr(r)),
          source: 'lidarr',
        };
      }
    } catch (error) {
      errors.push(`Lidarr: ${error instanceof Error ? error.message : 'Unknown error'}`);
      log.warn(`Lidarr search failed: ${errors[errors.length - 1]}`);
    }
  }

  // Try Spotify
  if (this.spotify) {
    try {
      log.debug(`Searching Spotify for: ${name}`);
      const results = await this.spotify.searchArtists(name);
      
      if (results.artists?.items?.length > 0) {
        return {
          artists: results.artists.items.map(r => this.normalizeFromSpotify(r)),
          source: 'spotify',
        };
      }
    } catch (error) {
      errors.push(`Spotify: ${error instanceof Error ? error.message : 'Unknown error'}`);
      log.warn(`Spotify search failed: ${errors[errors.length - 1]}`);
    }
  }

  // Try MusicBrainz
  try {
    log.debug(`Searching MusicBrainz for: ${name}`);
    const results = await this.musicbrainz.searchArtist(name);
    
    if (results.length > 0) {
      return {
        artists: results.map(r => this.normalizeFromMusicBrainz(r)),
        source: 'musicbrainz',
      };
    }
  } catch (error) {
    errors.push(`MusicBrainz: ${error instanceof Error ? error.message : 'Unknown error'}`);
    log.warn(`MusicBrainz search failed: ${errors[errors.length - 1]}`);
  }

  // Try Discogs
  if (this.discogs) {
    try {
      log.debug(`Searching Discogs for: ${name}`);
      const results = await this.discogs.searchArtist(name);
      
      if (results.length > 0) {
        return {
          artists: results.map(r => this.normalizeFromDiscogs(r)),
          source: 'discogs',
        };
      }
    } catch (error) {
      errors.push(`Discogs: ${error instanceof Error ? error.message : 'Unknown error'}`);
      log.warn(`Discogs search failed: ${errors[errors.length - 1]}`);
    }
  }

  // All sources failed
  log.error(`All sources failed for artist search: ${name}`, { errors });
  return { artists: [], source: 'musicbrainz' };
}

// Normalization helpers
private normalizeFromLidarr(artist: any): UnifiedArtist {
  return {
    name: artist.artistName,
    sourceId: artist.foreignArtistId,
    source: 'lidarr',
    mbid: artist.foreignArtistId,
    imageUrl: artist.images?.[0]?.url,
    overview: artist.overview,
  };
}

private normalizeFromSpotify(artist: any): UnifiedArtist {
  return {
    name: artist.name,
    sourceId: artist.id,
    source: 'spotify',
    imageUrl: artist.images?.[0]?.url,
    genres: artist.genres,
  };
}

private normalizeFromMusicBrainz(artist: any): UnifiedArtist {
  return {
    name: artist.name,
    sourceId: artist.id,
    source: 'musicbrainz',
    mbid: artist.id,
  };
}

private normalizeFromDiscogs(artist: any): UnifiedArtist {
  return {
    name: artist.name,
    sourceId: artist.id?.toString(),
    source: 'discogs',
    imageUrl: artist.images?.[0]?.uri,
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/discography.ts apps/api/tests/services/discography.test.ts
git commit -m "feat(discography): add searchArtist with fallback chain"
```

---

## Task 4: Discography Service - Get Artist Albums

**Files:**
- Modify: `apps/api/src/services/discography.ts`
- Modify: `apps/api/tests/services/discography.test.ts`

**Step 1: Write failing test**

```typescript
describe('getArtistAlbums', () => {
  it('should fetch albums from Lidarr when available', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockLidarr = {
      searchArtist: vi.fn().mockResolvedValue([
        { foreignArtistId: 'mbid-123', artistName: 'Pink Floyd', id: 1 },
      ]),
      getAlbums: vi.fn().mockResolvedValue([
        { 
          foreignAlbumId: 'album-1', 
          title: 'The Dark Side of the Moon',
          releaseDate: '1973-03-01',
          albumType: 'Album',
        },
        { 
          foreignAlbumId: 'album-2', 
          title: 'Wish You Were Here',
          releaseDate: '1975-09-12',
          albumType: 'Album',
        },
      ]),
    };

    const service = new DiscographyService({
      lidarr: mockLidarr as any,
      cacheEnabled: false,
    });

    const result = await service.getArtistAlbums('Pink Floyd');

    expect(result.artist.name).toBe('Pink Floyd');
    expect(result.albums).toHaveLength(2);
    expect(result.albums[0].title).toBe('The Dark Side of the Moon');
    expect(result.source).toBe('lidarr');
  });

  it('should return cached results when available', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockLidarr = {
      searchArtist: vi.fn().mockResolvedValue([
        { foreignArtistId: 'mbid-123', artistName: 'Pink Floyd', id: 1 },
      ]),
      getAlbums: vi.fn().mockResolvedValue([
        { foreignAlbumId: 'album-1', title: 'The Dark Side of the Moon' },
      ]),
    };

    const service = new DiscographyService({
      lidarr: mockLidarr as any,
      cacheEnabled: true,
    });

    // First call
    await service.getArtistAlbums('Pink Floyd');
    
    // Second call should use cache
    const result = await service.getArtistAlbums('Pink Floyd');

    expect(mockLidarr.searchArtist).toHaveBeenCalledTimes(1);
    expect(result.cached).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getArtistAlbums**

```typescript
async getArtistAlbums(artistName: string): Promise<DiscographyResult> {
  const cacheKey = this.getCacheKey('discography', artistName);
  
  // Check cache
  const cached = this.getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const errors: string[] = [];

  // Try Lidarr
  if (this.lidarr) {
    try {
      const result = await this.getAlbumsFromLidarr(artistName);
      if (result) {
        this.setCache(cacheKey, result);
        return result;
      }
    } catch (error) {
      errors.push(`Lidarr: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Try Spotify
  if (this.spotify) {
    try {
      const result = await this.getAlbumsFromSpotify(artistName);
      if (result) {
        this.setCache(cacheKey, result);
        return result;
      }
    } catch (error) {
      errors.push(`Spotify: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // Try MusicBrainz
  try {
    const result = await this.getAlbumsFromMusicBrainz(artistName);
    if (result) {
      this.setCache(cacheKey, result);
      return result;
    }
  } catch (error) {
    errors.push(`MusicBrainz: ${error instanceof Error ? error.message : 'Unknown'}`);
  }

  // Try Discogs
  if (this.discogs) {
    try {
      const result = await this.getAlbumsFromDiscogs(artistName);
      if (result) {
        this.setCache(cacheKey, result);
        return result;
      }
    } catch (error) {
      errors.push(`Discogs: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  throw new Error(`Failed to fetch discography for "${artistName}": ${errors.join(', ')}`);
}

private async getAlbumsFromLidarr(artistName: string): Promise<DiscographyResult | null> {
  if (!this.lidarr) return null;

  const artists = await this.lidarr.searchArtist(artistName);
  if (!artists.length) return null;

  const artist = artists[0];
  const albums = await this.lidarr.getAlbums(artist.id);

  return {
    artist: this.normalizeFromLidarr(artist),
    albums: albums.map(a => this.normalizeAlbumFromLidarr(a, artist)),
    source: 'lidarr',
    cached: false,
    fetchedAt: new Date(),
  };
}

private normalizeAlbumFromLidarr(album: any, artist: any): UnifiedAlbum {
  return {
    title: album.title,
    year: album.releaseDate ? new Date(album.releaseDate).getFullYear() : undefined,
    sourceId: album.foreignAlbumId,
    source: 'lidarr',
    mbid: album.foreignAlbumId,
    artistName: artist.artistName,
    artistSourceId: artist.foreignArtistId,
    trackCount: album.statistics?.trackCount,
    albumType: this.normalizeAlbumType(album.albumType),
    releaseDate: album.releaseDate,
  };
}

private normalizeAlbumType(type?: string): UnifiedAlbum['albumType'] {
  if (!type) return 'album';
  const lower = type.toLowerCase();
  if (lower.includes('single')) return 'single';
  if (lower.includes('ep')) return 'ep';
  if (lower.includes('compilation')) return 'compilation';
  if (lower.includes('live')) return 'live';
  if (lower.includes('album')) return 'album';
  return 'other';
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/discography.ts apps/api/tests/services/discography.test.ts
git commit -m "feat(discography): add getArtistAlbums with caching"
```

---

## Task 5: Spotify Albums Fetcher

**Files:**
- Modify: `apps/api/src/services/discography.ts`
- Modify: `apps/api/tests/services/discography.test.ts`

**Step 1: Write failing test**

```typescript
describe('getAlbumsFromSpotify', () => {
  it('should fetch and normalize Spotify albums', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockSpotify = {
      searchArtists: vi.fn().mockResolvedValue({
        artists: {
          items: [{ id: 'spotify-artist-123', name: 'Pink Floyd' }],
        },
      }),
      getArtistAlbums: vi.fn().mockResolvedValue({
        items: [
          {
            id: 'spotify-album-1',
            name: 'The Dark Side of the Moon',
            release_date: '1973-03-01',
            album_type: 'album',
            total_tracks: 10,
            images: [{ url: 'https://example.com/cover.jpg' }],
          },
        ],
      }),
    };

    const service = new DiscographyService({
      spotify: mockSpotify as any,
      cacheEnabled: false,
    });

    const result = await service.getArtistAlbums('Pink Floyd');

    expect(result.source).toBe('spotify');
    expect(result.albums[0].title).toBe('The Dark Side of the Moon');
    expect(result.albums[0].year).toBe(1973);
    expect(result.albums[0].trackCount).toBe(10);
  });
});
```

**Step 2: Run test to verify it fails**

**Step 3: Implement getAlbumsFromSpotify**

```typescript
private async getAlbumsFromSpotify(artistName: string): Promise<DiscographyResult | null> {
  if (!this.spotify) return null;

  const searchResult = await this.spotify.searchArtists(artistName);
  const artists = searchResult.artists?.items;
  if (!artists?.length) return null;

  const artist = artists[0];
  const albumsResult = await this.spotify.getArtistAlbums(artist.id);

  return {
    artist: this.normalizeFromSpotify(artist),
    albums: albumsResult.items.map(a => this.normalizeAlbumFromSpotify(a, artist)),
    source: 'spotify',
    cached: false,
    fetchedAt: new Date(),
  };
}

private normalizeAlbumFromSpotify(album: any, artist: any): UnifiedAlbum {
  let year: number | undefined;
  if (album.release_date) {
    year = new Date(album.release_date).getFullYear();
  }

  return {
    title: album.name,
    year,
    sourceId: album.id,
    source: 'spotify',
    artistName: artist.name,
    artistSourceId: artist.id,
    trackCount: album.total_tracks,
    albumType: this.normalizeAlbumType(album.album_type),
    imageUrl: album.images?.[0]?.url,
    releaseDate: album.release_date,
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/discography.ts apps/api/tests/services/discography.test.ts
git commit -m "feat(discography): add Spotify albums fetcher"
```

---

## Task 6: MusicBrainz Albums Fetcher

**Files:**
- Modify: `apps/api/src/services/musicbrainz.ts`
- Modify: `apps/api/src/services/discography.ts`
- Modify: `apps/api/tests/services/discography.test.ts`

**Step 1: Add getReleaseGroups to MusicBrainz service**

First, update MusicBrainzService:

```typescript
// Add to MusicBrainzService class in musicbrainz.ts
async getReleaseGroups(artistMbid: string): Promise<MusicBrainzReleaseGroup[]> {
  const result = await this.request<MusicBrainzReleaseGroupSearchResult>(
    `/release-group?artist=${artistMbid}&limit=100&fmt=json`
  );
  return result['release-groups'] || [];
}
```

**Step 2: Write failing test**

```typescript
describe('getAlbumsFromMusicBrainz', () => {
  it('should fetch and normalize MusicBrainz release groups', async () => {
    const { DiscographyService } = await import('../../src/services/discography.js');
    
    const mockMusicBrainz = {
      searchArtist: vi.fn().mockResolvedValue([
        { id: 'mb-artist-123', name: 'Pink Floyd' },
      ]),
      getReleaseGroups: vi.fn().mockResolvedValue([
        {
          id: 'mb-rg-1',
          title: 'The Dark Side of the Moon',
          'primary-type': 'Album',
          'first-release-date': '1973-03-01',
        },
      ]),
    };

    const service = new DiscographyService({
      musicbrainz: mockMusicBrainz as any,
      cacheEnabled: false,
    });

    const result = await service.getArtistAlbums('Pink Floyd');

    expect(result.source).toBe('musicbrainz');
    expect(result.albums[0].title).toBe('The Dark Side of the Moon');
    expect(result.albums[0].mbid).toBe('mb-rg-1');
  });
});
```

**Step 3: Implement getAlbumsFromMusicBrainz**

```typescript
private async getAlbumsFromMusicBrainz(artistName: string): Promise<DiscographyResult | null> {
  const artists = await this.musicbrainz.searchArtist(artistName);
  if (!artists.length) return null;

  const artist = artists[0];
  const releaseGroups = await this.musicbrainz.getReleaseGroups(artist.id);

  return {
    artist: this.normalizeFromMusicBrainz(artist),
    albums: releaseGroups.map(rg => this.normalizeAlbumFromMusicBrainz(rg, artist)),
    source: 'musicbrainz',
    cached: false,
    fetchedAt: new Date(),
  };
}

private normalizeAlbumFromMusicBrainz(rg: any, artist: any): UnifiedAlbum {
  let year: number | undefined;
  if (rg['first-release-date']) {
    year = new Date(rg['first-release-date']).getFullYear();
  }

  return {
    title: rg.title,
    year,
    sourceId: rg.id,
    source: 'musicbrainz',
    mbid: rg.id,
    artistName: artist.name,
    artistSourceId: artist.id,
    albumType: this.normalizeAlbumType(rg['primary-type']),
    releaseDate: rg['first-release-date'],
  };
}
```

**Step 4: Run test to verify it passes**

**Step 5: Commit**

```bash
git add apps/api/src/services/musicbrainz.ts apps/api/src/services/discography.ts apps/api/tests/services/discography.test.ts
git commit -m "feat(discography): add MusicBrainz albums fetcher"
```

---

## Task 7: Discogs Albums Fetcher

**Files:**
- Modify: `apps/api/src/services/discogs.ts`
- Modify: `apps/api/src/services/discography.ts`
- Modify: `apps/api/tests/services/discography.test.ts`

**Step 1: Add getArtistReleases to Discogs service**

```typescript
// Add to DiscogsService class
async getArtistReleases(artistId: number): Promise<DiscogsRelease[]> {
  const response = await this.request<{
    releases: DiscogsRelease[];
    pagination: DiscogsPagination;
  }>(`/artists/${artistId}/releases?sort=year&sort_order=desc&per_page=100`);
  
  return response.releases || [];
}
```

**Step 2: Write failing test and implement**

Similar pattern to MusicBrainz - normalize Discogs releases to UnifiedAlbum format.

**Step 3: Commit**

```bash
git add apps/api/src/services/discogs.ts apps/api/src/services/discography.ts
git commit -m "feat(discography): add Discogs albums fetcher"
```

---

## Tasks 8-15: Remaining Discography Features

- **Task 8**: Add album filtering by type (studio, EP, single, etc.)
- **Task 9**: Add album filtering by year range
- **Task 10**: Integrate with Plex to check "already in library"
- **Task 11**: Create discography route (`GET /api/discography/:artistName`)
- **Task 12**: Add Redis caching instead of in-memory
- **Task 13**: Add album deduplication across sources
- **Task 14**: Add image fetching fallback (Deezer images)
- **Task 15**: Integration tests for full fallback chain

---

See [03-phase3-downloads.md](03-phase3-downloads.md) for Phase 3.
