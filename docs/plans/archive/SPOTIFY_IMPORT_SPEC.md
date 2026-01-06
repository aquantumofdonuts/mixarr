# Spotify Import Feature Specification

## Overview

The Spotify Import feature allows users to import their personal Spotify library content (liked songs, saved albums, followed artists, and user-created playlists) into Lidarr. Each import source is a separate, toggleable item that can be run manually or set to sync automatically.

**Key Dependency:** Requires an authorized Spotify connection with appropriate OAuth scopes.

**Scope Distinction:** This feature handles **user's personal library content** (liked songs, saved albums, followed artists, user-created playlists). For subscribing to Spotify's curated/editorial content (New Releases, Featured Playlists, Discover Weekly), see the separate **Spotify Subscriptions** feature.

**Delivery Expectation:** All import sources, features, and functionality documented in this specification must be fully implemented, tested, and delivered without errors or bugs. No partial implementations or "MVP" subsets are acceptable.

---

## 1. User Interface Design

### 1.1 Location

- New section within the Connection detail/edit page for Spotify connections
- OR a dedicated "Import" tab when viewing a Spotify connection
- Accessible from the Connections page by clicking on a Spotify connection

### 1.2 Import Sources Panel

```
+--------------------------------------------------+
| Spotify Import - [Connection Name]               |
+--------------------------------------------------+
| Your Library Sources                              |
+--------------------------------------------------+
| [Toggle] Liked Songs (2,453 tracks)              |
|          Last synced: Never                       |
|          [Import Now]                             |
+--------------------------------------------------+
| [Toggle] Saved Albums (187 albums)               |
|          Last synced: 2 days ago                  |
|          [Import Now]                             |
+--------------------------------------------------+
| [Toggle] Followed Artists (342 artists)          |
|          Last synced: 1 week ago                  |
|          [Import Now]                             |
+--------------------------------------------------+
| Your Playlists                                    |
+--------------------------------------------------+
| [Toggle] Summer Vibes (89 tracks)                |
|          [Import Now]                             |
| [Toggle] Workout Mix (156 tracks)                |
|          [Import Now]                             |
| [Toggle] Road Trip (203 tracks)                  |
|          [Import Now]                             |
| ... [Load More Playlists]                        |
+--------------------------------------------------+
| Import Settings                                   |
+--------------------------------------------------+
| Schedule: [Manual ▼] / Daily / Weekly / Monthly  |
| Result Handling: [Preview ▼] / Auto-Add / Queue  |
| [Save Settings]                                   |
+--------------------------------------------------+
```

### 1.3 Import Results Preview

When user clicks "Import Now", show preview of first 50 results:

```
+--------------------------------------------------+
| Import Preview - Liked Songs                      |
+--------------------------------------------------+
| Found 2,453 tracks → 1,847 unique albums          |
| Already in Lidarr: 423 | New: 1,424              |
+--------------------------------------------------+
| Album                    | Artist        | Action |
+--------------------------------------------------+
| Midnights               | Taylor Swift  | [Add]  |
| Renaissance             | Beyoncé       | [Add]  |
| Harry's House           | Harry Styles  | [Skip] |
| ...                                               |
+--------------------------------------------------+
| [Add All New] [Cancel]                            |
+--------------------------------------------------+
```

---

## 2. Import Source Types

### 2.1 Liked Songs

| Property | Value |
|----------|-------|
| API Endpoint | `GET /me/tracks` |
| Import Target | **Albums** (extract album from each track) |
| Scope Required | `user-library-read` |
| Pagination | Yes (50 per page, fetch all) |

**Logic:**
```python
# For each liked song, extract the album
for saved_track in liked_songs:
    album = saved_track['track']['album']
    # Add album to import list (deduplicate by album ID)
```

### 2.2 Saved Albums

| Property | Value |
|----------|-------|
| API Endpoint | `GET /me/albums` |
| Import Target | **Albums** (direct) |
| Scope Required | `user-library-read` |
| Pagination | Yes (50 per page, fetch all) |

