# Last.fm Subscriptions Feature Specification

## Overview

The Subscriptions feature enables automated discovery of artists and albums from Last.fm based on user-defined criteria. Users can create subscriptions to charts, genres, countries, and time periods, with results automatically processed according to their preferences.

**Key Dependency:** Subscriptions require a configured Last.fm connection. Each subscription must be associated with a specific Last.fm connection for API access.

**Scope Distinction:** This feature handles **discovery from external sources** (charts, tags, geo). For importing user's personal Spotify library (liked songs, playlists), see the separate **Spotify Import** feature.

**Delivery Expectation:** All presets, features, and functionality documented in this specification must be fully implemented, tested, and delivered without errors or bugs. No partial implementations or "MVP" subsets are acceptable.

---

## 1. User Interface Design

### 1.1 Navigation

- **New top-level nav item:** "Subscriptions" with icon `fa-bell` or `fa-rss`
- Position: After "Search", before "Logs"
- Subscriptions are scoped to a connection (each subscription belongs to one connection)

### 1.2 Page Layout (Two-Panel)

```
+------------------------------------------+
|  Subscriptions                           |
+------------------------------------------+
| [Left Panel: My Subscriptions]           |
| - List of user's subscriptions           |
| - Each shows: name, status, last run     |
| - Actions: Edit, Run Now, Delete, Toggle |
|                                          |
| [+ Create New Subscription] button       |
+------------------------------------------+
| [Right Panel: Recent Activity]           |
| - Last 10 subscription runs              |
| - Shows: subscription name, time, count  |
| - Quick stats: total discovered, added   |
+------------------------------------------+
```

### 1.3 Subscription Builder (Single Page with Sections)

**Section A: Quick Presets (Top)**
- Grid of canned subscription buttons
- Click to auto-populate the form below
- User can modify after selection

**Section B: Custom Builder (Below)**
- All filter options in one scrollable form
- Collapsible sections for organization

---

## 2. Canned Subscription Presets

### Tier 1: Direct Last.fm API

| Preset Name | API Endpoint | Parameters |
|-------------|--------------|------------|
| Global Top 50 Artists | `chart.getTopArtists` | limit=50 |
| Global Top 50 Tracks | `chart.getTopTracks` | limit=50 |
| Top Rock Artists | `tag.getTopArtists` | tag=rock, limit=50 |
| Top Hip-Hop Artists | `tag.getTopArtists` | tag=hip-hop, limit=50 |
| Top Electronic Artists | `tag.getTopArtists` | tag=electronic, limit=50 |
| Top Jazz Albums | `tag.getTopAlbums` | tag=jazz, limit=50 |
| Top Metal Artists | `tag.getTopArtists` | tag=metal, limit=50 |
| Top Indie Artists | `tag.getTopArtists` | tag=indie, limit=50 |
| Top Pop Artists | `tag.getTopArtists` | tag=pop, limit=50 |
| Top Classical Albums | `tag.getTopAlbums` | tag=classical, limit=50 |
| USA Top Artists | `geo.getTopArtists` | country=united states, limit=50 |
| UK Top Artists | `geo.getTopArtists` | country=united kingdom, limit=50 |
| Germany Top Artists | `geo.getTopArtists` | country=germany, limit=50 |
| Japan Top Artists | `geo.getTopArtists` | country=japan, limit=50 |

### Tier 2: MusicBrainz + Last.fm Combined

| Preset Name | Strategy |
|-------------|----------|
| New Releases (Last 30 Days) | MusicBrainz date query + Last.fm popularity enrichment |
| New Jazz Releases | MusicBrainz date+tag query |
| New Rock Releases | MusicBrainz date+tag query |
| New Electronic Releases | MusicBrainz date+tag query |
| New Hip-Hop Releases | MusicBrainz date+tag query |

**Tier 2 Query Strategy (Option C - Hybrid):**
1. Query MusicBrainz with date filter AND loose tag match: `firstreleasedate:[30 days ago TO *] AND tag:jazz`
2. Accept that MusicBrainz tags may have some false positives/negatives
3. Enrich each result with Last.fm data (listeners, playcount, tags) for display and sorting
4. Last.fm enrichment is for UI display only, not additional filtering

### Tier 3: Computed/Constructed (Phase 2)

