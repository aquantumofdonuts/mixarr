# Lidarr Metadata Enrichment Feature Design

**Date:** 2024-12-27  
**Status:** Approved  
**Author:** AI Assistant  

## Problem Statement

The current "Rescan" feature for Lidarr artists only re-fetches metadata from MusicBrainz. When MusicBrainz data is incomplete (missing overview, genres, images), the rescan fails to improve the situation. Users are stuck with incomplete artist profiles.

## Solution

Enhance the rescan/refresh feature to pull metadata from multiple connected sources (Last.fm, Deezer, Spotify, Discogs) and update Lidarr directly via `PUT /api/v1/artist/{id}`.

## Design Decisions

### Approach: Direct Lidarr API Updates

Mixarr will enrich metadata and PUT it directly to Lidarr's API. This:
- Permanently updates Lidarr's database
- Makes metadata visible in Lidarr's own UI
- Only fills gaps (never overwrites existing non-empty data)

### Metadata Priority Strategy: Best Quality

When multiple sources have data, select the "best" value using quality heuristics:

| Field | Heuristic | Sources |
|-------|-----------|---------|
| **Overview/Bio** | Longest non-empty description | Last.fm bio, Discogs profile |
| **Genres** | Union of all unique genres, deduplicated | Last.fm tags, Spotify genres, Deezer genres |
| **Images** | Highest resolution available | Deezer (picture_xl), Last.fm scraped, Discogs |
| **Albums** | No change (MusicBrainz canonical) | — |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Enrichment Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. User triggers "Rescan" / "Enrich Metadata"              │
│                     │                                       │
│                     ▼                                       │
│  2. MetadataEnrichmentService.enrichArtist(artistId)        │
│                     │                                       │
│     ┌───────────────┼───────────────┐                       │
│     ▼               ▼               ▼                       │
│  Last.fm        Deezer          Discogs                     │
│  getArtistInfo  searchArtist    searchArtist                │
│     │               │               │                       │
│     └───────────────┴───────────────┘                       │
│                     │                                       │
│                     ▼                                       │
│  3. MetadataMerger.merge(lidarrArtist, sources[])           │
│     - Pick longest overview                                 │
│     - Union all genres                                      │
│     - Select highest-res image                              │
│                     │                                       │
│                     ▼                                       │
│  4. LidarrService.updateArtist(artistId, enrichedData)      │
│     PUT /api/v1/artist/{id}                                 │
│                     │                                       │
│                     ▼                                       │
│  5. Return enrichment report                                │
│     { enriched: ['overview', 'genres'], failed: [] }        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## New Components

### 1. MetadataEnrichmentService
**File:** `apps/api/src/services/metadata-enrichment.ts`

Orchestrates multi-source fetching:
- Fetches current artist from Lidarr
- Identifies metadata gaps
- Queries connected services in parallel
- Calls MetadataMerger to combine results
- Calls LidarrService.updateArtist() to persist

### 2. MetadataMerger
**File:** `apps/api/src/services/metadata-merger.ts`

Pure functions for quality-based selection:
- `pickBestOverview(sources)` → longest non-empty description
- `mergeGenres(sources)` → deduplicated union of all genres
- `pickBestImage(sources)` → highest resolution image URL

### 3. LidarrService.updateArtist()
**File:** `apps/api/src/services/lidarr.ts` (extend existing)

New method:
- `PUT /api/v1/artist/{id}` with enriched fields
- Only sends fields that changed

### 4. New API Endpoints
**File:** `apps/api/src/routes/search.ts` (extend existing)

- `POST /api/lidarr/artists/:id/enrich` - Enrich single artist
- `POST /api/lidarr/artists/enrich-incomplete` - Batch enrich all artists with issues

### 5. Enrichment Job Queue
**File:** `apps/api/src/jobs/queue.ts` (extend existing)

New queue for batch enrichment jobs with progress tracking.

## API Contracts

### POST /api/lidarr/artists/:id/enrich

**Request:**
```json
{
  "artistId": 123
}
```

**Response:**
```json
{
  "success": true,
  "artistId": 123,
  "artistName": "Artist Name",
  "enriched": ["overview", "genres", "images"],
  "unchanged": ["albums"],
  "errors": []
}
```

### POST /api/lidarr/artists/enrich-incomplete

**Request:**
```json
{
  "issueTypes": ["no_overview", "no_genres", "no_poster"]
}
```

**Response:**
```json
{
  "jobId": "enrich-batch-123",
  "totalArtists": 45,
  "status": "queued"
}
```

## Data Structures

### EnrichedMetadata
```typescript
interface EnrichedMetadata {
  overview?: string;
  genres?: string[];
  images?: {
    url: string;
    coverType: 'poster' | 'fanart' | 'banner';
  }[];
}
```

### EnrichmentSource
```typescript
interface EnrichmentSource {
  name: 'lastfm' | 'deezer' | 'spotify' | 'discogs';
  overview?: string;
  genres?: string[];
  imageUrl?: string;
  imageResolution?: number; // width in pixels
}
```

### EnrichmentReport
```typescript
interface EnrichmentReport {
  success: boolean;
  artistId: number;
  artistName: string;
  enriched: string[];
  unchanged: string[];
  errors: string[];
  sources: string[]; // which sources contributed
}
```

## Error Handling

- **Source timeouts**: Continue with available sources (don't fail entire enrichment)
- **Lidarr API error**: Log and report failure, don't crash
- **Rate limiting**: Respect service rate limits (Last.fm: 1 req/sec, Deezer: 50 req/5sec)
- **No data found**: Report "no enrichment available" to user
- **Partial success**: Report which fields succeeded and which failed

## UI Changes

### Existing "Rescan" Button
- Changes behavior to trigger enrichment flow
- Shows progress indicator during enrichment
- Displays toast notification with results

### New Visual Feedback
- Badge showing which fields were enriched
- Color coding: green (enriched), yellow (partial), red (failed)
- Detailed report modal on click

## Testing Strategy

### Unit Tests
- MetadataMerger: Test each merging function with various inputs
- EnrichmentService: Mock service calls, verify orchestration logic

### Integration Tests
- API endpoints: Test request/response contracts
- LidarrService.updateArtist(): Mock Lidarr API, verify PUT payload

### E2E Tests
- Full enrichment flow with mocked external services

## Research References

- **Lidarr API**: `PUT /api/v1/artist/{id}` confirmed via OpenAPI spec
- **Tubifarry MetaMix**: Reference implementation for multi-source merging
- **Existing services**: Last.fm, Deezer, Discogs services already implemented in Mixarr
