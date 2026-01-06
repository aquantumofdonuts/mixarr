# Spotify Subscriptions Feature Specification

## Overview

The Spotify Subscriptions feature enables automated discovery of artists and albums from Spotify based on charts, categories, playlists, and personalized content. Users can subscribe to both public Spotify content and their personalized recommendations.

**Key Dependency:** Subscriptions require an authorized Spotify connection with appropriate OAuth scopes.

**Scope Distinction:** This feature handles **discovery from Spotify's curated/editorial content** (new releases, featured playlists, categories, personalized playlists like Discover Weekly). For importing user's personal library (liked songs, saved albums, followed artists, user-created playlists), see the separate **Spotify Import** feature.

**Delivery Expectation:** All presets, features, and functionality documented in this specification must be fully implemented, tested, and delivered without errors or bugs. No partial implementations or "MVP" subsets are acceptable.

---

## 1. User Interface Design

### 1.1 Navigation

- Shares the existing "Subscriptions" nav item with Last.fm subscriptions
- Subscriptions are scoped to a connection
- Source service (Last.fm/Spotify) determined by connection type
- Tab or filter to view subscriptions by service type

### 1.2 Page Layout

Same two-panel layout as Last.fm subscriptions:
- Left Panel: My Subscriptions (filtered by source)
- Right Panel: Recent Activity

### 1.3 Subscription Builder

Single page with sections, matching Last.fm pattern:
- **Section A:** Quick Presets (Spotify-specific)
- **Section B:** Custom Builder with Spotify-specific filters

---

## 2. Spotify API Endpoints

### 2.1 Public/Editorial Content (No User Auth Required Beyond Basic Token)

| Endpoint | Description | Parameters |
|----------|-------------|------------|
| `GET /browse/new-releases` | New album releases | limit, offset |
| `GET /browse/categories` | Browse categories list | locale, limit, offset |
| `GET /browse/featured-playlists` | Spotify-curated playlists | locale, limit, offset |

### 2.2 User Library (Requires User Auth)

| Endpoint | Description | Scope Required |
|----------|-------------|----------------|
| `GET /me/tracks` | User's liked/saved songs | `user-library-read` |
| `GET /me/albums` | User's saved albums | `user-library-read` |
| `GET /me/following?type=artist` | User's followed artists | `user-follow-read` |
| `GET /users/{user_id}/playlists` | User's playlists | `playlist-read-private` |

### 2.3 Personalized Content (Requires User Auth)

| Content Type | Access Method | Notes |
|--------------|---------------|-------|
| Discover Weekly | User's playlists (name contains "Discover Weekly") | Spotify-generated |
| Release Radar | User's playlists (name contains "Release Radar") | Spotify-generated |
| Daily Mix 1-6 | User's playlists (name starts with "Daily Mix") | Spotify-generated |
| On Repeat | User's playlists (name = "On Repeat") | Spotify-generated |
| Repeat Rewind | User's playlists (name = "Repeat Rewind") | Spotify-generated |

---

## 3. Canned Subscription Presets

### 3.1 Public/Editorial Presets

| Preset Name | API Source | Strategy |
|-------------|------------|----------|
| New Releases | `/browse/new-releases` | Import albums |
| Featured Playlists | `/browse/featured-playlists` | Extract albums from tracks |
| Pop Hits | Category "Pop" playlists | Extract albums |
| Rock Essentials | Category "Rock" playlists | Extract albums |
| Hip-Hop Central | Category "Hip-Hop" playlists | Extract albums |
| Electronic/Dance | Category "Electronic/Dance" playlists | Extract albums |
| Chill Vibes | Category "Chill" playlists | Extract albums |
| Workout Energy | Category "Workout" playlists | Extract albums |
| Focus & Study | Category "Focus" playlists | Extract albums |
| Party Mix | Category "Party" playlists | Extract albums |

### 3.2 Personalized Presets (Require User Auth)

| Preset Name | Source | Strategy |
|-------------|--------|----------|
| My Discover Weekly | User's "Discover Weekly" playlist | Extract albums from tracks |
| My Release Radar | User's "Release Radar" playlist | Extract albums from tracks |
| My Daily Mix | User's "Daily Mix" playlists (all) | Extract albums from tracks |
| My On Repeat | User's "On Repeat" playlist | Extract albums from tracks |

*Note: These are Spotify-generated playlists, not user-created. User-created playlists are handled by the Spotify Import feature.*

---

## 4. Filter Options (Custom Builder)

### 4.1 Source Type Selection

Radio buttons:
- Spotify New Releases
- Spotify Category Playlists
- Spotify Featured Playlists
- Personalized Playlists
- Specific Playlist URL

