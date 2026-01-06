# Implementation Plan: Lidarr Metadata Enrichment

**Design Document**: [2024-12-27-lidarr-metadata-enrichment-design.md](./2024-12-27-lidarr-metadata-enrichment-design.md)

**Approach**: Direct Lidarr API Updates  
**Merge Strategy**: Best Quality (longest overview, union genres, highest-res images)

---

## Phase 1: Core Types and Interfaces

### Task 1.1: Create enrichment types
**File**: `apps/api/src/services/metadata-enrichment.types.ts`  
**Time**: ~3 min

Create the shared types for metadata enrichment.

```typescript
// apps/api/src/services/metadata-enrichment.types.ts

/**
 * Normalized metadata from any source (Last.fm, Deezer, Discogs)
 */
export interface NormalizedArtistMetadata {
  source: 'lastfm' | 'deezer' | 'discogs' | 'lidarr';
  overview?: string;
  overviewLength?: number;
  genres?: string[];
  images?: Array<{
    url: string;
    width?: number;
    height?: number;
    type: 'poster' | 'banner' | 'fanart' | 'logo';
  }>;
  mbid?: string;
  fetchedAt: Date;
}

/**
 * Merged metadata result using "Best Quality" heuristics
 */
export interface MergedArtistMetadata {
  overview?: string;
  overviewSource?: string;
  genres: string[];
  genreSources: string[];
  images: Array<{
    url: string;
    width?: number;
    height?: number;
    type: 'poster' | 'banner' | 'fanart' | 'logo';
    source: string;
  }>;
  sourcesUsed: string[];
  mergedAt: Date;
}

/**
 * Result from enrichment operation
 */
export interface EnrichmentResult {
  artistId: number;
  artistName: string;
  success: boolean;
  updated: boolean;
  fieldsUpdated: string[];
  errors: string[];
  metadata?: MergedArtistMetadata;
}

/**
 * Enrichment request options
 */
export interface EnrichmentOptions {
  /** Which sources to query (default: all connected) */
  sources?: ('lastfm' | 'deezer' | 'discogs')[];
  /** Update Lidarr directly or just return merged data */
  updateLidarr?: boolean;
  /** Force update even if metadata exists */
  forceUpdate?: boolean;
}
```

**Test**: `apps/api/tests/services/metadata-enrichment.types.test.ts`

```typescript
// apps/api/tests/services/metadata-enrichment.types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
  EnrichmentResult,
} from '../../src/services/metadata-enrichment.types.js';

describe('Metadata Enrichment Types', () => {
  it('should allow creating NormalizedArtistMetadata', () => {
    const metadata: NormalizedArtistMetadata = {
      source: 'lastfm',
      overview: 'Test bio',
      overviewLength: 8,
      genres: ['rock', 'indie'],
      fetchedAt: new Date(),
    };

    expect(metadata.source).toBe('lastfm');
    expect(metadata.genres).toContain('rock');
  });

  it('should allow creating MergedArtistMetadata', () => {
    const merged: MergedArtistMetadata = {
      overview: 'Longest bio wins',
      overviewSource: 'lastfm',
      genres: ['rock', 'indie', 'alternative'],
      genreSources: ['lastfm', 'deezer'],
      images: [],
      sourcesUsed: ['lastfm', 'deezer'],
      mergedAt: new Date(),
    };

    expect(merged.genres).toHaveLength(3);
    expect(merged.sourcesUsed).toContain('lastfm');
  });

  it('should allow creating EnrichmentResult', () => {
    const result: EnrichmentResult = {
      artistId: 123,
      artistName: 'Test Artist',
      success: true,
      updated: true,
      fieldsUpdated: ['overview', 'genres'],
      errors: [],
    };

    expect(result.success).toBe(true);
    expect(result.fieldsUpdated).toContain('overview');
  });
});
```

**Verify**:
```bash
cd apps/api && npx vitest run tests/services/metadata-enrichment.types.test.ts
```
Expected: 3 tests pass

---

### Task 1.2: Add updateArtist method to LidarrService
**File**: `apps/api/src/services/lidarr.ts`  
**Time**: ~5 min

Add the method to update artist metadata directly in Lidarr.

**Test first**: `apps/api/tests/services/lidarr.test.ts` (append to existing)

```typescript
// Add to apps/api/tests/services/lidarr.test.ts

describe('updateArtist', () => {
  it('should update artist with new metadata via PUT', async () => {
    const updatedArtist = {
      id: 123,
      artistName: 'Test Artist',
      foreignArtistId: 'mbid-123',
      overview: 'New bio from enrichment',
      genres: ['rock', 'indie'],
      images: [
        { coverType: 'poster', url: 'https://example.com/poster.jpg' },
      ],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(updatedArtist),
    });

    const response = await mockFetch('http://localhost:8686/api/v1/artist/123', {
      method: 'PUT',
      headers: {
        'X-Api-Key': 'test-api-key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updatedArtist),
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8686/api/v1/artist/123',
      expect.objectContaining({ method: 'PUT' })
    );

    const data = await response.json();
    expect(data.overview).toBe('New bio from enrichment');
    expect(data.genres).toContain('rock');
  });

  it('should preserve existing fields when updating partial metadata', async () => {
    const existingArtist = {
      id: 123,
      artistName: 'Test Artist',
      foreignArtistId: 'mbid-123',
      path: '/music/Test Artist',
      qualityProfileId: 1,
      metadataProfileId: 1,
      monitored: true,
      overview: '',
      genres: [],
    };

    const enrichedFields = {
      overview: 'New bio',
      genres: ['rock'],
    };

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...existingArtist, ...enrichedFields }),
    });

    const response = await mockFetch('http://localhost:8686/api/v1/artist/123', {
      method: 'PUT',
      body: JSON.stringify({ ...existingArtist, ...enrichedFields }),
    });

    const data = await response.json();
    expect(data.path).toBe('/music/Test Artist');
    expect(data.overview).toBe('New bio');
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/services/lidarr.test.ts -t "updateArtist"
```
Expected: Tests pass (mocking fetch directly)