**Logic:**
```python
# Direct album import
for saved_album in saved_albums:
    album = saved_album['album']
    # Add album to import list
```

### 2.3 Followed Artists

| Property | Value |
|----------|-------|
| API Endpoint | `GET /me/following?type=artist` |
| Import Target | **Artists** (direct) |
| Scope Required | `user-follow-read` |
| Pagination | Yes (cursor-based, 50 per page) |

**Logic:**
```python
# Direct artist import
for artist in followed_artists:
    # Add artist to import list
```

### 2.4 Playlists

| Property | Value |
|----------|-------|
| API Endpoint | `GET /users/{user_id}/playlists` then `GET /playlists/{id}/tracks` |
| Import Target | **Albums** (extract from tracks) |
| Scope Required | `playlist-read-private`, `playlist-read-collaborative` |
| Pagination | Yes |

**Logic:**
```python
# For each track in playlist, extract the album
for playlist_item in playlist_tracks:
    track = playlist_item['track']
    if track:  # Track can be null if removed
        album = track['album']
        # Add album to import list (deduplicate)
```

---

## 3. Database Schema

### 3.1 New Table: Import Sources

```sql
CREATE TABLE spotify_import_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL,
    
    -- Source identification
    source_type VARCHAR(50) NOT NULL,  -- 'liked_songs', 'saved_albums', 'followed_artists', 'playlist'
    spotify_id VARCHAR(100),  -- Playlist ID (null for library sources)
    name VARCHAR(255),  -- Display name (playlist name or "Liked Songs", etc.)
    
    -- Status
    is_enabled BOOLEAN DEFAULT FALSE,
    item_count INTEGER,  -- Track/album/artist count from Spotify
    
    -- Sync tracking
    last_sync DATETIME,
    last_sync_status VARCHAR(50),
    last_sync_count INTEGER,  -- How many items were processed
    last_sync_added INTEGER,  -- How many were added to Lidarr
    last_sync_skipped INTEGER,  -- How many were skipped (duplicates)
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Track individual import results
CREATE TABLE spotify_import_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    
    -- Item details
    item_type VARCHAR(20) NOT NULL,  -- 'album', 'artist'
    spotify_id VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    artist_name VARCHAR(255),  -- For albums
    
    -- Processing status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'added', 'exists', 'failed', 'skipped'
    lidarr_id INTEGER,  -- If added to Lidarr
    error_message TEXT,
    
    processed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (source_id) REFERENCES spotify_import_sources(id) ON DELETE CASCADE
);

-- Import settings per connection
CREATE TABLE spotify_import_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    connection_id INTEGER NOT NULL UNIQUE,
    
    schedule VARCHAR(20) DEFAULT 'manual',  -- 'manual', 'daily', 'weekly', 'monthly'
    result_handling VARCHAR(50) DEFAULT 'preview',  -- 'preview', 'auto_add', 'queue_review'
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_import_sources_connection ON spotify_import_sources(connection_id);
CREATE INDEX idx_import_sources_enabled ON spotify_import_sources(is_enabled);
CREATE INDEX idx_import_results_source ON spotify_import_results(source_id);
CREATE INDEX idx_import_results_status ON spotify_import_results(status);
```

---

## 4. API Endpoints

### 4.1 Import Source Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/spotify/<conn_id>/import` | Get import sources & settings |
| POST | `/api/spotify/<conn_id>/import/refresh` | Refresh source list from Spotify |
| PUT | `/api/spotify/<conn_id>/import/sources/<source_id>` | Toggle source enabled/disabled |
| POST | `/api/spotify/<conn_id>/import/sources/<source_id>/run` | Run import for single source |
| POST | `/api/spotify/<conn_id>/import/run-all` | Run all enabled imports |
| GET | `/api/spotify/<conn_id>/import/sources/<source_id>/preview` | Preview import results |
| PUT | `/api/spotify/<conn_id>/import/settings` | Update import settings |

