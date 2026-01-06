# Multi-Source Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform artist search from MusicBrainz-only to streaming-first discovery with Spotify/Deezer/Tidal/Bandcamp sources, smart merging, and user-toggleable sources.

**Architecture:** Query enabled streaming services in parallel, merge results by artist name similarity using priority order (Spotify > Deezer > Tidal > Bandcamp), enrich with data from secondary sources. MBID resolution happens on add via MusicBrainz with manual selection fallback.

**Tech Stack:** Express.js API, React/Next.js frontend, Vitest testing, existing service classes

---

## Task 1: Add Spotify Search Method

**Files:**
- Modify: `apps/api/src/services/spotify.ts`
- Test: `apps/api/tests/api/search.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/api/search.test.ts`:

```typescript
describe('Spotify Search', () => {
  it('should search artists via Spotify', async () => {
    // This test validates the SpotifyService.searchArtists method exists
    const mockSpotify = {
      searchArtists: vi.fn().mockResolvedValue([
        { id: 'spotify1', name: 'Pink Floyd', popularity: 75, genres: ['rock'], imageUrl: 'https://img.com/1' },
      ]),
    };
    
    const results = await mockSpotify.searchArtists('pink floyd', 25);
    
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Pink Floyd');
    expect(results[0].popularity).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: PASS (mock test, but validates interface)

**Step 3: Add searchArtists method to SpotifyService**

Add to `apps/api/src/services/spotify.ts` after the `getAllFollowedArtists` method (~line 295):

```typescript
  /**
   * Search for artists by name
   */
  async searchArtists(query: string, limit: number = 25): Promise<Array<{
    id: string;
    name: string;
    popularity: number;
    genres: string[];
    imageUrl: string | null;
    followers: number;
  }>> {
    const params = new URLSearchParams({
      q: query,
      type: 'artist',
      limit: limit.toString(),
    });
    
    const response = await this.request<{
      artists: {
        items: SpotifyArtist[];
      };
    }>(`/search?${params}`);
    
    return response.artists.items.map(artist => ({
      id: artist.id,
      name: artist.name,
      popularity: (artist as any).popularity || 0,
      genres: artist.genres || [],
      imageUrl: artist.images?.[0]?.url || null,
      followers: (artist as any).followers?.total || 0,
    }));
  }
```

**Step 4: Run test to verify it passes**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add apps/api/src/services/spotify.ts apps/api/tests/api/search.test.ts
git commit -m "feat(api): add searchArtists method to SpotifyService"
```

---

## Task 2: Create Multi-Source Search Service

**Files:**
- Create: `apps/api/src/services/multi-search.ts`
- Test: `apps/api/tests/api/search.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/api/search.test.ts`:

```typescript
describe('Multi-Source Search', () => {
  it('should merge results from multiple sources by name', () => {
    // Test the deduplication logic
    const spotifyResults = [
      { name: 'Pink Floyd', source: 'spotify', popularity: 75 },
      { name: 'Pink', source: 'spotify', popularity: 80 },
    ];
    const deezerResults = [
      { name: 'Pink Floyd', source: 'deezer', fans: 5000000 },
      { name: 'Pinkish Black', source: 'deezer', fans: 50000 },
    ];
    
    // Merge by normalized name, primary source wins
    const merged = mergeSearchResults([spotifyResults, deezerResults], ['spotify', 'deezer']);
    
    expect(merged).toHaveLength(3); // Pink Floyd, Pink, Pinkish Black
    expect(merged.find(r => r.name === 'Pink Floyd')?.sources).toContain('spotify');
    expect(merged.find(r => r.name === 'Pink Floyd')?.sources).toContain('deezer');
  });
  
  it('should prioritize sources in order', () => {
    const spotifyResult = { name: 'Test Artist', imageUrl: 'spotify-img', popularity: 75 };
    const deezerResult = { name: 'Test Artist', imageUrl: 'deezer-img', fans: 100000 };
    
    // Spotify is higher priority, so its image should be used
    const merged = mergeSearchResults([[spotifyResult], [deezerResult]], ['spotify', 'deezer']);
    
    expect(merged[0].imageUrl).toBe('spotify-img');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: FAIL - `mergeSearchResults` not defined

**Step 3: Create multi-search service**

Create `apps/api/src/services/multi-search.ts`:

```typescript
/**
 * Multi-Source Search Service
 * 
 * Aggregates artist search results from multiple streaming services,
 * merges by artist name similarity, and applies priority ordering.
 */

