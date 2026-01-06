# Community Features Design

> **Created:** December 23, 2025  
> **Status:** APPROVED  
> **Scope:** Tiers 1-3 from ISSUES.md #28 Community Feature Requests

## Summary

Implementation of 8 features addressing Lidarr community pain points:

1. **Album-Level Imports** - Add specific albums instead of full artist discographies
2. **ListenBrainz Integration** - New source with history, recommendations, stats
3. **Multi-Source Aggregation** - Deduplicate results across sources with confidence scoring
4. **Smart Duplicate Detection** - Match artists by MBID, normalized name, source IDs
5. **Bandcamp Integration** - Read-only tag/genre discovery
6. **Discogs Integration** - Label browsing, style/genre discovery
7. **Genre Display** - Show merged genres from multiple sources (display-only)
8. **Release Type Filtering** - Filter albums by type (Album, EP, Single, etc.)

---

## Design Decisions

| Question | Decision |
|----------|----------|
| Feature priority order | Core infrastructure first (albums → ListenBrainz → aggregation → sources → genres) |
| Album import behavior | Add artist + monitor only selected album(s) |
| Subscription album output | Unified results table with `resultType` field |
| ListenBrainz scope | Full integration (history, recommendations, stats, similar users) |
| Multi-source aggregation | Auto-dedupe with source tracking, sort by match count |
| Bandcamp/Discogs depth | Read-only discovery (no account sync) |
| Genre tagging | Display-only, no Lidarr modification |
| Release type filtering | Filter UI with common types, default Album+EP |

---

## Section 1: Album-Level Imports Foundation

### Schema Changes

**SubscriptionResult table additions:**
```prisma
resultType    String   @default("artist")  // 'artist' | 'album'
albumName     String?
albumMbid     String?
releaseDate   String?
releaseType   String?  // 'album' | 'ep' | 'single' | 'compilation' | 'soundtrack' | 'live' | 'remix'
```

### Lidarr Integration

New `addAlbum()` method in LidarrService:
1. Check if artist exists in Lidarr by MBID
2. If not, add artist with `monitored: false` for all albums
3. Look up the specific album by MBID
4. Set that album to `monitored: true`
5. Trigger search for that album only

### UI Changes

- Review Queue shows album results with album name, cover art, release date, type badge
- "Approve" on album result calls `addAlbum()` instead of `addArtist()`
- Search results (year search, label search) display album cards with "Add Album" button
- Filter dropdown for release types: Album, EP, Single, Compilation, Soundtrack, Live, Remix

---

## Section 2: ListenBrainz Integration

### Connection Type

New connection type: `listenbrainz`
- **Required**: ListenBrainz username (public API, no OAuth needed)
- **Optional**: User token (for future write operations if needed)
- Test connection: Fetch user profile via `GET /1/user/{username}`

### Subscription Types

| Type | Description | Config |
|------|-------------|--------|
| `listenbrainz_top` | User's top artists by time period | `period`: week/month/quarter/half_yearly/year/all_time, `limit` |
| `listenbrainz_similar` | Similar artists to user's listening | `limit`, `minScore` |
| `listenbrainz_recommendations` | ListenBrainz's ML recommendations | `type`: top_artist/similar_artist, `limit` |
| `listenbrainz_stats` | Listening stats/trends | `period`, `limit` |

### Presets

- My ListenBrainz Top Artists (All Time)
- My ListenBrainz Top Artists (Last Year)
- My ListenBrainz Top Artists (Last Month)
- ListenBrainz Similar Artists
- ListenBrainz Recommendations (Top Artist Based)
- ListenBrainz Recommendations (Similar Artist Based)

### API Service

New `services/listenbrainz.ts`:
- `getUserTopArtists(username, period, limit)` → `/1/stats/user/{username}/artists`
- `getSimilarUsers(username)` → `/1/user/{username}/similar-users`
- `getRecommendations(username, type)` → `/1/cf/recommendation/user/{username}/recording`
- Rate limit: 10 requests/second

---

## Section 3: Multi-Source Aggregation & Deduplication

### Matching Algorithm

Match artists across sources using:
1. MusicBrainz ID (exact match, highest confidence)
2. Normalized artist name (lowercase, remove "the", punctuation)
3. Spotify ID / Last.fm URL as secondary identifiers

