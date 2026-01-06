# Library Health Dashboard Design

**Date:** 2024-12-27  
**Updated:** 2024-12-28  
**Status:** Partially Implemented  
**Priority:** Tier 1 - High Impact  
**Effort:** Low (remaining work)  

## Current Implementation Status

### ✅ Already Implemented

The `/library` page already provides most of the core functionality:

**Frontend (`apps/web/src/app/library/page.tsx`):**
- ✅ Issue detection for 4 types: no_albums, no_poster, no_overview, no_genres
- ✅ Stats cards showing counts for each issue type
- ✅ Search, filter by issue type, sort by name/albumCount/issues
- ✅ Multi-select checkboxes for bulk operations
- ✅ Visual status icons (green/yellow) per artist
- ✅ Per-artist "Refresh" button (triggers Lidarr refresh from MusicBrainz)
- ✅ Bulk "Refresh Selected" and "Refresh All Filtered" buttons

**Backend (`apps/api/src/routes/search.ts`):**
- ✅ `GET /api/search/lidarr/artists` - Lists artists with metadata issues
- ✅ `POST /api/search/lidarr/artists/:id/refresh` - Triggers Lidarr refresh
- ✅ `POST /api/search/lidarr/artists/refresh-by-issue` - Batch Lidarr refresh
- ✅ `POST /api/search/lidarr/artists/:id/enrich` - **API exists** (uses MetadataEnrichmentService)
- ✅ `POST /api/search/lidarr/artists/enrich-incomplete` - **API exists** (batch enrichment)

**Backend (`apps/api/src/services/metadata-enrichment.ts`):**
- ✅ `MetadataEnrichmentService` - Fetches from Last.fm + Deezer, merges, updates Lidarr
- ✅ `LastfmMetadataAdapter` and `DeezerMetadataAdapter`
- ✅ `MetadataMerger` - Best-quality selection across sources

### ❌ Not Yet Implemented (Gaps)

| Feature | Description |
|---------|-------------|
| **Enrich buttons in UI** | The `/enrich` APIs exist but have NO UI buttons - only "Refresh" (MusicBrainz) is exposed |
| **Health Score** | Single 0-100% aggregate metric (currently just 4 separate counts) |
| **EnrichmentLog table** | Track what was enriched, when, from which source |
| **LibraryHealthScan history** | Store scan snapshots for trend tracking |
| **WebSocket progress** | Real-time progress during batch enrichment |

## Problem Statement

~~Users frequently struggle with incomplete Lidarr library metadata.~~ **Mostly solved by current `/library` page.**

**Remaining problem:** Users can "Refresh" artists (re-query MusicBrainz via Lidarr) but cannot "Enrich" artists (pull richer metadata from Last.fm/Deezer). The enrichment backend is complete but has no UI.

## Solution (Remaining Work)

Enhance the existing `/library` page:
1. Add "Enrich" buttons that call the existing `/enrich` APIs
2. Add aggregate health score with visual progress bar
3. Optionally: Add enrichment history logging

## User Stories

1. ~~As a user, I want to see which artists are missing metadata~~ ✅ Done
2. **As a user, I want to enrich a single artist's metadata with one click** ← Needs UI button
3. **As a user, I want to batch-enrich all artists missing a specific field** ← Needs UI button
4. As a user, I want to see an overall health score for my library ← Nice to have
5. As a user, I want to see enrichment history to know what was fixed ← Nice to have

## Remaining Implementation

### Priority 1: Add Enrich Buttons to UI

The backend is complete. Just need UI buttons:

**File:** `apps/web/src/app/library/page.tsx`

1. Add per-artist "Enrich" button next to existing "Refresh" button
2. Add bulk "Enrich Selected" and "Enrich All Filtered" buttons
3. Call existing APIs: `/api/search/lidarr/artists/:id/enrich` and `/enrich-incomplete`

```tsx
// Add enrichArtist function
const enrichArtist = async (artistId: number) => {
  setRefreshingArtists(prev => new Set(prev).add(artistId));
  
  const { data, error } = await api.post<EnrichmentResult>(
    `/api/search/lidarr/artists/${artistId}/enrich`,
    { updateLidarr: true }
  );
  
  if (error) {
    addToast({ type: 'error', title: 'Failed to enrich artist' });
  } else if (data?.updated) {
    addToast({ 
      type: 'success', 
      title: 'Artist enriched', 
      message: `Updated: ${data.fieldsUpdated.join(', ')}` 
    });
  } else {
    addToast({ type: 'info', title: 'No new metadata found' });
  }
  
  setRefreshingArtists(prev => {
    const next = new Set(prev);
    next.delete(artistId);
    return next;
  });
  
  // Refresh list to show updated status
  setTimeout(fetchArtists, 1000);
};

// Add bulk enrich function
const enrichByIssue = async (issueType: string) => {
  setIsBulkRefreshing(true);
  
  const { data, error } = await api.post<{ enriched: number; total: number; message: string }>(
    '/api/search/lidarr/artists/enrich-incomplete',
    { issueType, limit: 50 }
  );
  
  if (error) {
    addToast({ type: 'error', title: 'Failed to enrich artists', message: error });
  } else if (data) {
    addToast({ type: 'success', title: 'Batch enrichment complete', message: data.message });
    setTimeout(fetchArtists, 2000);
  }
  
  setIsBulkRefreshing(false);
};
```