*These presets require historical tracking and will be implemented in Phase 2.*

| Preset Name | Strategy | Data Requirements |
|-------------|----------|-------------------|
| Rising Artists | Track week-over-week chart position changes | `chart_history` table |
| Genre Crossover | Artists appearing in multiple genre charts | Cross-reference multiple tag queries |
| Regional Breakout | Artists trending in specific countries | Historical geo data |

**Phase 2 Implementation Notes:**
- Requires new `chart_history` table to store periodic snapshots
- Background job to capture chart data weekly
- Computed presets analyze historical data vs current data

---

## 3. Filter Options (Custom Builder)

### 3.1 Source Selection
- **Source Type:** Radio buttons
  - Last.fm Charts
  - Last.fm Tags/Genres
  - Last.fm Geographic
  - MusicBrainz New Releases
  - Combined (MusicBrainz + Last.fm)

### 3.2 Genre/Tag Filters
- **Multi-select dropdown** with search
- Allow multiple selections
- Available tags organized by category:

**Mainstream Genres:**
rock, pop, electronic, hip-hop, jazz, classical, metal, punk, indie, r&b, soul, folk, country, blues, reggae, latin

**Rock Subgenres:**
hard rock, progressive rock, alternative rock, indie rock, post-punk, new wave, grunge, psychedelic rock

**Electronic Subgenres:**
synthpop, house, techno, drum and bass, dubstep, ambient, trance, edm

**Jazz Subgenres:**
bebop, cool jazz, acid jazz, hard bop, free jazz, smooth jazz, fusion

**Metal Subgenres:**
death metal, black metal, thrash metal, progressive metal, doom metal, power metal

**Decades:**
60s, 70s, 80s, 90s, 00s, 2010s, 2020s

**Moods:**
chill, mellow, energetic, romantic, sad, happy, party, workout

### 3.3 Country Filter
- **Dropdown** with search
- ISO country names for geo.* endpoints
- Common selections: United States, United Kingdom, Germany, France, Japan, Australia, Canada, Brazil, Mexico, Spain, Italy, Sweden, Netherlands

### 3.4 Time Period Filter (for MusicBrainz)
- **Preset buttons:** Last 7 days, Last 30 days, Last 90 days, Last year
- **Custom range:** Date pickers for start/end

### 3.5 Result Limit
- **Slider or dropdown:** 10, 25, 50, 100, 200
- Default: 50

---

## 4. Subscription Settings

### 4.1 Per-Subscription Settings

| Setting | Type | Options | Default |
|---------|------|---------|---------|
| Name | Text | Auto-generated or custom | Auto |
| Last.fm Connection | Dropdown | List of configured Last.fm connections | Required |
| Schedule | Dropdown | Manual, Daily, Weekly, Monthly | Weekly |
| Result Handling | Radio | Preview Only, Auto-Add to Lidarr, Queue for Review | Preview Only |
| Active | Toggle | On/Off | On |

### 4.2 Result Handling Behaviors

1. **Preview Only:** Store results, display in UI, no automatic action
2. **Auto-Add to Lidarr:** Automatically add discovered artists to Lidarr
3. **Queue for Review:** Store results in a review queue for manual approval
   - Review queue accessible via button/tab on subscription detail page
   - User can approve/reject individual items or bulk actions

### 4.3 Duplicate Handling
- Skip silently and log at DEBUG level
- Check against existing Lidarr library before processing

### 4.4 Auto-Generated Names
Format: `{Source} - {Filters} - {Date}`
Examples:
- "Last.fm Charts - Global Top Artists"
- "Tags - Rock, Metal - Top Artists"
- "MusicBrainz - New Jazz Releases - Last 30 Days"
- "Geo - USA Top Artists"

---

## 5. Database Schema

### 5.1 New Tables