### 4.2 Result Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/spotify/<conn_id>/import/results` | Get recent import results |
| POST | `/api/spotify/<conn_id>/import/results/<id>/add` | Add single result to Lidarr |
| POST | `/api/spotify/<conn_id>/import/results/add-pending` | Add all pending results |

---

## 5. Import Settings

### 5.1 Schedule Options

| Option | Behavior |
|--------|----------|
| Manual | Only runs when user clicks "Import Now" |
| Daily | Runs once per day (checks for new items) |
| Weekly | Runs once per week |
| Monthly | Runs once per month |

### 5.2 Result Handling Options

| Option | Behavior |
|--------|----------|
| Preview Only | Store results, show in UI, no auto action |
| Auto-Add to Lidarr | Automatically add new items to Lidarr |
| Queue for Review | Store in review queue for manual approval |

### 5.3 Duplicate Handling

- Skip silently and log at DEBUG level
- Check against:
  1. Existing Lidarr library
  2. Previously imported items (by Spotify ID)

### 5.4 Data Retention

- Import results: Purge after 30 days
- Background job runs daily to clean old records

---

## 6. Implementation Plan

### Phase 1: Database & Models (2-3 hours)
1. Create migration for new tables
2. Add models to `models/models.py`:
   - `SpotifyImportSource`
   - `SpotifyImportResult`
   - `SpotifyImportSettings`

### Phase 2: Service Layer (4-5 hours)
1. Create `services/spotify_import.py`
2. Implement library fetching:
   - `fetch_liked_songs(connection)`
   - `fetch_saved_albums(connection)`
   - `fetch_followed_artists(connection)`
   - `fetch_user_playlists(connection)`
   - `fetch_playlist_tracks(connection, playlist_id)`
3. Implement album/artist extraction logic
4. Implement Lidarr integration (check exists, add)

### Phase 3: Routes (2-3 hours)
1. Add import routes to `routes/routes.py` or new `routes/spotify_import.py`
2. Implement all API endpoints
3. Add to scheduler for recurring imports

### Phase 4: UI (4-5 hours)
1. Create import section in connection view
2. Create source list with toggles
3. Create preview modal
4. Create results view
5. Add settings form

### Phase 5: Scheduler Integration (1-2 hours)
1. Add import jobs to scheduler
2. Track sync state
3. Stagger import runs (5 minute delay between jobs)

### Phase 6: Testing (2-3 hours)
1. Test all import sources
2. Test large libraries (pagination)
3. Test duplicate handling
4. Test error scenarios

**Total Estimated Time: 15-21 hours**

---

## 7. Service Layer Details

### 7.1 Main Import Service

```python
# services/spotify_import.py

class SpotifyImportService:
    def __init__(self, connection):
        self.connection = connection
        self.spotify = self._get_spotify_client()
    
    def refresh_sources(self):
        """Fetch all available import sources from Spotify."""
        sources = []
        
        # Library sources (always available)
        sources.append({
            'source_type': 'liked_songs',
            'name': 'Liked Songs',
            'item_count': self._get_liked_songs_count()
        })
        sources.append({
            'source_type': 'saved_albums',
            'name': 'Saved Albums',
            'item_count': self._get_saved_albums_count()
        })
        sources.append({
            'source_type': 'followed_artists',
            'name': 'Followed Artists',
            'item_count': self._get_followed_artists_count()
        })
        
        # User playlists
        playlists = self._fetch_user_playlists()
        for playlist in playlists:
            sources.append({
                'source_type': 'playlist',
                'spotify_id': playlist['id'],
                'name': playlist['name'],
                'item_count': playlist['tracks']['total']
            })
        
        return sources
    
    def run_import(self, source):
        """Run import for a specific source."""
        if source.source_type == 'liked_songs':
            return self._import_liked_songs(source)
        elif source.source_type == 'saved_albums':
            return self._import_saved_albums(source)
        elif source.source_type == 'followed_artists':
            return self._import_followed_artists(source)
        elif source.source_type == 'playlist':
            return self._import_playlist(source)
    
    def _import_liked_songs(self, source):
        """Import albums from liked songs."""
        albums = {}
        offset = 0
        
        while True:
            results = self.spotify.current_user_saved_tracks(limit=50, offset=offset)
            for item in results['items']:
                track = item['track']
                if track and track.get('album'):
                    album = track['album']
                    if album['id'] not in albums:
                        albums[album['id']] = {
                            'spotify_id': album['id'],
                            'name': album['name'],
                            'artist_name': album['artists'][0]['name'] if album['artists'] else None,
                            'item_type': 'album'
                        }
            
            if not results['next']:
                break
            offset += 50
        
        return self._process_import_results(source, list(albums.values()))
```