### 4.2 Category Filter (for Category Playlists)

Dropdown populated dynamically from `/browse/categories`:
- Pop, Rock, Hip-Hop, R&B, Latin, Electronic/Dance
- Indie, Alternative, Country, Classical, Jazz
- Chill, Sleep, Focus, Workout, Party
- (etc. - fetched from Spotify API)

### 4.3 Personalized Playlist Selection

Checkboxes:
- [ ] Discover Weekly
- [ ] Release Radar
- [ ] Daily Mix (all)
- [ ] On Repeat
- [ ] Repeat Rewind

### 4.4 Specific Playlist

- Text input for Spotify playlist URL/URI
- Validates format: `spotify:playlist:xxxxx` or `https://open.spotify.com/playlist/xxxxx`

### 4.5 Result Limit

Slider: 10, 25, 50, 100
Default: 50

---

## 5. Subscription Settings

### 5.1 Per-Subscription Settings

| Setting | Type | Options | Default |
|---------|------|---------|---------|
| Name | Text | Auto-generated or custom | Auto |
| Spotify Connection | Dropdown | List of authorized Spotify connections | Required |
| Schedule | Dropdown | Manual, Daily, Weekly, Monthly | Weekly |
| Result Handling | Radio | Preview Only, Auto-Add to Lidarr, Queue for Review | Preview Only |
| Active | Toggle | On/Off | On |

### 5.2 Result Handling Behaviors

Same as Last.fm:
1. **Preview Only:** Store results, display in UI, no automatic action
2. **Auto-Add to Lidarr:** Automatically add discovered albums/artists to Lidarr
3. **Queue for Review:** Store results in a review queue for manual approval
   - Review queue accessible via button/tab on subscription detail page

### 5.3 Duplicate Handling

- Skip silently and log at DEBUG level

---

## 6. Database Schema

Uses the unified subscription schema from the Last.fm Subscription spec. Key fields for Spotify:

```python
# source_service = 'spotify'
# source_type options for Spotify:
#   - 'spotify_new_releases'
#   - 'spotify_category' 
#   - 'spotify_featured'
#   - 'spotify_personalized'
#   - 'spotify_playlist' (specific public playlist by URL)

# Filter JSON structure for Spotify subscriptions:
{
    "source_type": "new_releases|category|featured|personalized|specific_playlist",
    "category_id": "pop",
    "personalized_types": ["discover_weekly", "release_radar", "daily_mix"],
    "playlist_id": "37i9dQZF1DXcBWIGoYBM5M",
    "playlist_url": "https://open.spotify.com/playlist/xxxxx"
}
```

### Data Retention

Same as Last.fm: Purge results older than 30 days.

### Filter JSON Schema

```python
SPOTIFY_FILTER_SCHEMAS = {
    'spotify_new_releases': {
        'required': [],
        'optional': ['limit'],
        'example': {'limit': 50}
    },
    'spotify_category': {
        'required': ['category_id'],
        'optional': ['limit'],
        'example': {'category_id': 'pop', 'limit': 50}
    },
    'spotify_featured': {
        'required': [],
        'optional': ['limit'],
        'example': {'limit': 50}
    },
    'spotify_personalized': {
        'required': ['personalized_types'],
        'optional': ['limit'],
        'example': {'personalized_types': ['discover_weekly', 'release_radar'], 'limit': 50}
    },
    'spotify_playlist': {
        'required': ['playlist_id'],
        'optional': ['limit'],
        'example': {'playlist_id': '37i9dQZF1DXcBWIGoYBM5M', 'limit': 50}
    },
}
```

---

## 7. API Endpoints

### 7.1 Subscription Management (Shared with Last.fm)

Uses the same endpoints as Last.fm subscriptions, scoped to connection:
- `GET /api/connections/<conn_id>/subscriptions`
- `POST /api/connections/<conn_id>/subscriptions`
- `GET/PUT/DELETE /api/connections/<conn_id>/subscriptions/<id>`
- `POST /api/connections/<conn_id>/subscriptions/<id>/run`

### 7.2 Spotify-Specific Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/spotify/<conn_id>/categories` | Get available Spotify categories |
| GET | `/api/spotify/<conn_id>/personalized-playlists` | Get user's personalized playlists (Discover Weekly, etc.) |
| POST | `/api/spotify/validate-playlist` | Validate a playlist URL/URI |

---

## 8. Required OAuth Scopes

The Spotify connection must have these scopes authorized:

```python
SPOTIFY_SCOPES = [
    'user-library-read',      # Read saved tracks/albums (for personalized)
    'user-follow-read',       # Read followed artists
    'playlist-read-private',  # Read private playlists
    'playlist-read-collaborative',  # Read collaborative playlists
]
```