```sql
-- Subscription definitions
CREATE TABLE subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL,
    connection_id INTEGER NOT NULL,  -- FK to connections (Last.fm or Spotify connection)
    
    -- Source configuration
    source_service VARCHAR(20) NOT NULL DEFAULT 'lastfm',  -- 'lastfm' or 'spotify'
    source_type VARCHAR(50) NOT NULL,  -- 'lastfm_chart', 'lastfm_tag', 'lastfm_geo', 'musicbrainz', 'combined', 'spotify_new_releases', 'spotify_category', 'spotify_featured', 'spotify_playlist'
    api_endpoint VARCHAR(100),  -- e.g., 'chart.getTopArtists', 'tag.getTopAlbums'
    
    -- Filter criteria (JSON for flexibility)
    filters JSON,  -- {"tags": ["rock", "metal"], "country": "united states", "date_range": {...}, "playlist_id": "xxx"}
    
    -- Settings
    result_limit INTEGER DEFAULT 50,
    result_handling VARCHAR(50) DEFAULT 'preview',  -- 'preview', 'auto_add', 'queue_review'
    schedule VARCHAR(20) DEFAULT 'weekly',  -- 'manual', 'daily', 'weekly', 'monthly'
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    last_run DATETIME,
    last_run_status VARCHAR(255),
    last_run_count INTEGER,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);

-- Subscription run history
CREATE TABLE subscription_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50),  -- 'success', 'partial', 'failed'
    results_count INTEGER,
    added_count INTEGER,
    skipped_count INTEGER,
    error_message TEXT,
    
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Discovered items (results from subscription runs)
CREATE TABLE subscription_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id INTEGER NOT NULL,
    run_id INTEGER NOT NULL,
    
    -- Item details
    item_type VARCHAR(20),  -- 'artist', 'album'
    name VARCHAR(255) NOT NULL,
    artist_name VARCHAR(255),  -- For albums, the primary artist
    mbid VARCHAR(36),  -- MusicBrainz ID if available
    spotify_id VARCHAR(100),  -- Spotify ID if from Spotify source
    
    -- Enrichment data (from Last.fm or Spotify)
    source_url VARCHAR(500),  -- Last.fm or Spotify URL
    listeners INTEGER,
    playcount INTEGER,
    tags TEXT,  -- Comma-separated
    image_url VARCHAR(500),
    
    -- Processing status
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'added', 'skipped', 'exists', 'failed', 'rejected'
    processed_at DATETIME,
    error_message TEXT,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES subscription_runs(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_subscriptions_connection ON subscriptions(connection_id);
CREATE INDEX idx_subscriptions_active ON subscriptions(is_active);
CREATE INDEX idx_subscriptions_service ON subscriptions(source_service);
CREATE INDEX idx_subscription_runs_subscription ON subscription_runs(subscription_id);
CREATE INDEX idx_subscription_runs_date ON subscription_runs(run_at);
CREATE INDEX idx_subscription_results_subscription ON subscription_results(subscription_id);
CREATE INDEX idx_subscription_results_status ON subscription_results(status);
CREATE INDEX idx_subscription_results_created ON subscription_results(created_at);
```

### 5.2 Data Retention Policy

- **Subscription results:** Purge after 30 days
- **Subscription runs:** Keep last 30 days
- Background job runs daily to clean old records:
```sql
DELETE FROM subscription_results WHERE created_at < datetime('now', '-30 days');
DELETE FROM subscription_runs WHERE run_at < datetime('now', '-30 days');
```

### 5.3 Filter JSON Schema Validation

The `filters` JSON column must be validated before save. Each source type has a defined schema:

```python
FILTER_SCHEMAS = {
    'lastfm_chart': {
        'required': [],
        'optional': ['limit'],
        'example': {'limit': 50}
    },
    'lastfm_tag': {
        'required': ['tags'],
        'optional': ['limit'],
        'example': {'tags': ['rock', 'metal'], 'limit': 50}
    },
    'lastfm_geo': {
        'required': ['country'],
        'optional': ['limit'],
        'example': {'country': 'united states', 'limit': 50}
    },
    'musicbrainz': {
        'required': ['date_range'],
        'optional': ['tags', 'limit'],
        'example': {'date_range': {'days': 30}, 'tags': ['jazz'], 'limit': 50}
    },
    'combined': {
        'required': ['date_range'],
        'optional': ['tags', 'limit'],
        'example': {'date_range': {'days': 30}, 'tags': ['rock'], 'limit': 50}
    },
}

def validate_filters(source_type, filters):
    """Validate filters JSON against schema. Raises ValueError if invalid."""
    schema = FILTER_SCHEMAS.get(source_type)
    if not schema:
        raise ValueError(f"Unknown source_type: {source_type}")
    
    for required_key in schema['required']:
        if required_key not in filters:
            raise ValueError(f"Missing required filter: {required_key}")
    
    allowed_keys = set(schema['required'] + schema['optional'])
    for key in filters:
        if key not in allowed_keys:
            raise ValueError(f"Unknown filter key: {key}")
    
    return True
```