**Implementation** (add to `apps/api/src/services/lidarr.ts` after `updateAlbum`):

```typescript
  /**
   * Update an artist's metadata in Lidarr.
   * Used by metadata enrichment to push enriched data back to Lidarr.
   * 
   * @param artist - Full artist object with updated fields
   * @returns Updated artist from Lidarr
   */
  async updateArtist(artist: LidarrArtist): Promise<LidarrArtist> {
    return this.request<LidarrArtist>(`/artist/${artist.id}`, {
      method: 'PUT',
      body: JSON.stringify(artist),
    });
  }

  /**
   * Partially update an artist's metadata (fetch current, merge, save).
   * Safer than updateArtist when you only have partial data.
   * 
   * @param artistId - Lidarr artist ID
   * @param updates - Partial metadata to merge
   * @returns Updated artist
   */
  async patchArtist(
    artistId: number,
    updates: Partial<Pick<LidarrArtist, 'overview' | 'genres' | 'images'>>
  ): Promise<LidarrArtist> {
    // Fetch current artist to preserve all fields
    const current = await this.getArtist(artistId);
    
    // Merge updates
    const merged: LidarrArtist = {
      ...current,
      ...updates,
    };

    return this.updateArtist(merged);
  }
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/services/lidarr.test.ts
```
Expected: All tests pass

---

## Phase 2: Metadata Merger Service

### Task 2.1: Create MetadataMerger with Best Quality heuristics
**File**: `apps/api/src/services/metadata-merger.ts`  
**Time**: ~10 min

**Test first**: `apps/api/tests/services/metadata-merger.test.ts`

```typescript
// apps/api/tests/services/metadata-merger.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MetadataMerger } from '../../src/services/metadata-merger.js';
import type { NormalizedArtistMetadata } from '../../src/services/metadata-enrichment.types.js';

describe('MetadataMerger', () => {
  let merger: MetadataMerger;

  beforeEach(() => {
    merger = new MetadataMerger();
  });

  describe('merge', () => {
    it('should select longest overview (Best Quality heuristic)', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          overview: 'Short bio.',
          overviewLength: 10,
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          overview: 'This is a much longer and more detailed biography that provides comprehensive information about the artist.',
          overviewLength: 105,
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      expect(result.overview).toContain('much longer');
      expect(result.overviewSource).toBe('deezer');
    });

    it('should union all genres and deduplicate', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          genres: ['rock', 'indie rock', 'alternative'],
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          genres: ['Rock', 'Indie', 'brit pop'],
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      // Should normalize case and dedupe
      expect(result.genres).toContain('rock');
      expect(result.genres).toContain('indie rock');
      expect(result.genres).toContain('alternative');
      expect(result.genres).toContain('indie');
      expect(result.genres).toContain('brit pop');
      // Should not have duplicate "Rock" and "rock"
      const rockCount = result.genres.filter(g => g.toLowerCase() === 'rock').length;
      expect(rockCount).toBe(1);
    });

    it('should select highest resolution images by type', () => {
      const sources: NormalizedArtistMetadata[] = [
        {
          source: 'lastfm',
          images: [
            { url: 'https://lastfm.com/small.jpg', width: 300, height: 300, type: 'poster' },
          ],
          fetchedAt: new Date(),
        },
        {
          source: 'deezer',
          images: [
            { url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster' },
          ],
          fetchedAt: new Date(),
        },
      ];

      const result = merger.merge(sources);

      expect(result.images).toHaveLength(1);
      expect(result.images[0].url).toBe('https://deezer.com/xl.jpg');
      expect(result.images[0].source).toBe('deezer');
    });

    it('should track which sources were used', () => {
      const sources: NormalizedArtistMetadata[] = [
        { source: 'lastfm', overview: 'Bio', fetchedAt: new Date() },
        { source: 'deezer', genres: ['rock'], fetchedAt: new Date() },
      ];

      const result = merger.merge(sources);

      expect(result.sourcesUsed).toContain('lastfm');
      expect(result.sourcesUsed).toContain('deezer');
    });

    it('should handle empty sources gracefully', () => {
      const result = merger.merge([]);

      expect(result.overview).toBeUndefined();
      expect(result.genres).toEqual([]);
      expect(result.images).toEqual([]);
      expect(result.sourcesUsed).toEqual([]);
    });

    it('should skip sources with empty/missing data', () => {
      const sources: NormalizedArtistMetadata[] = [
        { source: 'lastfm', overview: '', fetchedAt: new Date() },
        { source: 'deezer', overview: 'Real bio here', fetchedAt: new Date() },
      ];

      const result = merger.merge(sources);

      expect(result.overview).toBe('Real bio here');
      expect(result.overviewSource).toBe('deezer');
    });
  });

  describe('normalizeGenre', () => {
    it('should lowercase and trim genres', () => {
      const normalized = merger.normalizeGenre('  Rock  ');
      expect(normalized).toBe('rock');
    });

    it('should handle hyphenated genres', () => {
      const normalized = merger.normalizeGenre('Hip-Hop');
      expect(normalized).toBe('hip-hop');
    });
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/services/metadata-merger.test.ts
```
Expected: Fails (module not found)