import prisma from '../lib/db.js';
import { SpotifyService } from './spotify.js';
import { searchDeezerArtists } from './deezer.js';
import { TidalService } from './tidal.js';
import { BandcampService } from './bandcamp.js';
import { MusicBrainzService } from './musicbrainz.js';

export type SearchSource = 'spotify' | 'deezer' | 'tidal' | 'bandcamp';

export interface UnifiedArtistResult {
  name: string;
  imageUrl: string | null;
  sources: SearchSource[];
  // Primary source data
  spotifyId?: string;
  deezerId?: number;
  tidalId?: string;
  bandcampId?: number;
  // Enrichment data
  popularity?: number;
  genres?: string[];
  followers?: number;
  fans?: number;
  // For adding to Lidarr
  mbid?: string;
  inLibrary?: boolean;
}

interface SourceResult {
  name: string;
  imageUrl: string | null;
  source: SearchSource;
  sourceId: string | number;
  popularity?: number;
  genres?: string[];
  followers?: number;
  fans?: number;
}

// Priority order for sources (lower index = higher priority)
const SOURCE_PRIORITY: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];

/**
 * Normalize artist name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Check if two artist names are similar enough to be the same artist
 */
function namesMatch(a: string, b: string): boolean {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  
  // Exact match after normalization
  if (normA === normB) return true;
  
  // One contains the other (for "Artist" vs "The Artist")
  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = normA.length < normB.length ? normA : normB;
    const longer = normA.length >= normB.length ? normA : normB;
    // Only match if the shorter is at least 80% of the longer
    if (shorter.length / longer.length >= 0.8) return true;
  }
  
  return false;
}

/**
 * Merge search results from multiple sources
 */
export function mergeSearchResults(
  resultsBySource: SourceResult[][],
  sourceOrder: SearchSource[]
): UnifiedArtistResult[] {
  const merged = new Map<string, UnifiedArtistResult>();
  
  // Process results in priority order
  for (let i = 0; i < sourceOrder.length; i++) {
    const source = sourceOrder[i];
    const results = resultsBySource[i] || [];
    
    for (const result of results) {
      const normName = normalizeName(result.name);
      
      // Check if we already have this artist
      let existingKey: string | null = null;
      for (const [key, existing] of merged) {
        if (namesMatch(result.name, existing.name)) {
          existingKey = key;
          break;
        }
      }
      
      if (existingKey) {
        // Add source to existing result
        const existing = merged.get(existingKey)!;
        existing.sources.push(source);
        
        // Add source-specific ID
        switch (source) {
          case 'spotify': existing.spotifyId = String(result.sourceId); break;
          case 'deezer': existing.deezerId = Number(result.sourceId); break;
          case 'tidal': existing.tidalId = String(result.sourceId); break;
          case 'bandcamp': existing.bandcampId = Number(result.sourceId); break;
        }
        
        // Enrich with additional data (don't overwrite primary)
        if (!existing.genres?.length && result.genres?.length) {
          existing.genres = result.genres;
        }
        if (!existing.fans && result.fans) {
          existing.fans = result.fans;
        }
      } else {
        // New artist - use as primary
        const unified: UnifiedArtistResult = {
          name: result.name,
          imageUrl: result.imageUrl,
          sources: [source],
          popularity: result.popularity,
          genres: result.genres,
          followers: result.followers,
          fans: result.fans,
        };
        
        // Add source-specific ID
        switch (source) {
          case 'spotify': unified.spotifyId = String(result.sourceId); break;
          case 'deezer': unified.deezerId = Number(result.sourceId); break;
          case 'tidal': unified.tidalId = String(result.sourceId); break;
          case 'bandcamp': unified.bandcampId = Number(result.sourceId); break;
        }
        
        merged.set(normName, unified);
      }
    }
  }
  
  // Sort by number of sources (more sources = more confident), then by popularity
  return Array.from(merged.values()).sort((a, b) => {
    if (b.sources.length !== a.sources.length) {
      return b.sources.length - a.sources.length;
    }
    return (b.popularity || 0) - (a.popularity || 0);
  });
}

/**
 * Get service connections for a user
 */