Add buttons in table row:
```tsx
<td className="text-right py-3 px-2 space-x-1">
  <Button size="sm" variant="ghost" onClick={() => enrichArtist(artist.id)} title="Enrich from Last.fm/Deezer">
    <Sparkles className="h-4 w-4" />
  </Button>
  <Button size="sm" variant="ghost" onClick={() => refreshArtist(artist.id)} title="Refresh from MusicBrainz">
    <RefreshCw className="h-4 w-4" />
  </Button>
</td>
```

Add bulk button in toolbar:
```tsx
{filter !== 'all' && filter !== 'complete' && filteredArtists.length > 0 && (
  <Button
    variant="default"
    onClick={() => enrichByIssue(filter === 'needs_refresh' ? 'any' : filter)}
    disabled={isBulkRefreshing}
  >
    <Sparkles className="h-4 w-4 mr-2" />
    Enrich All Filtered (up to 50)
  </Button>
)}
```

### Priority 2: Add Health Score (Optional Enhancement)

Add a health score calculation to the API response and display as progress bar:

**Backend:** Add to `GET /api/search/lidarr/artists` response:

```typescript
const healthScore = calculateHealthScore(artistsWithStats);

res.json({ 
  artists: artistsWithStats,
  total: artistsWithStats.length,
  healthScore,  // NEW
  issueStats,
});

function calculateHealthScore(artists: typeof artistsWithStats): number {
  if (artists.length === 0) return 100;
  
  const weights = { overview: 0.3, poster: 0.25, genres: 0.25, albums: 0.2 };
  
  const overviewScore = artists.filter(a => a.hasOverview).length / artists.length;
  const posterScore = artists.filter(a => a.hasPoster).length / artists.length;
  const genresScore = artists.filter(a => a.hasGenres).length / artists.length;
  const albumsScore = artists.filter(a => a.albumCount > 0).length / artists.length;
  
  return Math.round(
    (overviewScore * weights.overview +
     posterScore * weights.poster +
     genresScore * weights.genres +
     albumsScore * weights.albums) * 100
  );
}
```

**Frontend:** Add health score card at top of page:

```tsx
<Card className="col-span-full mb-4">
  <CardContent className="pt-4">
    <div className="flex items-center gap-4">
      <div className="text-2xl font-bold">{healthScore}%</div>
      <div className="flex-1">
        <div className="text-sm text-muted-foreground mb-1">Library Health</div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div 
            className="h-full bg-green-500 transition-all" 
            style={{ width: `${healthScore}%` }} 
          />
        </div>
      </div>
    </div>
  </CardContent>
</Card>
```

### Priority 3: Enrichment History (Future)

Add database logging for enrichment operations. See schema in original design.

## Implementation Checklist

### Completed ✅
- [x] Issue detection (no_albums, no_poster, no_overview, no_genres)
- [x] Stats cards with issue counts
- [x] Filtering by issue type
- [x] Search and sorting
- [x] Multi-select checkboxes
- [x] Per-artist Refresh button (MusicBrainz via Lidarr)
- [x] Bulk Refresh buttons
- [x] MetadataEnrichmentService (Last.fm + Deezer)
- [x] Enrich API endpoints

### Remaining Work
- [x] Add "Enrich" button per artist row (calls existing API) ✅ 2024-12-28
- [x] Add "Enrich All Filtered" bulk button (calls existing API) ✅ 2024-12-28
- [ ] Add health score calculation to API response
- [ ] Add health score progress bar to UI
- [ ] Optional: Add EnrichmentLog table for history tracking

## Notes

- **No new routes needed** - Enrich APIs already exist at `/api/search/lidarr/artists/:id/enrich`
- **No new services needed** - MetadataEnrichmentService is complete
- **Estimated effort:** ~2-4 hours to add UI buttons and health score

## Success Metrics

- Users can enrich artists with one click
- 80%+ of enrichment attempts succeed
- Health score improves after enrichment runs

## Dependencies

- ✅ Lidarr connection (existing)
- ✅ MetadataEnrichmentService (implemented)
- ✅ Last.fm connection (existing)
- Optional: Deezer connection for additional metadata