**Implementation**: `apps/api/src/services/metadata-merger.ts`

```typescript
// apps/api/src/services/metadata-merger.ts

import type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
} from './metadata-enrichment.types.js';

/**
 * Merges metadata from multiple sources using "Best Quality" heuristics:
 * - Overview: Select longest (most detailed)
 * - Genres: Union all, deduplicate (case-insensitive)
 * - Images: Select highest resolution per type
 */
export class MetadataMerger {
  /**
   * Merge multiple metadata sources into one result
   */
  merge(sources: NormalizedArtistMetadata[]): MergedArtistMetadata {
    const result: MergedArtistMetadata = {
      genres: [],
      genreSources: [],
      images: [],
      sourcesUsed: [],
      mergedAt: new Date(),
    };

    if (sources.length === 0) {
      return result;
    }

    // Track sources used
    result.sourcesUsed = [...new Set(sources.map(s => s.source))];

    // Best Overview: longest non-empty
    const overviews = sources
      .filter(s => s.overview && s.overview.trim().length > 0)
      .sort((a, b) => (b.overview?.length || 0) - (a.overview?.length || 0));

    if (overviews.length > 0) {
      result.overview = overviews[0].overview;
      result.overviewSource = overviews[0].source;
    }

    // Union Genres: deduplicate case-insensitive
    const genreMap = new Map<string, { original: string; source: string }>();
    
    for (const source of sources) {
      if (source.genres) {
        for (const genre of source.genres) {
          const normalized = this.normalizeGenre(genre);
          if (normalized && !genreMap.has(normalized)) {
            genreMap.set(normalized, { original: normalized, source: source.source });
          }
        }
      }
    }

    result.genres = Array.from(genreMap.values()).map(g => g.original);
    result.genreSources = [...new Set(Array.from(genreMap.values()).map(g => g.source))];

    // Best Images: highest resolution per type
    const imagesByType = new Map<string, NormalizedArtistMetadata['images'][0] & { source: string }>();

    for (const source of sources) {
      if (source.images) {
        for (const img of source.images) {
          const existing = imagesByType.get(img.type);
          const imgResolution = (img.width || 0) * (img.height || 0);
          const existingResolution = existing ? (existing.width || 0) * (existing.height || 0) : 0;

          if (!existing || imgResolution > existingResolution) {
            imagesByType.set(img.type, { ...img, source: source.source });
          }
        }
      }
    }

    result.images = Array.from(imagesByType.values());

    return result;
  }

  /**
   * Normalize a genre string for deduplication
   */
  normalizeGenre(genre: string): string {
    return genre.trim().toLowerCase();
  }
}
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/services/metadata-merger.test.ts
```
Expected: All 7 tests pass

---

## Phase 3: Source Adapters

### Task 3.1: Create Last.fm metadata adapter
**File**: `apps/api/src/services/adapters/lastfm-adapter.ts`  
**Time**: ~5 min

**Test first**: `apps/api/tests/services/adapters/lastfm-adapter.test.ts`

```typescript
// apps/api/tests/services/adapters/lastfm-adapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LastfmMetadataAdapter } from '../../../src/services/adapters/lastfm-adapter.js';
import type { LastfmService } from '../../../src/services/lastfm.js';

describe('LastfmMetadataAdapter', () => {
  let adapter: LastfmMetadataAdapter;
  let mockLastfmService: Partial<LastfmService>;

  beforeEach(() => {
    mockLastfmService = {
      getArtistInfo: vi.fn(),
    };
    adapter = new LastfmMetadataAdapter(mockLastfmService as LastfmService);
  });

  describe('fetchMetadata', () => {
    it('should return normalized metadata from Last.fm artist info', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Radiohead',
        mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        bio: {
          summary: 'Radiohead are an English rock band from Abingdon, Oxfordshire.',
          content: 'Full bio here...',
        },
        tags: {
          tag: [
            { name: 'alternative rock', url: '' },
            { name: 'indie', url: '' },
          ],
        },
        stats: { listeners: '3000000', playcount: '500000000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Radiohead');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toContain('English rock band');
      expect(result.genres).toContain('alternative rock');
      expect(result.genres).toContain('indie');
      expect(result.mbid).toBe('a74b1b7f-71a5-4011-9441-d0b5e4122711');
    });

    it('should handle missing bio gracefully', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Unknown Artist',
        stats: { listeners: '100', playcount: '1000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Unknown Artist');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockRejectedValue(
        new Error('Artist not found')
      );

      const result = await adapter.fetchMetadata('Nonexistent Artist');

      expect(result.source).toBe('lastfm');
      expect(result.overview).toBeUndefined();
      expect(result.genres).toBeUndefined();
    });

    it('should clean HTML from bio summary', async () => {
      vi.mocked(mockLastfmService.getArtistInfo!).mockResolvedValue({
        name: 'Test Artist',
        bio: {
          summary: 'Artist bio with <a href="link">HTML tags</a> and more text.',
        },
        stats: { listeners: '1000', playcount: '10000' },
        similar: { artist: [] },
      });

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.overview).not.toContain('<a');
      expect(result.overview).not.toContain('</a>');
      expect(result.overview).toContain('Artist bio');
    });
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/services/adapters/lastfm-adapter.test.ts
```
Expected: Fails (module not found)

**Implementation**: `apps/api/src/services/adapters/lastfm-adapter.ts`