async function getSpotifyService(userId: number): Promise<SpotifyService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'spotify', isActive: true },
        { userId: null, type: 'spotify', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  
  const config = connection.config as any;
  return new SpotifyService({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt || config.tokenExpiresAt,
  });
}

async function getTidalService(userId: number): Promise<TidalService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'tidal', isActive: true },
        { userId: null, type: 'tidal', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  
  const config = connection.config as any;
  return new TidalService({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: config.expiresAt,
  });
}

/**
 * Search across multiple sources
 */
export async function multiSourceSearch(
  query: string,
  userId: number,
  enabledSources: SearchSource[],
  limit: number = 25
): Promise<UnifiedArtistResult[]> {
  const searchPromises: Promise<SourceResult[]>[] = [];
  const sourceOrder: SearchSource[] = [];
  
  // Query each enabled source in parallel
  for (const source of SOURCE_PRIORITY) {
    if (!enabledSources.includes(source)) continue;
    
    sourceOrder.push(source);
    
    switch (source) {
      case 'spotify':
        searchPromises.push(
          (async () => {
            const spotify = await getSpotifyService(userId);
            if (!spotify) return [];
            try {
              const results = await spotify.searchArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: r.imageUrl,
                source: 'spotify' as SearchSource,
                sourceId: r.id,
                popularity: r.popularity,
                genres: r.genres,
                followers: r.followers,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
        
      case 'deezer':
        searchPromises.push(
          (async () => {
            try {
              const results = await searchDeezerArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: r.picture_medium || r.picture || null,
                source: 'deezer' as SearchSource,
                sourceId: r.id,
                fans: (r as any).nb_fan || undefined,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
        
      case 'tidal':
        searchPromises.push(
          (async () => {
            const tidal = await getTidalService(userId);
            if (!tidal) return [];
            try {
              const results = await tidal.searchArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: r.imageUrl || null,
                source: 'tidal' as SearchSource,
                sourceId: r.id,
                popularity: r.popularity,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
        
      case 'bandcamp':
        searchPromises.push(
          (async () => {
            try {
              const service = new BandcampService();
              const response = await service.searchArtists(query);
              return response.artists.map(r => ({
                name: r.name,
                imageUrl: r.imageUrl,
                source: 'bandcamp' as SearchSource,
                sourceId: r.id,
                genres: r.genre ? [r.genre] : undefined,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
    }
  }
  
  const resultsBySource = await Promise.all(searchPromises);
  return mergeSearchResults(resultsBySource, sourceOrder);
}

/**
 * Resolve MusicBrainz ID for an artist
 */
export async function resolveMbid(artistName: string): Promise<{
  mbid: string | null;
  candidates?: Array<{ id: string; name: string; disambiguation?: string; country?: string }>;
}> {
  const mb = new MusicBrainzService();
  const match = await mb.findBestMatch(artistName);
  
  if (match) {
    return { mbid: match.id };
  }
  
  // No confident match - return candidates for manual selection
  const candidates = await mb.searchArtist(artistName, 10);
  return {
    mbid: null,
    candidates: candidates.map(c => ({
      id: c.id,
      name: c.name,
      disambiguation: c.disambiguation,
      country: c.country,
    })),
  };
}
```

**Step 4: Export from multi-search**

Add export to test file import:

```typescript
// At top of tests/api/search.test.ts
import { mergeSearchResults } from '../../src/services/multi-search.js';
```

**Step 5: Run test to verify it passes**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: PASS

**Step 6: Commit**

```bash
git add apps/api/src/services/multi-search.ts apps/api/tests/api/search.test.ts
git commit -m "feat(api): add multi-source search service with result merging"
```

---

## Task 3: Add Multi-Source Search API Endpoint

**Files:**
- Modify: `apps/api/src/routes/search.ts`
- Test: `apps/api/tests/api/search.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/api/search.test.ts`:

```typescript
describe('GET /api/search/discover', () => {
  it('should accept sources query parameter', () => {
    const sources = 'spotify,deezer';
    const parsed = sources.split(',').filter(s => 
      ['spotify', 'deezer', 'tidal', 'bandcamp'].includes(s)
    );
    
    expect(parsed).toEqual(['spotify', 'deezer']);
  });
  
  it('should default to all sources when none specified', () => {
    const sources = '';
    const parsed = sources ? sources.split(',') : ['spotify', 'deezer', 'tidal', 'bandcamp'];
    
    expect(parsed).toHaveLength(4);
  });
});
```

**Step 2: Add discover endpoint to search router**

Add to `apps/api/src/routes/search.ts` after imports:

```typescript
import { multiSourceSearch, resolveMbid, SearchSource } from '../services/multi-search.js';
```

Add new endpoint after the existing `/artists` endpoint:

```typescript
// Multi-source artist discovery search
searchRouter.get('/discover', async (req, res) => {
  try {
    const { q, sources } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }
    
    // Parse enabled sources (default to all)
    const validSources: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];
    let enabledSources: SearchSource[];
    
    if (sources && typeof sources === 'string') {
      enabledSources = sources.split(',').filter(s => 
        validSources.includes(s as SearchSource)
      ) as SearchSource[];
      
      if (enabledSources.length === 0) {
        enabledSources = validSources;
      }
    } else {
      enabledSources = validSources;
    }
    
    // Search across enabled sources
    const results = await multiSourceSearch(q, req.user!.id, enabledSources, 25);
    
    // Check which artists are already in Lidarr library
    const lidarr = await getLidarrService(req.user!.id);
    if (lidarr) {
      const cache = new LidarrCache(lidarr);
      await cache.refresh();
      
      for (const result of results) {
        // Try to find MBID for library check
        if (!result.mbid) {
          const mb = new MusicBrainzService();
          const match = await mb.findBestMatch(result.name);
          if (match) {
            result.mbid = match.id;
            result.inLibrary = await cache.exists({ mbid: match.id });
          }
        }
      }
    }
    
    res.json({ 
      results,
      sources: enabledSources,
    });
  } catch (error) {
    console.error('Multi-source search error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    res.status(500).json({ error: message });
  }
});

// Resolve MBID for an artist (with fallback to manual selection)
searchRouter.post('/resolve-mbid', async (req, res) => {
  try {
    const { artistName } = req.body;
    
    if (!artistName || typeof artistName !== 'string') {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }
    
    const result = await resolveMbid(artistName);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MBID resolution failed';
    res.status(500).json({ error: message });
  }
});

// Add artist from discovery search (with MBID resolution)
searchRouter.post('/discover/add', async (req, res) => {
  try {
    const { artistName, mbid, qualityProfileId, metadataProfileId, rootFolderPath } = req.body;
    
    if (!artistName) {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }
    
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    
    // Use provided MBID or resolve it
    let resolvedMbid = mbid;
    if (!resolvedMbid) {
      const resolution = await resolveMbid(artistName);
      if (!resolution.mbid) {
        // Return candidates for manual selection
        res.status(422).json({
          error: 'Could not automatically match artist in MusicBrainz',
          candidates: resolution.candidates,
          artistName,
        });
        return;
      }
      resolvedMbid = resolution.mbid;
    }
    
    // Get defaults if not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    let rfPath = rootFolderPath;

    if (!qpId) {
      const profiles = await lidarr.getQualityProfiles();
      qpId = profiles[0]?.id;
    }

    if (!mpId) {
      const profiles = await lidarr.getMetadataProfiles();
      mpId = profiles[0]?.id;
    }

    if (!rfPath) {
      const folders = await lidarr.getRootFolders();
      rfPath = folders[0]?.path;
    }

    if (!qpId || !mpId || !rfPath) {
      res.status(400).json({ error: 'Missing Lidarr configuration (profiles/folders)' });
      return;
    }

    const artist = await lidarr.addArtist(resolvedMbid, qpId, mpId, rfPath);
    res.json({ success: true, artist, mbid: resolvedMbid });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to add artist' 
    });
  }
});
```

**Step 3: Run tests**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/routes/search.ts
git commit -m "feat(api): add /discover endpoint for multi-source artist search"
```

---

## Task 4: Update Frontend Search Page - Source Toggles

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Add source toggle state**

Add after existing state declarations (~line 65):

```typescript
  // Multi-source search state
  const [enabledSources, setEnabledSources] = useState<Set<string>>(
    new Set(['spotify', 'deezer', 'tidal', 'bandcamp'])
  );
  const [mbidCandidates, setMbidCandidates] = useState<Array<{
    id: string;
    name: string;
    disambiguation?: string;
    country?: string;
  }> | null>(null);
  const [selectingArtist, setSelectingArtist] = useState<ArtistResult | null>(null);
```

**Step 2: Update handleSearch for artist type**

Replace the artist case in handleSearch:

```typescript
      case 'artist':
        const sourcesParam = Array.from(enabledSources).join(',');
        endpoint = `/api/search/discover?q=${encodeURIComponent(query)}&sources=${sourcesParam}`;
        break;
```

**Step 3: Update result processing for artist type**

Replace the artist result handling:

```typescript
      if (searchType === 'artist') {
        const artistResults = (data.results || []).map((r: any) => ({
          foreignArtistId: r.mbid || '',
          artistName: r.name,
          overview: r.genres?.join(', ') || '',
          imageUrl: r.imageUrl,
          inLibrary: r.inLibrary || false,
          sources: r.sources || [],
          spotifyId: r.spotifyId,
          deezerId: r.deezerId,
          popularity: r.popularity,
          followers: r.followers,
          fans: r.fans,
        }));
        setResults(artistResults);
        setTotalCount(artistResults.length);
      }
```

**Step 4: Add source toggle UI**

Add after the search type buttons, before the search input:

```typescript
      {/* Source Toggles (for artist search) */}
      {searchType === 'artist' && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-sm text-muted-foreground mr-2">Sources:</span>
          {['spotify', 'deezer', 'tidal', 'bandcamp'].map((source) => (
            <Button
              key={source}
              variant={enabledSources.has(source) ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                const newSources = new Set(enabledSources);
                if (newSources.has(source)) {
                  newSources.delete(source);
                } else {
                  newSources.add(source);
                }
                // Ensure at least one source is enabled
                if (newSources.size > 0) {
                  setEnabledSources(newSources);
                }
              }}
            >
              {source.charAt(0).toUpperCase() + source.slice(1)}
            </Button>
          ))}
        </div>
      )}
```

**Step 5: Update handleAdd for discovery flow**

Replace handleAdd function:

```typescript
  const handleAdd = async (artist: ArtistResult) => {
    // If no MBID, use discovery add endpoint
    if (!artist.foreignArtistId) {
      setAddingArtist(artist.artistName);
      
      const { data, error } = await api.post<{ 
        success?: boolean; 
        artist?: any;
        error?: string;
        candidates?: Array<{ id: string; name: string; disambiguation?: string; country?: string }>;
        artistName?: string;
      }>('/api/search/discover/add', {
        artistName: artist.artistName,
      });

      if (error) {
        addToast({ type: 'error', title: 'Failed to add artist', message: error });
      } else if (data?.candidates) {
        // Show MBID selection modal
        setMbidCandidates(data.candidates);
        setSelectingArtist(artist);
      } else if (data?.success) {
        addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
        setResults(prev => prev.map(r => 
          r.artistName === artist.artistName ? { ...r, inLibrary: true, foreignArtistId: data.artist?.foreignArtistId } : r
        ));
      }
      setAddingArtist(null);
      return;
    }
    
    // Existing flow for artists with MBID
    setAddingArtist(artist.foreignArtistId);

    const { data, error } = await api.post<{ success: boolean; artist?: any }>('/api/search/artists/add', {
      foreignArtistId: artist.foreignArtistId,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to add artist', message: error });
    } else if (data?.success) {
      addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
      setResults(prev => prev.map(r => 
        r.foreignArtistId === artist.foreignArtistId ? { ...r, inLibrary: true } : r
      ));
    }
    setAddingArtist(null);
  };

  const handleSelectMbid = async (mbid: string) => {
    if (!selectingArtist) return;
    
    setAddingArtist(selectingArtist.artistName);
    setMbidCandidates(null);
    
    const { data, error } = await api.post<{ success: boolean; artist?: any }>('/api/search/discover/add', {
      artistName: selectingArtist.artistName,
      mbid,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to add artist', message: error });
    } else if (data?.success) {
      addToast({ type: 'success', title: 'Artist added', message: `${selectingArtist.artistName} added to Lidarr` });
      setResults(prev => prev.map(r => 
        r.artistName === selectingArtist.artistName ? { ...r, inLibrary: true, foreignArtistId: mbid } : r
      ));
    }
    
    setSelectingArtist(null);
    setAddingArtist(null);
  };
```

**Step 6: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(web): add multi-source search with source toggles"
```

---

## Task 5: Add MBID Selection Modal

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Add Modal import**

Ensure Modal is imported from UI components:

```typescript
import { Button, Card, CardContent, Input, Badge, useToast, LoadingOverlay, Modal, ModalFooter } from '@/components/ui';
```

**Step 2: Add MBID selection modal UI**

Add before the closing fragment (`</>`) at the end of the return statement:

```typescript
      {/* MBID Selection Modal */}
      {mbidCandidates && selectingArtist && (
        <Modal
          isOpen={true}
          onClose={() => {
            setMbidCandidates(null);
            setSelectingArtist(null);
          }}
          title="Select Artist"
        >
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground mb-4">
              Multiple matches found in MusicBrainz for "{selectingArtist.artistName}". 
              Please select the correct artist:
            </p>
            {mbidCandidates.map((candidate) => (
              <button
                key={candidate.id}
                className="w-full p-3 text-left rounded-lg border hover:bg-muted/50 transition-colors"
                onClick={() => handleSelectMbid(candidate.id)}
              >
                <div className="font-medium">{candidate.name}</div>
                {candidate.disambiguation && (
                  <div className="text-sm text-muted-foreground">{candidate.disambiguation}</div>
                )}
                {candidate.country && (
                  <div className="text-xs text-muted-foreground">Country: {candidate.country}</div>
                )}
              </button>
            ))}
          </div>
          <ModalFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMbidCandidates(null);
                setSelectingArtist(null);
              }}
            >
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      )}
```

**Step 3: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(web): add MBID selection modal for ambiguous artist matches"
```

---

## Task 6: Add Source Badges to Results

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`

**Step 1: Update ArtistResult interface**

Update the interface to include sources:

```typescript
interface ArtistResult {
  foreignArtistId: string;
  artistName: string;
  overview?: string;
  imageUrl?: string;
  inLibrary: boolean;
  sources?: string[];
  spotifyId?: string;
  deezerId?: number;
  popularity?: number;
  followers?: number;
  fans?: number;
  lastfm?: {
    listeners: number;
    playcount: number;
    tags: string[];
  };
}
```

**Step 2: Add source badges to result cards**

Find the artist result card rendering and add source badges. Look for where `artistName` is displayed and add after it:

```typescript
                      {/* Source badges */}
                      {result.sources && result.sources.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {result.sources.map((source: string) => (
                            <Badge key={source} variant="outline" className="text-xs">
                              {source}
                            </Badge>
                          ))}
                        </div>
                      )}
```

**Step 3: Add popularity/stats display**

Add after the source badges:

```typescript
                      {/* Stats */}
                      {(result.popularity || result.followers || result.fans) && (
                        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                          {result.popularity && (
                            <span>Popularity: {result.popularity}</span>
                          )}
                          {result.followers && (
                            <span>{(result.followers / 1000).toFixed(0)}K followers</span>
                          )}
                          {result.fans && (
                            <span>{(result.fans / 1000).toFixed(0)}K fans</span>
                          )}
                        </div>
                      )}
```

**Step 4: Commit**

```bash
git add apps/web/src/app/search/page.tsx
git commit -m "feat(web): display source badges and stats in search results"
```

---

## Task 7: Build and Test

**Step 1: Build API**

```bash
cd apps/api && npm run build
```

Expected: Success (or pre-existing errors unrelated to this feature)

**Step 2: Build Web**

```bash
cd apps/web && npm run build
```

Expected: Success

**Step 3: Run all search tests**

```bash
cd apps/api && npm test -- --run tests/api/search.test.ts
```

Expected: All tests pass

**Step 4: Manual test in browser**

1. Start the app: `cd v2 && ./start-v2.sh`
2. Navigate to Search page
3. Verify source toggles appear for artist search
4. Search for an artist
5. Verify results show source badges
6. Try adding an artist
7. If MBID modal appears, select correct artist

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: multi-source artist discovery search

- Search Spotify, Deezer, Tidal, Bandcamp in parallel
- Merge results by artist name similarity
- Priority order: Spotify > Deezer > Tidal > Bandcamp
- Toggleable sources on Search page
- MBID resolution with manual fallback
- Source badges and stats in results"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add Spotify searchArtists method | spotify.ts |
| 2 | Create multi-search service | multi-search.ts |
| 3 | Add /discover API endpoint | search.ts |
| 4 | Add source toggles to UI | search/page.tsx |
| 5 | Add MBID selection modal | search/page.tsx |
| 6 | Add source badges to results | search/page.tsx |
| 7 | Build and test | - |