### 7.2 Lidarr Integration

```python
def _add_to_lidarr(self, item):
    """Add album or artist to Lidarr."""
    if item['item_type'] == 'album':
        # Search for album in Lidarr/MusicBrainz
        # Add artist if not exists, then monitor album
        pass
    elif item['item_type'] == 'artist':
        # Search for artist in Lidarr/MusicBrainz
        # Add artist with configured quality profile
        pass
```

---

## 8. Error Handling

| Scenario | Behavior |
|----------|----------|
| Token expired | Attempt refresh, show warning with re-auth instructions if fails |
| Rate limit (429) | Exponential backoff, retry |
| Playlist not found | Mark source as unavailable, log error |
| Track unavailable | Skip track, continue with others |
| Lidarr unreachable | Queue results, retry later |
| Duplicate item | Skip silently, log at DEBUG |
| Artist not found in MusicBrainz | Log warning, skip item |
| Insufficient OAuth scopes | Show warning with re-authorization instructions |

### 8.1 OAuth Scope Validation

On import run, check if connection has required scopes. If missing:
```
"This import requires additional permissions. Please re-authorize 
 your Spotify connection. Click here to re-authorize."
```

Do not allow running import until scopes are granted.

---

## 9. Required OAuth Scopes

```python
SPOTIFY_IMPORT_SCOPES = [
    'user-library-read',           # Read liked songs, saved albums
    'user-follow-read',            # Read followed artists
    'playlist-read-private',       # Read private playlists
    'playlist-read-collaborative', # Read collaborative playlists
]
```

---

## 10. Rate Limiting

Uses the centralized rate limiter from Last.fm Subscription spec Section 9.

- Spotify API: 5 requests per second (conservative limit)
- Lidarr API: 10 requests per second (local service)
- Import jobs staggered with 5-minute delays

```python
# Usage in import service
from services.rate_limiter import RateLimiter

RateLimiter.get('spotify').wait()
response = spotify.current_user_saved_tracks(...)
```

---

## 11. UI Component Details

### 11.1 Source Card

```html
<div class="import-source-card">
    <div class="source-toggle">
        <input type="checkbox" id="source-{id}" checked>
    </div>
    <div class="source-info">
        <h5>Liked Songs</h5>
        <small class="text-muted">2,453 tracks → ~1,847 albums</small>
        <div class="sync-status">
            Last synced: 2 days ago | Added: 23
        </div>
    </div>
    <div class="source-actions">
        <button class="btn btn-sm btn-primary">Import Now</button>
    </div>
</div>
```

### 11.2 Preview Modal

Shows first 50 items with:
- Album/Artist name
- Artist name (for albums)
- Status indicator (New, Exists, Error)
- Individual Add button
- "Add All New" bulk action

---

## 12. Sync State Tracking

Track what has been imported to avoid duplicates:

```python
def is_already_imported(source_id, spotify_id):
    """Check if item was previously imported."""
    return SpotifyImportResult.query.filter_by(
        source_id=source_id,
        spotify_id=spotify_id,
        status='added'
    ).first() is not None

def get_new_items_only(source, items):
    """Filter to only items not yet imported."""
    return [
        item for item in items
        if not is_already_imported(source.id, item['spotify_id'])
    ]
```

---

## 13. File Structure