```typescript
// apps/api/src/services/adapters/lastfm-adapter.ts

import type { LastfmService } from '../lastfm.js';
import type { NormalizedArtistMetadata } from '../metadata-enrichment.types.js';

/**
 * Adapter to fetch and normalize artist metadata from Last.fm
 */
export class LastfmMetadataAdapter {
  constructor(private lastfmService: LastfmService) {}

  /**
   * Fetch artist metadata from Last.fm and normalize to common format
   */
  async fetchMetadata(artistName: string): Promise<NormalizedArtistMetadata> {
    try {
      const info = await this.lastfmService.getArtistInfo(artistName);

      const overview = this.cleanHtml(info.bio?.summary || info.bio?.content);
      const genres = info.tags?.tag?.map(t => t.name);

      return {
        source: 'lastfm',
        overview,
        overviewLength: overview?.length,
        genres,
        mbid: info.mbid || undefined,
        fetchedAt: new Date(),
      };
    } catch (error) {
      console.error(`[LastfmAdapter] Error fetching metadata for "${artistName}":`, error);
      return {
        source: 'lastfm',
        fetchedAt: new Date(),
      };
    }
  }

  /**
   * Remove HTML tags from Last.fm bio text
   */
  private cleanHtml(text?: string): string | undefined {
    if (!text) return undefined;
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }
}
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/services/adapters/lastfm-adapter.test.ts
```
Expected: All 4 tests pass

---

### Task 3.2: Create Deezer metadata adapter
**File**: `apps/api/src/services/adapters/deezer-adapter.ts`  
**Time**: ~5 min

**Test first**: `apps/api/tests/services/adapters/deezer-adapter.test.ts`

```typescript
// apps/api/tests/services/adapters/deezer-adapter.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeezerMetadataAdapter } from '../../../src/services/adapters/deezer-adapter.js';

// Mock the deezer service module
vi.mock('../../../src/services/deezer.js', () => ({
  searchDeezerArtists: vi.fn(),
  getDeezerArtist: vi.fn(),
}));

import { searchDeezerArtists, getDeezerArtist } from '../../../src/services/deezer.js';

describe('DeezerMetadataAdapter', () => {
  let adapter: DeezerMetadataAdapter;

  beforeEach(() => {
    adapter = new DeezerMetadataAdapter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('fetchMetadata', () => {
    it('should return normalized metadata with high-res image', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([
        {
          id: 399,
          name: 'Radiohead',
          picture: 'https://cdn.deezer.com/pictures/artist/small.jpg',
          picture_small: 'https://cdn.deezer.com/pictures/artist/small.jpg',
          picture_medium: 'https://cdn.deezer.com/pictures/artist/medium.jpg',
          picture_big: 'https://cdn.deezer.com/pictures/artist/big.jpg',
          picture_xl: 'https://cdn.deezer.com/pictures/artist/xl.jpg',
          nb_fan: 3000000,
        },
      ]);

      const result = await adapter.fetchMetadata('Radiohead');

      expect(result.source).toBe('deezer');
      expect(result.images).toHaveLength(1);
      expect(result.images![0].url).toBe('https://cdn.deezer.com/pictures/artist/xl.jpg');
      expect(result.images![0].type).toBe('poster');
      expect(result.images![0].width).toBe(1000);
    });

    it('should fall back to smaller images if xl not available', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([
        {
          id: 123,
          name: 'Test Artist',
          picture_big: 'https://cdn.deezer.com/big.jpg',
          picture_medium: 'https://cdn.deezer.com/medium.jpg',
          nb_fan: 1000,
        },
      ]);

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.images![0].url).toBe('https://cdn.deezer.com/big.jpg');
      expect(result.images![0].width).toBe(500);
    });

    it('should handle no search results', async () => {
      vi.mocked(searchDeezerArtists).mockResolvedValue([]);

      const result = await adapter.fetchMetadata('Unknown Artist');

      expect(result.source).toBe('deezer');
      expect(result.images).toBeUndefined();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(searchDeezerArtists).mockRejectedValue(new Error('API error'));

      const result = await adapter.fetchMetadata('Test Artist');

      expect(result.source).toBe('deezer');
      expect(result.images).toBeUndefined();
    });
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/services/adapters/deezer-adapter.test.ts
```
Expected: Fails (module not found)

**Implementation**: `apps/api/src/services/adapters/deezer-adapter.ts`

```typescript
// apps/api/src/services/adapters/deezer-adapter.ts

import { searchDeezerArtists } from '../deezer.js';
import type { NormalizedArtistMetadata } from '../metadata-enrichment.types.js';

/**
 * Adapter to fetch and normalize artist metadata from Deezer
 * 
 * Deezer provides:
 * - High quality artist images (up to 1000x1000)
 * - No bio/overview (only images)
 */
export class DeezerMetadataAdapter {
  /**
   * Fetch artist metadata from Deezer and normalize to common format
   */
  async fetchMetadata(artistName: string): Promise<NormalizedArtistMetadata> {
    try {
      const results = await searchDeezerArtists(artistName, 1);

      if (results.length === 0) {
        return {
          source: 'deezer',
          fetchedAt: new Date(),
        };
      }

      const artist = results[0];
      const imageUrl = this.getBestImage(artist);

      return {
        source: 'deezer',
        images: imageUrl ? [{
          url: imageUrl.url,
          width: imageUrl.width,
          height: imageUrl.width, // Deezer images are square
          type: 'poster' as const,
        }] : undefined,
        fetchedAt: new Date(),
      };
    } catch (error) {
      console.error(`[DeezerAdapter] Error fetching metadata for "${artistName}":`, error);
      return {
        source: 'deezer',
        fetchedAt: new Date(),
      };
    }
  }

  /**
   * Get the highest resolution image available
   */
  private getBestImage(artist: {
    picture_xl?: string;
    picture_big?: string;
    picture_medium?: string;
    picture_small?: string;
    picture?: string;
  }): { url: string; width: number } | undefined {
    if (artist.picture_xl) {
      return { url: artist.picture_xl, width: 1000 };
    }
    if (artist.picture_big) {
      return { url: artist.picture_big, width: 500 };
    }
    if (artist.picture_medium) {
      return { url: artist.picture_medium, width: 250 };
    }
    if (artist.picture_small || artist.picture) {
      return { url: artist.picture_small || artist.picture!, width: 56 };
    }
    return undefined;
  }
}
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/services/adapters/deezer-adapter.test.ts
```
Expected: All 4 tests pass

