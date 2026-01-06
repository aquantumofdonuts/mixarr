# Duplicate Detection Improvements Design

**Date:** 2024-12-28  
**Status:** Approved  

## Problem

The current duplicate detection screen finds duplicates but lacks actionable information. Users see artist names and similarity scores but can't make informed decisions about which duplicate to keep without manually checking Lidarr.

## Solution

Enhance the expanded duplicate view with a side-by-side comparison table showing comprehensive data from Lidarr, loaded on-demand when the user expands a duplicate pair.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary use case | Decision support | Help users decide which to keep |
| Data to show | Comprehensive (audio quality, completeness, organization) | Users want full context |
| Performance strategy | Fetch on expand | Keep initial load fast |
| UI pattern | Side-by-side comparison table | Best for attribute comparison |

## Data to Display

### From Lidarr Artist API (already available)
- `path` - Full disk path to artist folder
- `rootFolderPath` - Root folder name
- `qualityProfileId` - Quality profile (resolve to name)
- `monitored` - Whether artist is monitored
- `statistics.albumCount` - Number of albums
- `statistics.trackCount` - Total tracks
- `statistics.trackFileCount` - Downloaded tracks
- `statistics.sizeOnDisk` - Total size

### From Lidarr TrackFile API (fetch on expand)
- Average bitrate across all files
- Predominant format (FLAC, MP3, etc.)
- Quality breakdown (e.g., "80% FLAC, 20% MP3")

## UI Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Collapsed duplicate row - existing UI]                                 │
├─────────────────────────────────────────────────────────────────────────┤
│ [Expanded View]                                                         │
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 💡 Recommendation: Keep "Air" (left) - more complete library      │  │
│  │    Reasoning: Has more albums and larger file size...             │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────┬───────────────────┬───────────────────┐           │
│  │ Attribute       │ Air               │ Air               │           │
│  ├─────────────────┼───────────────────┼───────────────────┤           │
│  │ Path            │ /music/Air        │ /music2/Air       │           │
│  │ Root Folder     │ Music             │ Music2            │           │
│  │ Albums          │ 11 ✓              │ 9                 │           │
│  │ Tracks          │ 142 ✓             │ 98                │           │
│  │ Downloaded      │ 142/142 (100%) ✓  │ 0/98 (0%)         │           │
│  │ Size            │ 477 MB ✓          │ 0 B               │           │
│  │ Avg Bitrate     │ 892 kbps ✓        │ —                 │           │
│  │ Format          │ FLAC              │ —                 │           │
│  │ Quality Profile │ Lossless          │ Any               │           │
│  │ Monitored       │ Yes               │ No                │           │
│  │ MusicBrainz     │ [Link]            │ [Link]            │           │
│  └─────────────────┴───────────────────┴───────────────────┘           │
│                                                                         │
│  [Dismiss as Not Duplicate]                                             │
└─────────────────────────────────────────────────────────────────────────┘
```

### Visual Indicators

- **Green checkmark (✓)** next to the "winning" value for each comparable attribute
- **Dash (—)** when data is unavailable (e.g., no files downloaded)
- **Loading spinner** while fetching track file details

## API Changes

### Extend `/api/duplicates/:key/guidance` Response

Add `detailedComparison` object:

```typescript
interface DetailedComparison {
  artist1: ArtistDetails;
  artist2: ArtistDetails;
}

interface ArtistDetails {
  id: number;
  name: string;
  path: string;
  rootFolder: string;
  qualityProfile: string;      // Resolved name, not ID
  monitored: boolean;
  albumCount: number;
  trackCount: number;
  trackFileCount: number;
  percentComplete: number;     // trackFileCount / trackCount * 100
  sizeOnDisk: number;
  avgBitrate: number | null;   // null if no files
  formats: string[];           // e.g., ["FLAC", "MP3"]
  primaryFormat: string | null;
  musicbrainzUrl: string;
}
```

### New Lidarr Service Method

```typescript
async getTrackFilesForArtist(artistId: number): Promise<TrackFile[]>
```

Returns array with bitrate, quality, and format for each file.

## Implementation Tasks

1. Add `getTrackFilesForArtist()` to LidarrService
2. Add `getQualityProfileName()` helper to resolve profile ID → name
3. Extend guidance endpoint to return `detailedComparison`
4. Update duplicates page UI with comparison table component
5. Add visual "winner" indicators with green checkmarks
6. Handle loading/error states for track file fetch

## Out of Scope

- Automatic merge/delete actions (decision support only)
- Bulk comparison of multiple duplicates
- Exporting duplicate report