### Merge Strategy

- Keep the "best" data (prefer MBID source, then most complete metadata)
- Track all sources in new `sources` JSON field: `["spotify", "lastfm", "listenbrainz"]`
- Calculate `matchCount` (number of sources recommending this artist)

### Schema Addition

```prisma
sources       Json     @default("[]")  // Array of source strings
matchCount    Int      @default(1)
```

### Sorting

- Primary: `matchCount` descending (more sources = higher priority)
- Secondary: `createdAt` descending (newer first)

### UI Changes

- Results list shows source badges: 🟢 Spotify | 🔴 Last.fm | 🟠 ListenBrainz | 🔵 MusicBrainz
- "Recommended by 3 sources" indicator for high-confidence results
- Filter by source
- Sort options: "Most Recommended", "Newest", "Name A-Z"

---

## Section 4: Bandcamp & Discogs Integration

### Bandcamp (Read-Only)

**Note**: No official API - uses public tag/discover pages (JSON responses).

**Service**: `services/bandcamp.ts`
- `getTagReleases(tag, sort)` → `/tag/{tag}?sort=pop|date`
- `searchArtists(query)` → Search results scraping

**Subscription Types**:
| Type | Description | Config |
|------|-------------|--------|
| `bandcamp_tag` | Releases by genre tag | `tag`, `sort`: popular/new, `limit` |
| `bandcamp_new` | New releases (all genres) | `limit` |

**Presets**: Bandcamp Electronic, Bandcamp Metal, Bandcamp Hip-Hop, etc.

### Discogs (API-Based)

**Connection**: `discogs` type - requires free API token

**Service**: `services/discogs.ts`
- `searchArtists(query)` → `/database/search?type=artist`
- `searchLabels(query)` → `/database/search?type=label`
- `getLabelReleases(labelId)` → `/labels/{id}/releases`
- `getStyleReleases(style)` → `/database/search?style={style}`
- Rate limit: 60 requests/minute

**Subscription Types**:
| Type | Description | Config |
|------|-------------|--------|
| `discogs_label` | Artists from a record label | `labelId`, `labelName`, `limit` |
| `discogs_style` | Releases by style/genre | `style`, `limit` |

---

## Section 5: Genre Display (Display-Only)

### Data Sources

Fetch and merge from:
1. MusicBrainz tags
2. Last.fm `artist.getTopTags`
3. Spotify artist genres

### Normalization

Simple mapping:
- "hip-hop", "hip hop", "hiphop" → "Hip-Hop"
- "rnb", "r&b" → "R&B"
- Capitalize first letter

### Display Locations

- Search results: Genre pills below artist name
- Subscription results: Genre column
- Review Queue: Genre info in artist card
- Discover Library: Genre filter dropdown

### Implementation

New `utils/genre.ts`:
- `normalizeGenre(genre: string): string`
- `mergeGenres(sources: string[][]): string[]` - dedupe, return top 5

No schema changes - genres fetched on-demand, cached in memory/Redis.

---

## Section 6: Release Type Filtering

### Filter UI

Multi-select dropdown with checkboxes:
- Options: Album, EP, Single, Compilation, Soundtrack, Live, Remix
- Default: Album + EP (saved to localStorage)
- "Select All" / "Clear" buttons

### MusicBrainz Mapping

```
MusicBrainz Type      → Our Type
──────────────────────────────────
Album                 → album
EP                    → ep
Single                → single
Compilation           → compilation
Soundtrack            → soundtrack
Live                  → live
Remix                 → remix
Mixtape/Street        → album
DJ-mix                → remix
Demo/Broadcast/etc    → (excluded)
```

### Applied To

- Album search results (year, label)
- Subscription album outputs
- Review Queue album items

---

## Implementation Order

1. **Phase 1**: Album-Level Imports + Release Type Filtering (foundation)
2. **Phase 2**: ListenBrainz Integration (new source)
3. **Phase 3**: Multi-Source Aggregation + Deduplication (unification)
4. **Phase 4**: Bandcamp + Discogs Integration (additional sources)
5. **Phase 5**: Genre Display (enhancement)