---

## Phase 4: Main Enrichment Service

### Task 4.1: Create MetadataEnrichmentService
**File**: `apps/api/src/services/metadata-enrichment.ts`  
**Time**: ~15 min

**Test first**: `apps/api/tests/services/metadata-enrichment.test.ts`

```typescript
// apps/api/tests/services/metadata-enrichment.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetadataEnrichmentService } from '../../src/services/metadata-enrichment.js';
import type { LidarrService, LidarrArtist } from '../../src/services/lidarr.js';
import type { LastfmService } from '../../src/services/lastfm.js';

// Mock adapters
vi.mock('../../src/services/adapters/lastfm-adapter.js', () => ({
  LastfmMetadataAdapter: vi.fn().mockImplementation(() => ({
    fetchMetadata: vi.fn(),
  })),
}));

vi.mock('../../src/services/adapters/deezer-adapter.js', () => ({
  DeezerMetadataAdapter: vi.fn().mockImplementation(() => ({
    fetchMetadata: vi.fn(),
  })),
}));

vi.mock('../../src/services/metadata-merger.js', () => ({
  MetadataMerger: vi.fn().mockImplementation(() => ({
    merge: vi.fn(),
  })),
}));

describe('MetadataEnrichmentService', () => {
  let service: MetadataEnrichmentService;
  let mockLidarrService: Partial<LidarrService>;
  let mockLastfmService: Partial<LastfmService>;

  const mockArtist: LidarrArtist = {
    id: 123,
    artistName: 'Radiohead',
    foreignArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    path: '/music/Radiohead',
    qualityProfileId: 1,
    metadataProfileId: 1,
    monitored: true,
    overview: '',
    genres: [],
    images: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockLidarrService = {
      getArtist: vi.fn().mockResolvedValue(mockArtist),
      patchArtist: vi.fn().mockResolvedValue(mockArtist),
    };

    mockLastfmService = {
      getArtistInfo: vi.fn(),
    };

    service = new MetadataEnrichmentService(
      mockLidarrService as LidarrService,
      mockLastfmService as LastfmService
    );
  });

  describe('enrichArtist', () => {
    it('should fetch metadata from all sources and merge', async () => {
      // Get the mocked adapter instances
      const { LastfmMetadataAdapter } = await import('../../src/services/adapters/lastfm-adapter.js');
      const { DeezerMetadataAdapter } = await import('../../src/services/adapters/deezer-adapter.js');
      const { MetadataMerger } = await import('../../src/services/metadata-merger.js');

      const mockLastfmAdapter = vi.mocked(LastfmMetadataAdapter).mock.results[0]?.value;
      const mockDeezerAdapter = vi.mocked(DeezerMetadataAdapter).mock.results[0]?.value;
      const mockMerger = vi.mocked(MetadataMerger).mock.results[0]?.value;

      if (mockLastfmAdapter) {
        mockLastfmAdapter.fetchMetadata.mockResolvedValue({
          source: 'lastfm',
          overview: 'Radiohead are an English rock band.',
          genres: ['alternative rock', 'art rock'],
          fetchedAt: new Date(),
        });
      }

      if (mockDeezerAdapter) {
        mockDeezerAdapter.fetchMetadata.mockResolvedValue({
          source: 'deezer',
          images: [{ url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster' }],
          fetchedAt: new Date(),
        });
      }

      if (mockMerger) {
        mockMerger.merge.mockReturnValue({
          overview: 'Radiohead are an English rock band.',
          overviewSource: 'lastfm',
          genres: ['alternative rock', 'art rock'],
          genreSources: ['lastfm'],
          images: [{ url: 'https://deezer.com/xl.jpg', width: 1000, height: 1000, type: 'poster', source: 'deezer' }],
          sourcesUsed: ['lastfm', 'deezer'],
          mergedAt: new Date(),
        });
      }

      const result = await service.enrichArtist(123, { updateLidarr: false });

      expect(result.success).toBe(true);
      expect(result.artistName).toBe('Radiohead');
    });

    it('should update Lidarr when updateLidarr option is true', async () => {
      const { MetadataMerger } = await import('../../src/services/metadata-merger.js');
      const mockMerger = vi.mocked(MetadataMerger).mock.results[0]?.value;

      if (mockMerger) {
        mockMerger.merge.mockReturnValue({
          overview: 'New bio',
          genres: ['rock'],
          images: [],
          sourcesUsed: ['lastfm'],
          genreSources: ['lastfm'],
          mergedAt: new Date(),
        });
      }

      await service.enrichArtist(123, { updateLidarr: true });

      expect(mockLidarrService.patchArtist).toHaveBeenCalledWith(
        123,
        expect.objectContaining({
          overview: 'New bio',
          genres: ['rock'],
        })
      );
    });

    it('should not update Lidarr if no new metadata found', async () => {
      const { MetadataMerger } = await import('../../src/services/metadata-merger.js');
      const mockMerger = vi.mocked(MetadataMerger).mock.results[0]?.value;

      if (mockMerger) {
        mockMerger.merge.mockReturnValue({
          genres: [],
          images: [],
          sourcesUsed: [],
          genreSources: [],
          mergedAt: new Date(),
        });
      }

      const result = await service.enrichArtist(123, { updateLidarr: true });

      expect(result.updated).toBe(false);
      expect(mockLidarrService.patchArtist).not.toHaveBeenCalled();
    });

    it('should track which fields were updated', async () => {
      const { MetadataMerger } = await import('../../src/services/metadata-merger.js');
      const mockMerger = vi.mocked(MetadataMerger).mock.results[0]?.value;

      // Simulate artist already has genres but no overview
      vi.mocked(mockLidarrService.getArtist!).mockResolvedValue({
        ...mockArtist,
        genres: ['existing genre'],
        overview: '',
      });

      if (mockMerger) {
        mockMerger.merge.mockReturnValue({
          overview: 'New overview from enrichment',
          genres: ['rock', 'existing genre'],
          images: [],
          sourcesUsed: ['lastfm'],
          genreSources: ['lastfm'],
          mergedAt: new Date(),
        });
      }

      const result = await service.enrichArtist(123, { updateLidarr: true });

      expect(result.fieldsUpdated).toContain('overview');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(mockLidarrService.getArtist!).mockRejectedValue(
        new Error('Lidarr connection failed')
      );

      const result = await service.enrichArtist(123);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Lidarr connection failed');
    });
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/services/metadata-enrichment.test.ts
```
Expected: Fails (module not found)