---

## 6. API Endpoints

All subscription endpoints are scoped to a connection.

### 6.1 Subscription Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/subscriptions` | Subscriptions page (HTML) |
| GET | `/api/connections/<conn_id>/subscriptions` | Get subscriptions for connection (JSON) |
| POST | `/api/connections/<conn_id>/subscriptions` | Create new subscription |
| GET | `/api/connections/<conn_id>/subscriptions/<id>` | Get subscription details |
| PUT | `/api/connections/<conn_id>/subscriptions/<id>` | Update subscription |
| DELETE | `/api/connections/<conn_id>/subscriptions/<id>` | Delete subscription |
| POST | `/api/connections/<conn_id>/subscriptions/<id>/run` | Run subscription now |
| POST | `/api/connections/<conn_id>/subscriptions/<id>/toggle` | Toggle active status |

### 6.2 Results & Preview

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/connections/<conn_id>/subscriptions/<id>/results` | Get subscription results |
| GET | `/api/connections/<conn_id>/subscriptions/<id>/queue` | Get review queue items |
| POST | `/api/connections/<conn_id>/subscriptions/<id>/preview` | Preview subscription (dry run) |
| POST | `/api/subscriptions/results/<id>/add` | Add single result to Lidarr |
| POST | `/api/subscriptions/results/<id>/reject` | Reject/skip a queued result |
| POST | `/api/connections/<conn_id>/subscriptions/<id>/results/add-all` | Add all pending results |

### 6.3 Presets & Options

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/subscriptions/presets` | Get canned presets |
| GET | `/api/subscriptions/tags` | Get available tags/genres |
| GET | `/api/subscriptions/countries` | Get available countries |

---

## 7. Implementation Plan

### Phase 1: Foundation (4-6 hours)
1. Create database models (`models/models.py`)
2. Add database migration
3. Create subscription service (`services/subscriptions.py`)
4. Add nav item to `base.html`

### Phase 2: Core UI (4-6 hours)
1. Create `templates/subscriptions.html`
2. Create `static/js/subscriptions.js`
3. Implement subscription list panel
4. Implement activity panel

### Phase 3: Subscription Builder (4-6 hours)
1. Implement preset grid
2. Implement custom builder form
3. Add filter dropdowns (tags, countries)
4. Implement name auto-generation

### Phase 4: API Integration (6-8 hours)
1. Implement Last.fm API calls in service
2. Implement MusicBrainz date queries
3. Implement combined approach
4. Add rate limiting (1 req/sec)

### Phase 5: Scheduler Integration (2-3 hours)
1. Add subscription jobs to scheduler
2. Implement run history tracking
3. Add logging

### Phase 6: Result Handling (4-5 hours)
1. Implement preview display (first 50 results)
2. Implement auto-add to Lidarr
3. Implement queue for review
4. Add duplicate detection

### Phase 7: Testing & Polish (2-3 hours)
1. Test all presets
2. Test scheduler
3. Error handling
4. UI polish

**Total Estimated Time: 26-37 hours**

---

## 8. File Structure

```
routes/
  routes.py          # Add subscription routes
  
services/
  subscriptions.py   # NEW: Subscription service
  musicbrainz.py     # Extend for date queries
  
templates/
  subscriptions.html # NEW: Main subscriptions page
  base.html          # Add nav item
  
static/
  js/
    subscriptions.js # NEW: Subscriptions JavaScript
  css/
    style.css        # Add subscription styles

models/
  models.py          # Add Subscription, SubscriptionRun, SubscriptionResult models
```

---

## 9. Rate Limiting Architecture

### 9.1 Service-Level Rate Limits

Centralized rate limiter enforces per-service limits across all subscriptions:

```python
import time
import threading

class RateLimiter:
    """Thread-safe rate limiter for external API calls."""
    
    _instances = {}
    _lock = threading.Lock()
    
    LIMITS = {
        'lastfm': 1.0,       # 1 request per second
        'musicbrainz': 1.0,  # 1 request per second
        'spotify': 0.2,      # 5 requests per second
        'lidarr': 0.1,       # 10 requests per second (local)
    }
    
    def __init__(self, service):
        self.service = service
        self.min_interval = self.LIMITS.get(service, 1.0)
        self.last_request = 0
        self._lock = threading.Lock()
    
    @classmethod
    def get(cls, service):
        """Get or create rate limiter for service."""
        with cls._lock:
            if service not in cls._instances:
                cls._instances[service] = cls(service)
            return cls._instances[service]
    
    def wait(self):
        """Wait if necessary to respect rate limit."""
        with self._lock:
            now = time.time()
            elapsed = now - self.last_request
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)
            self.last_request = time.time()

# Usage:
RateLimiter.get('lastfm').wait()
response = lastfm_api.call(...)
```

### 9.2 Scheduler Staggering

- Subscription jobs are staggered with 5-minute delays
- When multiple subscriptions are scheduled for the same time, they queue sequentially
- Prevents API overload when user has many subscriptions

---

## 10. Error Handling

| Scenario | Behavior |
|----------|----------|
| API rate limit exceeded | Retry with exponential backoff, log warning |
| API timeout | Retry up to 3 times, mark run as partial |
| Invalid connection | Skip subscription, log error, show warning to user |
| Duplicate artist | Skip silently, log at DEBUG level |
| Lidarr unreachable | Queue results for later, mark run as partial |
| Missing Last.fm connection | Show warning on subscription with instructions to fix |
| Insufficient OAuth scopes | Show warning with re-authorization instructions |

---

## 11. UI Component Details

### 11.1 Subscription Card (List Item)
```
+------------------------------------------+
| [Icon] Subscription Name           [Toggle]
| Source: Last.fm Charts | Schedule: Weekly
| Last Run: 2 hours ago | Found: 47 artists
| [Edit] [Run Now] [Delete]
+------------------------------------------+
```

### 11.2 Result Preview Table
| Artist/Album | Listeners | Playcount | Tags | Status | Action |
|--------------|-----------|-----------|------|--------|--------|
| Artist Name  | 1.2M      | 45M       | rock | Pending | [Add] |

Limited to first 50 results with "Load More" or pagination.

### 11.3 Review Queue (Modal/Tab)

Accessible from subscription detail page via "Review Queue" button:
```
+------------------------------------------+
| Review Queue - [Subscription Name]       |
+------------------------------------------+
| 23 items pending review                  |
+------------------------------------------+
| [x] Artist Name 1    | rock | [Approve] [Reject]
| [x] Artist Name 2    | jazz | [Approve] [Reject]
| ...
+------------------------------------------+
| [Approve Selected] [Reject Selected]     |
+------------------------------------------+
```

---

## 12. Validation Rules

- Name: Required, max 255 chars
- Connection: Required, must be valid Last.fm connection
- Source Type: Required
- At least one filter must be selected
- No contradictory filters (handled by UI disabling invalid combinations)
- Result limit: 1-200

---

## 13. Success Metrics

- Subscriptions created and active
- Successful subscription runs
- Artists discovered and added
- API error rate
- User engagement with preview results

---

## 14. Lidarr Integration

### 14.1 Add Logic

All items are ultimately added to Lidarr as **artists** via `POST /api/v1/artist`:

| Source Item Type | Lidarr Action |
|------------------|---------------|
| Artist | Add artist directly |
| Album | Look up artist from album → Add artist |
| Track/Song | Extract album from track → Look up artist from album → Add artist |

### 14.2 Artist Add Payload

```python
add_data = {
    "artistName": canonical_artist_name,
    "foreignArtistId": mbid,  # MusicBrainz Artist ID
    "monitored": True,
    "rootFolderPath": connection.lidarr_root_folder,
    "qualityProfileId": connection.lidarr_quality_profile_id,
    "metadataProfileId": connection.lidarr_metadata_profile_id,
    "addOptions": {
        "monitor": connection.lidarr_monitoring_option,  # 'all', 'future', 'missing', etc.
        "searchForMissingAlbums": True
    }
}
```

### 14.3 Lookup Flow