```
routes/
  routes.py              # Add import routes (or new file)
  spotify_import.py      # NEW: Spotify import routes

services/
  spotify_import.py      # NEW: Import service

templates/
  spotify_import.html    # NEW: Import UI (or section in connection view)

models/
  models.py              # Add SpotifyImportSource, SpotifyImportResult, SpotifyImportSettings
```

---

## 14. Lidarr Integration

All items are added to Lidarr as **artists** via `POST /api/v1/artist`:

| Import Source | Extract | Lidarr Action |
|---------------|---------|---------------|
| Liked Songs | Album from each track | Look up artist from album → Add artist |
| Saved Albums | Album directly | Look up artist from album → Add artist |
| Followed Artists | Artist directly | Add artist |
| Playlists | Album from each track | Look up artist from album → Add artist |

### Lidarr Add Payload

```python
add_data = {
    "artistName": canonical_artist_name,
    "foreignArtistId": mbid,  # MusicBrainz Artist ID
    "monitored": True,
    "rootFolderPath": connection.lidarr_root_folder,
    "qualityProfileId": connection.lidarr_quality_profile_id,
    "metadataProfileId": connection.lidarr_metadata_profile_id,
    "addOptions": {
        "monitor": connection.lidarr_monitoring_option,
        "searchForMissingAlbums": True
    }
}
```

### Lookup Flow

1. For albums: Get artist name from album data
2. Search Lidarr/MusicBrainz: `GET /api/v1/artist/lookup?term={artist_name}`
3. Get `foreignArtistId` (MBID) from search results
4. Add artist: `POST /api/v1/artist`

### Lidarr Library Caching

Same as subscriptions. Before processing import results:
1. Fetch all artists from Lidarr: `GET /api/v1/artist`
2. Build lookup sets (MBIDs, names)
3. Filter results against cache before attempting adds
4. Cache is valid for duration of import run only

See Last.fm Subscription spec Section 14.4 for implementation details.

---

## 15. Run Concurrency Control

### 15.1 Preventing Duplicate Runs

Each import source tracks running state to prevent concurrent executions:

```python
# In SpotifyImportSource model
is_running = db.Column(db.Boolean, default=False)
run_started_at = db.Column(db.DateTime, nullable=True)
```

### 15.2 Lock Behavior

- Import run acquires lock on source before starting
- If already running, return 409 Conflict with "already in progress" message
- Stale lock detection: If `is_running=True` but `run_started_at > 1 hour ago`, assume crashed and allow new run
- Lock released on run completion (success or failure)

### 15.3 UI Indication

- Show "Running..." indicator on source card when `is_running=True`
- Disable "Import Now" button while running
- Show spinner or progress indicator

See Last.fm Subscription spec Section 15 for full implementation details.

---

## 16. Review Queue

For "Queue for Review" result handling:

- Review queue accessible via button on import source card
- Opens modal showing pending items
- User can approve/reject individually or in bulk
- Approved items are added to Lidarr
- Rejected items are marked as 'rejected' and skipped in future syncs

### Review Queue UI

```
+--------------------------------------------------+
| Review Queue - Liked Songs                        |
+--------------------------------------------------+
| 47 items pending review                           |
+--------------------------------------------------+
| [x] Album Name - Artist    | [Approve] [Reject]  |
| [x] Album Name - Artist    | [Approve] [Reject]  |
| ...                                               |
+--------------------------------------------------+
| [Approve Selected] [Reject Selected]              |
+--------------------------------------------------+
```

---

## 17. Edit Import Source Settings

Edit functionality for existing import configurations.

### Editable Per-Source Settings

| Setting | Editable | Notes |
|---------|----------|-------|
| Enabled | Yes | Toggle on/off |
| (Other settings are global to all sources) | | |

### Global Import Settings (per connection)

| Setting | Editable |
|---------|----------|
| Schedule | Yes |
| Result Handling | Yes |

### Edit Flow

1. User accesses import settings via connection detail page
2. Toggle individual sources on/off
3. Modify global schedule/result handling
4. Click "Save Settings"
5. Changes take effect immediately for manual runs, scheduler updated for auto sync