**Implementation**: `apps/api/src/services/metadata-enrichment.ts`

```typescript
// apps/api/src/services/metadata-enrichment.ts

import type { LidarrService, LidarrArtist } from './lidarr.js';
import type { LastfmService } from './lastfm.js';
import { LastfmMetadataAdapter } from './adapters/lastfm-adapter.js';
import { DeezerMetadataAdapter } from './adapters/deezer-adapter.js';
import { MetadataMerger } from './metadata-merger.js';
import type {
  NormalizedArtistMetadata,
  EnrichmentResult,
  EnrichmentOptions,
} from './metadata-enrichment.types.js';

/**
 * Service to enrich Lidarr artist metadata from multiple sources
 */
export class MetadataEnrichmentService {
  private lastfmAdapter: LastfmMetadataAdapter;
  private deezerAdapter: DeezerMetadataAdapter;
  private merger: MetadataMerger;

  constructor(
    private lidarrService: LidarrService,
    private lastfmService: LastfmService
  ) {
    this.lastfmAdapter = new LastfmMetadataAdapter(lastfmService);
    this.deezerAdapter = new DeezerMetadataAdapter();
    this.merger = new MetadataMerger();
  }

  /**
   * Enrich a single artist's metadata from connected sources
   */
  async enrichArtist(
    artistId: number,
    options: EnrichmentOptions = {}
  ): Promise<EnrichmentResult> {
    const { updateLidarr = true, forceUpdate = false } = options;

    try {
      // Get current artist from Lidarr
      const artist = await this.lidarrService.getArtist(artistId);

      // Fetch metadata from all sources in parallel
      const metadataSources = await this.fetchFromAllSources(artist.artistName);

      // Merge using Best Quality heuristics
      const merged = this.merger.merge(metadataSources);

      // Determine what fields would be updated
      const fieldsToUpdate = this.getFieldsToUpdate(artist, merged, forceUpdate);

      if (fieldsToUpdate.length === 0) {
        return {
          artistId,
          artistName: artist.artistName,
          success: true,
          updated: false,
          fieldsUpdated: [],
          errors: [],
          metadata: merged,
        };
      }

      // Update Lidarr if requested
      if (updateLidarr) {
        const updates: Partial<Pick<LidarrArtist, 'overview' | 'genres' | 'images'>> = {};

        if (fieldsToUpdate.includes('overview') && merged.overview) {
          updates.overview = merged.overview;
        }
        if (fieldsToUpdate.includes('genres') && merged.genres.length > 0) {
          updates.genres = merged.genres;
        }
        if (fieldsToUpdate.includes('images') && merged.images.length > 0) {
          updates.images = merged.images.map(img => ({
            coverType: img.type,
            url: img.url,
            remoteUrl: img.url,
          }));
        }

        await this.lidarrService.patchArtist(artistId, updates);
      }

      return {
        artistId,
        artistName: artist.artistName,
        success: true,
        updated: updateLidarr && fieldsToUpdate.length > 0,
        fieldsUpdated: fieldsToUpdate,
        errors: [],
        metadata: merged,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[MetadataEnrichment] Error enriching artist ${artistId}:`, error);

      return {
        artistId,
        artistName: '',
        success: false,
        updated: false,
        fieldsUpdated: [],
        errors: [errorMessage],
      };
    }
  }

  /**
   * Enrich multiple artists (e.g., all incomplete artists)
   */
  async enrichArtists(
    artistIds: number[],
    options: EnrichmentOptions = {},
    onProgress?: (result: EnrichmentResult, index: number, total: number) => void
  ): Promise<EnrichmentResult[]> {
    const results: EnrichmentResult[] = [];

    for (let i = 0; i < artistIds.length; i++) {
      const result = await this.enrichArtist(artistIds[i], options);
      results.push(result);

      if (onProgress) {
        onProgress(result, i, artistIds.length);
      }

      // Small delay between requests to avoid rate limiting
      if (i < artistIds.length - 1) {
        await this.delay(500);
      }
    }

    return results;
  }

  /**
   * Fetch metadata from all connected sources
   */
  private async fetchFromAllSources(artistName: string): Promise<NormalizedArtistMetadata[]> {
    const [lastfmData, deezerData] = await Promise.all([
      this.lastfmAdapter.fetchMetadata(artistName),
      this.deezerAdapter.fetchMetadata(artistName),
    ]);

    return [lastfmData, deezerData].filter(
      (data) => data.overview || data.genres?.length || data.images?.length
    );
  }

  /**
   * Determine which fields should be updated based on current artist state
   */
  private getFieldsToUpdate(
    artist: LidarrArtist,
    merged: ReturnType<MetadataMerger['merge']>,
    forceUpdate: boolean
  ): string[] {
    const fields: string[] = [];

    // Overview: update if missing or force
    if (merged.overview && (forceUpdate || !artist.overview?.trim())) {
      fields.push('overview');
    }

    // Genres: update if missing or force
    if (merged.genres.length > 0 && (forceUpdate || !artist.genres?.length)) {
      fields.push('genres');
    }

    // Images (poster): update if missing or force
    const hasPoster = artist.images?.some(
      (img) => img.coverType?.toLowerCase() === 'poster' && img.url
    );
    if (merged.images.length > 0 && (forceUpdate || !hasPoster)) {
      fields.push('images');
    }

    return fields;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/services/metadata-enrichment.test.ts
```
Expected: All 5 tests pass

---

## Phase 5: API Endpoints

### Task 5.1: Add enrichment endpoint to search routes
**File**: `apps/api/src/routes/search.ts`  
**Time**: ~10 min

**Test first**: `apps/api/tests/api/enrich.test.ts`

```typescript
// apps/api/tests/api/enrich.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Create mock app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Mock authentication middleware
  app.use((req, _res, next) => {
    req.user = { id: 1, username: 'testuser', role: 'user' };
    next();
  });
  
  return app;
};