1. Search Lidarr/MusicBrainz: `GET /api/v1/artist/lookup?term={name}`
2. Get `foreignArtistId` (MBID) from search results
3. Add artist with MBID: `POST /api/v1/artist`

### 14.4 Lidarr Library Caching

To efficiently detect duplicates, cache the existing Lidarr library at the start of each subscription run:

```python
def get_lidarr_artist_cache(connection):
    """
    Fetch all artists from Lidarr and build lookup sets.
    Called once at start of subscription run, not per-artist.
    """
    response = requests.get(
        f"{connection.lidarr_url}/api/v1/artist",
        headers={'X-Api-Key': connection.lidarr_api_key},
        timeout=30
    )
    response.raise_for_status()
    artists = response.json()
    
    return {
        'mbids': {a['foreignArtistId'] for a in artists if a.get('foreignArtistId')},
        'names': {a['artistName'].lower() for a in artists if a.get('artistName')},
        'count': len(artists)
    }

def is_artist_in_lidarr(cache, mbid=None, name=None):
    """Check if artist exists using cached data."""
    if mbid and mbid in cache['mbids']:
        return True
    if name and name.lower() in cache['names']:
        return True
    return False
```

**Performance:** Single API call per run instead of N calls for N results. For a subscription returning 50 artists, this is ~50x faster.

---

## 15. Run Concurrency Control

### 15.1 Preventing Duplicate Runs

Each subscription tracks running state to prevent concurrent executions:

```python
# In Subscription model
is_running = db.Column(db.Boolean, default=False)
run_started_at = db.Column(db.DateTime, nullable=True)

def acquire_run_lock(subscription):
    """Attempt to acquire run lock. Returns False if already running."""
    # Check for stale lock (crashed run) - 1 hour timeout
    if subscription.is_running:
        if subscription.run_started_at:
            stale_threshold = datetime.utcnow() - timedelta(hours=1)
            if subscription.run_started_at < stale_threshold:
                # Stale lock, allow override
                add_log(f"Clearing stale lock for subscription {subscription.id}", level='WARNING')
            else:
                return False  # Legitimately running
    
    subscription.is_running = True
    subscription.run_started_at = datetime.utcnow()
    db.session.commit()
    return True

def release_run_lock(subscription):
    """Release run lock after completion."""
    subscription.is_running = False
    subscription.run_started_at = None
    db.session.commit()
```

### 15.2 API Response for Concurrent Run Attempt

```python
@bp.route('/api/connections/<conn_id>/subscriptions/<id>/run', methods=['POST'])
def run_subscription(conn_id, id):
    subscription = Subscription.query.get_or_404(id)
    
    if not acquire_run_lock(subscription):
        return jsonify({
            'error': 'Subscription is already running',
            'started_at': subscription.run_started_at.isoformat()
        }), 409  # Conflict
    
    try:
        result = execute_subscription_run(subscription)
        return jsonify(result), 200
    finally:
        release_run_lock(subscription)
```

### 15.3 UI Indication

- Show "Running..." indicator on subscription card when `is_running=True`
- Disable "Run Now" button while running
- Show spinner or progress indicator

---

## 16. Edit Subscription Workflow

### 16.1 Edit Flow

1. User clicks "Edit" on subscription card
2. Opens same form as "Create" but pre-populated with existing values
3. User modifies settings
4. On save:
   - Update subscription record
   - If filters changed significantly, optionally clear old results
   - If schedule changed, update scheduler job

### 16.2 Editable Fields

| Field | Editable | Notes |
|-------|----------|-------|
| Name | Yes | |
| Connection | **No** | Cannot change connection after creation |
| Source Type | Yes | Changing clears filters |
| Filters | Yes | |
| Result Limit | Yes | |
| Result Handling | Yes | |
| Schedule | Yes | Updates scheduler |
| Active | Yes | Via toggle |

### 16.3 Edit API

`PUT /api/connections/<conn_id>/subscriptions/<id>`

Request body: Same as create, but `connection_id` is immutable.

### 16.4 UI Behavior

- "Edit" button on subscription card opens modal or navigates to edit page
- Form validation same as create
- "Save" button submits changes
- "Cancel" discards changes
- Success: Flash message, return to subscription list
- Error: Show validation errors inline