### Scope Validation

- On subscription create/run, check if connection has required scopes
- If missing scopes, show warning with re-authorization instructions:
  ```
  "This subscription requires additional permissions. Please re-authorize 
   your Spotify connection to enable [feature]. Click here to re-authorize."
  ```
- Do not allow running subscription until scopes are granted

---

## 9. Implementation Plan

### Phase 1: Spotify Service Layer (4-5 hours)
1. Create `services/spotify_subscriptions.py`
2. Implement API wrapper methods for each endpoint
3. Add rate limiting (5 req/sec conservative limit)
4. Implement playlist track extraction logic

### Phase 2: UI Updates (3-4 hours)
1. Connection type determines available presets/filters
2. Create Spotify-specific preset buttons
3. Create Spotify-specific filter form
4. Add category dropdown (dynamically populated)
5. Add personalized playlist checkboxes

### Phase 3: Route Integration (2-3 hours)
1. Add Spotify-specific API routes
2. Update subscription create/update to handle Spotify sources
3. Integrate with subscription runner

### Phase 4: Testing (2-3 hours)
1. Test all presets
2. Test personalized content access
3. Test error handling (expired tokens, etc.)

**Total Estimated Time: 11-15 hours**

*Note: Database schema already created in Last.fm Subscriptions feature.*

---

## 10. Error Handling

| Scenario | Behavior |
|----------|----------|
| Token expired | Attempt refresh, if fails show warning with re-auth instructions |
| Rate limit (429) | Exponential backoff, retry |
| Playlist not found | Skip, log warning |
| Insufficient scopes | Show warning with re-authorization instructions |
| Duplicate album/artist | Skip silently, log at DEBUG level |

---

## 11. Rate Limiting

- Spotify API allows higher rate limits than Last.fm (~30 req/sec)
- Use conservative 5 req/sec for subscription processing
- Batch requests where possible (e.g., get multiple tracks at once)
- Stagger subscription runs (5 minute delay between jobs)

---

## 12. Personalized Playlist Detection

Spotify creates personalized playlists with specific naming patterns:

```python
PERSONALIZED_PLAYLISTS = {
    'discover_weekly': lambda name: 'discover weekly' in name.lower(),
    'release_radar': lambda name: 'release radar' in name.lower(),
    'daily_mix': lambda name: name.lower().startswith('daily mix'),
    'on_repeat': lambda name: name.lower() == 'on repeat',
    'repeat_rewind': lambda name: name.lower() == 'repeat rewind',
}

def find_personalized_playlists(user_playlists):
    """Filter user playlists to find Spotify-generated personalized ones."""
    result = {}
    for playlist in user_playlists:
        for key, matcher in PERSONALIZED_PLAYLISTS.items():
            if matcher(playlist['name']):
                if key not in result:
                    result[key] = []
                result[key].append(playlist)
    return result
```

---

## 13. Album Extraction from Playlists

```python
def extract_albums_from_playlist(spotify_client, playlist_id, limit=50):
    """
    Extract unique albums from a playlist's tracks.
    Returns list of album objects with artist info.
    """
    tracks = spotify_client.playlist_tracks(playlist_id, limit=100)
    albums = {}
    
    for item in tracks['items']:
        track = item.get('track')
        if track and track.get('album'):
            album = track['album']
            album_id = album['id']
            if album_id not in albums:
                albums[album_id] = {
                    'id': album_id,
                    'name': album['name'],
                    'artists': [a['name'] for a in album.get('artists', [])],
                    'release_date': album.get('release_date'),
                    'spotify_url': album['external_urls'].get('spotify'),
                    'type': album.get('album_type', 'album')
                }
    
    return list(albums.values())[:limit]
```

---

## 14. Lidarr Integration

Same as Last.fm subscriptions. All items are added to Lidarr as **artists**:

| Source Item Type | Lidarr Action |
|------------------|---------------|
| Album (from New Releases) | Look up artist from album → Add artist |
| Track (from Playlist) | Extract album → Look up artist from album → Add artist |

See Last.fm Subscription spec Section 14 for full Lidarr API details, including:
- Artist add payload
- Lookup flow
- Lidarr library caching for duplicate detection

---

## 15. Run Concurrency Control

Same as Last.fm subscriptions. See Last.fm Subscription spec Section 15 for:
- Run lock acquisition/release
- Stale lock detection (1 hour timeout)
- API response for concurrent run attempts (409 Conflict)
- UI running indicator

---

## 16. Edit Subscription Workflow

Same as Last.fm subscriptions. See Last.fm Subscription spec Section 16 for full workflow.

Key points:
- Connection cannot be changed after creation
- Source type change clears filters
- Schedule change updates scheduler job