describe('Enrich Endpoints', () => {
  let app: express.Express;
  let mockEnrichService: any;
  let mockLidarrService: any;

  beforeEach(() => {
    app = createTestApp();
    vi.clearAllMocks();

    mockEnrichService = {
      enrichArtist: vi.fn(),
      enrichArtists: vi.fn(),
    };

    mockLidarrService = {
      getArtist: vi.fn(),
      getArtists: vi.fn(),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('POST /api/search/lidarr/artists/:id/enrich', () => {
    it('should enrich single artist and return result', async () => {
      mockEnrichService.enrichArtist.mockResolvedValue({
        artistId: 123,
        artistName: 'Radiohead',
        success: true,
        updated: true,
        fieldsUpdated: ['overview', 'genres'],
        errors: [],
      });

      // Register mock route
      app.post('/api/search/lidarr/artists/:id/enrich', async (req, res) => {
        const artistId = parseInt(req.params.id);
        const result = await mockEnrichService.enrichArtist(artistId, req.body);
        res.json(result);
      });

      const response = await request(app)
        .post('/api/search/lidarr/artists/123/enrich')
        .send({ updateLidarr: true });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.fieldsUpdated).toContain('overview');
    });

    it('should return 400 for invalid artist ID', async () => {
      app.post('/api/search/lidarr/artists/:id/enrich', (req, res) => {
        const artistId = parseInt(req.params.id);
        if (isNaN(artistId)) {
          res.status(400).json({ error: 'Invalid artist ID' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/api/search/lidarr/artists/invalid/enrich');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid artist ID');
    });
  });

  describe('POST /api/search/lidarr/artists/enrich-incomplete', () => {
    it('should enrich all artists with missing metadata', async () => {
      mockLidarrService.getArtists.mockResolvedValue([
        { id: 1, artistName: 'Artist 1', overview: '', genres: [] },
        { id: 2, artistName: 'Artist 2', overview: 'Has bio', genres: ['rock'] },
        { id: 3, artistName: 'Artist 3', overview: '', genres: [] },
      ]);

      mockEnrichService.enrichArtists.mockResolvedValue([
        { artistId: 1, success: true, updated: true },
        { artistId: 3, success: true, updated: true },
      ]);

      app.post('/api/search/lidarr/artists/enrich-incomplete', async (req, res) => {
        const artists = await mockLidarrService.getArtists();
        const incomplete = artists.filter(
          (a: any) => !a.overview?.trim() || !a.genres?.length
        );
        const results = await mockEnrichService.enrichArtists(
          incomplete.map((a: any) => a.id),
          req.body
        );
        res.json({
          success: true,
          enriched: results.filter((r: any) => r.updated).length,
          total: results.length,
          results,
        });
      });

      const response = await request(app)
        .post('/api/search/lidarr/artists/enrich-incomplete');

      expect(response.status).toBe(200);
      expect(response.body.enriched).toBe(2);
      expect(response.body.total).toBe(2);
    });
  });
});
```

**Verify RED**:
```bash
cd apps/api && npx vitest run tests/api/enrich.test.ts
```
Expected: Tests pass (mocking at route level)

**Implementation**: Add to `apps/api/src/routes/search.ts`

Add these imports at the top:
```typescript
import { MetadataEnrichmentService } from '../services/metadata-enrichment.js';
import { LastfmService } from '../services/lastfm.js';
```

Add these routes after the existing refresh endpoints:

```typescript
// Enrich a single artist's metadata from connected sources
searchRouter.post('/lidarr/artists/:id/enrich', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) {
      res.status(400).json({ error: 'Invalid artist ID' });
      return;
    }

    // Get Last.fm service for the user
    const lastfmConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'lastfm', isActive: true },
    });

    if (!lastfmConn) {
      res.status(400).json({ error: 'No active Last.fm connection for metadata enrichment' });
      return;
    }

    const lastfm = new LastfmService((lastfmConn.config as { apiKey: string }).apiKey);
    const enrichService = new MetadataEnrichmentService(lidarr, lastfm);

    const { updateLidarr = true, forceUpdate = false } = req.body as {
      updateLidarr?: boolean;
      forceUpdate?: boolean;
    };

    const result = await enrichService.enrichArtist(artistId, { updateLidarr, forceUpdate });

    res.json(result);
  } catch (error) {
    console.error('Error enriching artist:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich artist',
    });
  }
});

