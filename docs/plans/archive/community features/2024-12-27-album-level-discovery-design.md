# Album-Level Discovery Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 2 - Medium Impact  
**Effort:** High  

## Problem Statement

GitHub issue #5655 requests "Add album import support to Custom Lists" in Lidarr. Users want:
- Subscribe to new album releases in a genre
- Import specific albums without adding entire artist discography
- "New releases this week" subscriptions
- Album-focused discovery alongside artist discovery

Current Mixarr is entirely artist-centric. All subscriptions discover artists, and adding an artist monitors their entire discography (per Lidarr's design).

## Solution

Extend Mixarr to support album-level discovery:
1. New subscription types for album discovery
2. Album review queue (alongside artist queue)
3. "Add album only" action that monitors specific album in Lidarr

## Design Decisions

### Option A: Album-Centric (Selected)

Create parallel album discovery flow:
- Album subscriptions → Album review queue → Add album to Lidarr
- Separate from artist flow
- Album added = artist added + only that album monitored

### Option B: Album Tags on Artists (Rejected)

Tag discovered artists with specific albums, still artist-centric:
- More complex state management
- Doesn't cleanly fit "review queue" model

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Album Discovery Flow                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Album Subscriptions                                        │
│  - "New releases this week"                                 │
│  - "Genre: Jazz new albums"                                 │
│  - "Label: ECM releases"                                    │
│          │                                                  │
│          ▼                                                  │
│  Album Review Queue                                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Album Name        Artist         Release   [Actions] │   │
│  │ ────────────────────────────────────────────────────│   │
│  │ Blue Train        John Coltrane  1958      [Add]     │   │
│  │ Kind of Blue      Miles Davis    1959      [Add]     │   │
│  └──────────────────────────────────────────────────────┘   │
│          │                                                  │
│          ▼                                                  │
│  Add Album to Lidarr                                        │
│  1. Add artist if not exists (unmonitored)                  │
│  2. Monitor specific album only                             │
│  3. Trigger search for that album                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### New Subscription Types

| Type | Description | Source |
|------|-------------|--------|
| `spotify_new_albums` | New album releases | Spotify Browse API |
| `lastfm_new_albums` | New releases by tag | Last.fm |
| `deezer_new_albums` | New releases | Deezer |
| `tidal_new_albums` | New arrival albums | TIDAL |
| `musicbrainz_releases` | Recent releases | MusicBrainz |
| `label_releases` | New releases from label | Various |

### Database Schema

```prisma
model AlbumReviewItem {
  id          Int      @id @default(autoincrement())
  userId      Int
  
  // Album identification
  albumName   String
  artistName  String
  mbid        String?         // Album MBID (release group)
  artistMbid  String?
  
  // Metadata
  releaseDate String?
  albumType   String?         // album, single, ep
  coverUrl    String?
  genres      String[]
  label       String?
  
  // State
  source      String          // subscription:name or manual
  status      ReviewStatus    @default(pending)
  addedAt     DateTime        @default(now())
  reviewedAt  DateTime?
  
  user        User            @relation(fields: [userId], references: [id])
  
  @@index([userId, status])
}

model AlbumSubscriptionResult {
  id              Int      @id @default(autoincrement())
  subscriptionId  Int
  runId           Int
  
  albumName       String
  artistName      String
  mbid            String?
  releaseDate     String?
  
  status          String   // discovered, queued, added, skipped
  
  subscription    Subscription @relation(fields: [subscriptionId], references: [id])
  run             SubscriptionRun @relation(fields: [runId], references: [id])
}
```

### Lidarr Album Addition Flow

Adding a single album to Lidarr is more complex than adding an artist:

```typescript
async function addAlbumToLidarr(
  lidarr: LidarrService,
  album: AlbumReviewItem,
  options: AddOptions
): Promise<void> {
  // 1. Check if artist exists
  let artist = await lidarr.findArtistByMbid(album.artistMbid);
  
  if (!artist) {
    // 2. Add artist as UNMONITORED (don't want full discography)
    artist = await lidarr.addArtist({
      foreignArtistId: album.artistMbid,
      monitored: false,           // Important: don't monitor all
      monitorNewItems: 'none',    // Don't auto-monitor new releases
      qualityProfileId: options.qualityProfileId,
      metadataProfileId: options.metadataProfileId,
      rootFolderPath: options.rootFolderPath,
    });
  }
  
  // 3. Find the specific album
  const albums = await lidarr.getAlbums(artist.id);
  const targetAlbum = albums.find(a => 
    a.foreignAlbumId === album.mbid || 
    a.title.toLowerCase() === album.albumName.toLowerCase()
  );
  
  if (!targetAlbum) {
    throw new Error(`Album "${album.albumName}" not found in Lidarr`);
  }
  
  // 4. Monitor just this album
  await lidarr.updateAlbum(targetAlbum.id, { monitored: true });
  
  // 5. Trigger search for this album
  await lidarr.searchAlbum(targetAlbum.id);
}
```

### Lidarr API Endpoints Needed

```typescript
// Existing in LidarrService - may need additions
GET /api/v1/album?artistId={id}         // Get artist's albums
PUT /api/v1/album/{id}                  // Update album (monitor status)
POST /api/v1/command { name: 'AlbumSearch', albumIds: [id] }
```

### Album Review Queue API

**File:** `apps/api/src/routes/album-review.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/album-review` | GET | Get pending album reviews |
| `/api/album-review/:id/add` | POST | Add album to Lidarr |
| `/api/album-review/:id/dismiss` | POST | Dismiss album |
| `/api/album-review/bulk-add` | POST | Add multiple albums |
| `/api/album-review/bulk-dismiss` | POST | Dismiss multiple |

### Frontend Components

**Album Review Queue Page:**

```
┌──────────────────────────────────────────────────────────────┐
│ Album Review Queue                              [Bulk Add]   │
├──────────────────────────────────────────────────────────────┤
│ [Filter: All ▼] [Source: All ▼] [Sort: Newest ▼]            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ▢ ┌─────┐  "Voyage"                                   │  │
│  │   │     │  ABBA • Album • 2021                        │  │
│  │   │ 🎵  │  Source: Spotify New Releases               │  │
│  │   └─────┘                                              │  │
│  │           [Preview] [Add to Lidarr] [Dismiss]          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ▢ ┌─────┐  "30"                                       │  │
│  │   │     │  Adele • Album • 2021                       │  │
│  │   │ 🎵  │  Source: Last.fm Top Albums                 │  │
│  │   └─────┘                                              │  │
│  │           [Preview] [Add to Lidarr] [Dismiss]          │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Album Preview Modal:**

Shows album details, track listing, and artist info before adding.

### Subscription Preset Examples

```typescript
{
  category: 'New Releases',
  presets: [
    {
      name: 'New Albums This Week',
      type: 'spotify_new_albums',
      itemType: 'album',
      config: { days: 7 },
      description: 'New album releases from the past week',
    },
    {
      name: 'Jazz New Releases',
      type: 'lastfm_new_albums',
      itemType: 'album',
      config: { tag: 'jazz', days: 30 },
      description: 'New jazz albums from the past month',
    },
    {
      name: 'Label: ECM Records',
      type: 'label_releases',
      itemType: 'album',
      config: { labelId: 'ecm-records' },
      description: 'New releases from ECM Records',
    },
  ],
}
```

## Challenges

1. **Album MBID Mapping:** External services often don't have MBIDs
2. **Lidarr Album Matching:** Album may not exist in Lidarr's metadata
3. **Partial Discography:** Managing "some albums monitored" state
4. **UI Complexity:** Two review queues (artist + album)

## Mitigation Strategies

1. Search MusicBrainz by album name + artist to find MBID
2. Fallback to name matching if MBID unavailable
3. Clear UI distinction between artist-add and album-add
4. Consider unified queue with "type" filter

## Implementation Phases

**Phase 1:** Album review queue (manual additions)
**Phase 2:** Album subscription types
**Phase 3:** Smart album discovery (similar albums, etc.)

## Implementation Checklist

1. [ ] Create AlbumReviewItem schema
2. [ ] Extend LidarrService with album operations
3. [ ] Create album review API routes
4. [ ] Build album review queue UI
5. [ ] Add album subscription types to worker
6. [ ] Add album presets to subscription picker
7. [ ] Write tests

## Success Metrics

- Users can add individual albums without full discography
- Album subscriptions discover relevant new releases
- Clear distinction between artist and album workflows