// Enrich all artists with incomplete metadata
searchRouter.post('/lidarr/artists/enrich-incomplete', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const lastfmConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'lastfm', isActive: true },
    });

    if (!lastfmConn) {
      res.status(400).json({ error: 'No active Last.fm connection for metadata enrichment' });
      return;
    }

    const lastfm = new LastfmService((lastfmConn.config as { apiKey: string }).apiKey);
    const enrichService = new MetadataEnrichmentService(lidarr, lastfm);

    const { limit = 50, issueType = 'any' } = req.body as {
      limit?: number;
      issueType?: string;
    };

    // Get all artists and filter to incomplete ones
    const artists = await lidarr.getArtists();
    let incompleteArtists = artists.filter(artist => {
      const issues = getMetadataIssues(artist);
      if (issueType === 'any') {
        return issues.length > 0;
      }
      return issues.includes(issueType);
    });

    incompleteArtists = incompleteArtists.slice(0, limit);

    if (incompleteArtists.length === 0) {
      res.json({
        success: true,
        message: `No artists found with issue: ${issueType}`,
        enriched: 0,
        total: 0,
        results: [],
      });
      return;
    }

    const results = await enrichService.enrichArtists(
      incompleteArtists.map(a => a.id),
      { updateLidarr: true }
    );

    const enrichedCount = results.filter(r => r.updated).length;

    res.json({
      success: true,
      message: `Enriched ${enrichedCount} of ${results.length} incomplete artists`,
      enriched: enrichedCount,
      total: results.length,
      results,
    });
  } catch (error) {
    console.error('Error enriching incomplete artists:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich artists',
    });
  }
});
```

**Verify GREEN**:
```bash
cd apps/api && npx vitest run tests/api/enrich.test.ts
```
Expected: All tests pass

---

## Phase 6: Export & Integration

### Task 6.1: Create barrel export for enrichment modules
**File**: `apps/api/src/services/enrichment/index.ts`  
**Time**: ~2 min

```typescript
// apps/api/src/services/enrichment/index.ts

export { MetadataEnrichmentService } from '../metadata-enrichment.js';
export { MetadataMerger } from '../metadata-merger.js';
export { LastfmMetadataAdapter } from '../adapters/lastfm-adapter.js';
export { DeezerMetadataAdapter } from '../adapters/deezer-adapter.js';
export type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
  EnrichmentResult,
  EnrichmentOptions,
} from '../metadata-enrichment.types.js';
```

---

## Verification Checklist

After all tasks are complete, run full verification:

```bash
# Run all enrichment-related tests
cd apps/api && npx vitest run tests/services/metadata-enrichment.types.test.ts \
  tests/services/metadata-merger.test.ts \
  tests/services/adapters/lastfm-adapter.test.ts \
  tests/services/adapters/deezer-adapter.test.ts \
  tests/services/metadata-enrichment.test.ts \
  tests/api/enrich.test.ts

# Run type check
cd apps/api && npx tsc --noEmit

# Run full test suite
cd apps/api && npm test
```

**Expected Results**:
- All new tests pass
- No type errors
- Existing tests unaffected

---

## Summary

| Phase | Task | File(s) | Est. Time |
|-------|------|---------|-----------|
| 1 | Types & Interfaces | `metadata-enrichment.types.ts` | 3 min |
| 1 | LidarrService.updateArtist | `lidarr.ts` | 5 min |
| 2 | MetadataMerger | `metadata-merger.ts` | 10 min |
| 3 | LastfmMetadataAdapter | `adapters/lastfm-adapter.ts` | 5 min |
| 3 | DeezerMetadataAdapter | `adapters/deezer-adapter.ts` | 5 min |
| 4 | MetadataEnrichmentService | `metadata-enrichment.ts` | 15 min |
| 5 | API Endpoints | `routes/search.ts` | 10 min |
| 6 | Barrel Exports | `enrichment/index.ts` | 2 min |

**Total Estimated Time**: ~55 minutes

---

## Execution Options

**Option A**: Subagent-Driven Development
- Each task assigned to a fresh subagent
- Two-stage review (spec compliance, then quality)
- Best for: detailed code review, catching edge cases

**Option B**: Batched Execution  
- Execute 3 tasks, stop, report progress, wait for feedback
- Best for: interactive development with course corrections

**Which execution approach would you like to use?**
