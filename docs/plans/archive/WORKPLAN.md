# Implementation Workplan

## Overview

This workplan sequences the implementation of three major features:
1. **Last.fm Subscriptions** - Discovery from Last.fm charts/tags/geo
2. **Spotify Subscriptions** - Discovery from Spotify playlists/new releases  
3. **Spotify Import** - Import user's personal Spotify library

**Pre-requisite:** Code extraction and harmonization to prepare existing codebase for new features.

## Dependencies & Sequencing

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PHASE 0A: CODE EXTRACTION & CLEANUP                  │
│                           (Estimated: 2-3 hours)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  0A.1 Extract Lidarr Service from routes.py                            │
│  0A.2 Extract Spotify Client Factory from routes.py                    │
│  0A.3 Extract Scheduler Utilities from routes.py                       │
│  0A.4 Add updated_at to Connection Model                               │
│  0A.5 Centralize Rate Limiter (extract from MusicBrainz)               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PHASE 0B: SHARED INFRASTRUCTURE                      │
│                           (Estimated: 6-8 hours)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  0B.1 Extend Rate Limiter for all services                             │
│  0B.2 Lidarr Cache Service (uses extracted Lidarr service)             │
│  0B.3 Unified Subscription Schema Migration                            │
│  0B.4 Base Scheduler Infrastructure (extends extracted utilities)      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│     PHASE 1: LAST.FM SUBS         │ │     PHASE 2: SPOTIFY SUBS         │
│     (Estimated: 26-37 hours)      │ │     (Estimated: 11-15 hours)      │
├───────────────────────────────────┤ ├───────────────────────────────────┤
│ 1.1 Last.fm API Service           │ │ 2.1 Spotify Subscription Service  │
│ 1.2 MusicBrainz Query Builder     │ │ 2.2 Preset Configuration          │
│ 1.3 Subscription Models           │ │ 2.3 Album Extraction Logic        │
│ 1.4 Preset Definitions            │ │ 2.4 Scheduler Integration         │
│ 1.5 Subscription Routes           │ │ 2.5 UI Integration                │
│ 1.6 Subscription UI               │ │                                   │
│ 1.7 Custom Builder UI             │ │                                   │
│ 1.8 Scheduler Integration         │ │                                   │
│ 1.9 Run History & Logging         │ │                                   │
└───────────────────────────────────┘ └───────────────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       PHASE 3: SPOTIFY IMPORT                           │
│                         (Estimated: 15-21 hours)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  3.1 Import Source Models                                               │
│  3.2 Import Service (Liked Songs, Albums, Artists, Playlists)           │
│  3.3 Import Routes                                                      │
│  3.4 Import UI                                                          │
│  3.5 Review Queue                                                       │
│  3.6 Scheduler Integration                                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       PHASE 4: TESTING & POLISH                         │
│                         (Estimated: 8-12 hours)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  4.1 Integration Testing                                                │
│  4.2 Error Handling Validation                                          │
│  4.3 UI Polish & Edge Cases                                             │
│  4.4 Documentation Updates                                              │
└─────────────────────────────────────────────────────────────────────────┘

Total Estimated: 70-99 hours (includes 2-3 hours for Phase 0A)
```

---

## Phase 0A: Code Extraction & Cleanup

**Purpose:** Extract reusable components from `routes/routes.py` into dedicated service modules. This reduces the 2200+ line routes file, eliminates future circular import issues, and prepares the codebase for the new subscription/import features.

**Approach:** Additive refactoring - create new service files, move functions, update imports in routes.py. Existing functionality unchanged.

---

### 0A.1 Extract Lidarr Service
**Source:** `routes/routes.py` lines 421-530, 663-674
**Target:** `services/lidarr.py`
**Time:** 30 minutes

#### Functions to Extract

| Function | Current Location | Purpose |
|----------|------------------|---------|
| `_lookup_artist_in_lidarr()` | routes.py:421 | Search Lidarr for artist by name/MBID |
| `_add_artist_to_lidarr()` | routes.py:450 | Add artist to Lidarr with full payload |
| `get_lidarr_artists()` | routes.py:663 | Fetch all artists from Lidarr library |
| `normalize_artist_name()` | routes.py:83 | Normalize names for matching |

#### New File Structure

```python
# services/lidarr.py
"""
Lidarr API service for artist management.
Extracted from routes.py for reuse across subscription and import features.
"""
import time
import json
import requests
from typing import Optional, Tuple, Set, Dict, Any

from models.models import db, Connection


def normalize_artist_name(name: str) -> str:
    """
    Normalize artist name for comparison.
    Removes 'The ' prefix and lowercases.
    
    Args:
        name: Artist name to normalize
        
    Returns:
        Normalized name string
    """
    if not name:
        return ""
    return name.lower().replace("the ", "").strip()


def lookup_artist(connection: Connection, artist_name: str = None, 
                  mbid: str = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Search Lidarr for an artist by name or MusicBrainz ID.
    
    Args:
        connection: Connection object with Lidarr credentials
        artist_name: Artist name to search for
        mbid: MusicBrainz artist ID (preferred if available)
        
    Returns:
        Tuple of (artist_data dict, error_message)
        On success: (artist_data, None)
        On failure: (None, error_message)
    """
    # Implementation moved from _lookup_artist_in_lidarr
    ...


def add_artist(connection: Connection, artist_name: str, 
               mbid: str = None) -> Tuple[bool, str]:
    """
    Add an artist to Lidarr.
    
    First looks up the artist to get metadata, then constructs
    the add payload with connection-specific settings.
    
    Args:
        connection: Connection object with Lidarr credentials
        artist_name: Artist name to add
        mbid: MusicBrainz artist ID (optional, improves accuracy)
        
    Returns:
        Tuple of (success: bool, message: str)
    """
    # Implementation moved from _add_artist_to_lidarr
    ...


def get_all_artists(connection: Connection) -> Set[str]:
    """
    Fetch all artist names from Lidarr library.
    
    Args:
        connection: Connection object with Lidarr credentials
        
    Returns:
        Set of normalized artist names
    """
    # Implementation moved from get_lidarr_artists
    ...


def get_all_artists_detailed(connection: Connection) -> Dict[str, Any]:
    """
    Fetch all artists with full metadata from Lidarr.
    Used by LidarrCache for comprehensive duplicate checking.
    
    Args:
        connection: Connection object with Lidarr credentials
        
    Returns:
        Dict with 'artists' list and 'mbids' set
    """
    try:
        headers = {'X-Api-Key': connection.lidarr_api_key}
        response = requests.get(
            f"{connection.lidarr_url}/api/v1/artist",
            headers=headers,
            timeout=30
        )
        response.raise_for_status()
        artists = response.json()
        
        return {
            'artists': artists,
            'mbids': {a.get('foreignArtistId') for a in artists if a.get('foreignArtistId')},
            'names': {normalize_artist_name(a.get('artistName', '')) for a in artists}
        }
    except requests.exceptions.RequestException as e:
        return {'artists': [], 'mbids': set(), 'names': set(), 'error': str(e)}
```

#### Migration Steps

1. Create `services/lidarr.py` with all functions
2. Add logging integration (use existing `add_log` or create service-level logger)
3. Update `routes/routes.py` imports:
   ```python
   from services.lidarr import (
       normalize_artist_name,
       lookup_artist,
       add_artist,
       get_all_artists
   )
   ```
4. Replace internal function calls with service calls
5. Remove original functions from routes.py
6. Run existing functionality to verify no regression

#### Verification

- [ ] `run_spotify_scraper()` still adds artists correctly
- [ ] `run_lastfm_scraper()` still adds artists correctly
- [ ] Manual "Add Artist" from search still works
- [ ] No import errors on app startup

---

### 0A.2 Extract Spotify Client Factory
**Source:** `routes/routes.py` lines 44-80, 155-180
**Target:** `services/spotify.py`
**Time:** 15 minutes

#### Classes/Functions to Extract

| Item | Current Location | Purpose |
|------|------------------|---------|
| `DatabaseCacheHandler` | routes.py:44 | Spotipy cache handler storing tokens in DB |
| `_get_spotify_client()` | routes.py:155 | Factory to create authenticated Spotipy client |
| `get_spotify_oauth()` | routes.py:401 | Create SpotifyOAuth object for authorization |

#### New File Structure

```python
# services/spotify.py
"""
Spotify API service and client factory.
Handles OAuth token management and client creation.
"""
import time
from typing import Optional, Tuple

import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.cache_handler import CacheHandler

from models.models import db, Connection


# OAuth scopes required for different features
SCOPES = {
    'basic': 'user-library-read user-follow-read',
    'import': 'user-library-read user-follow-read playlist-read-private playlist-read-collaborative',
    'subscription': 'playlist-read-private playlist-read-collaborative',
}


class DatabaseCacheHandler(CacheHandler):
    """
    Spotipy cache handler that stores OAuth tokens in the database.
    
    Tokens are linked to a specific connection, allowing multiple
    Spotify accounts to be managed simultaneously.
    """
    
    def __init__(self, connection_id: int):
        """
        Initialize cache handler for a connection.
        
        Args:
            connection_id: Database ID of the connection
        """
        self.connection_id = connection_id

    def get_cached_token(self) -> Optional[dict]:
        """Retrieve token from database."""
        conn = db.session.get(Connection, self.connection_id)
        if conn and conn.spotify_access_token:
            token_info = {
                'access_token': conn.spotify_access_token,
                'refresh_token': conn.spotify_refresh_token,
                'expires_at': conn.spotify_token_expires_at,
                'token_type': 'Bearer',
                'scope': SCOPES['import']  # Use full scope set
            }
            if token_info['access_token'] and token_info['refresh_token']:
                return token_info
        return None

    def save_token_to_cache(self, token_info: dict) -> None:
        """Save token to database."""
        conn = db.session.get(Connection, self.connection_id)
        if conn:
            conn.spotify_access_token = token_info.get('access_token')
            conn.spotify_refresh_token = token_info.get('refresh_token')
            conn.spotify_token_expires_at = token_info.get('expires_at')
            conn.is_spotify_authorized = True
            db.session.commit()


def get_client(connection_id: int) -> Tuple[Optional[spotipy.Spotify], Optional[str]]:
    """
    Create an authenticated Spotify client for a connection.
    
    Handles token refresh automatically via Spotipy's built-in mechanism.
    
    Args:
        connection_id: Database ID of the connection
        
    Returns:
        Tuple of (Spotify client, error message)
        On success: (client, None)
        On failure: (None, error_message)
    """
    conn = db.session.get(Connection, connection_id)
    if not conn:
        return None, "Connection not found"
    
    if not conn.spotify_client_id or not conn.spotify_client_secret:
        return None, "Spotify credentials not configured"
    
    if not conn.is_spotify_authorized:
        return None, "Spotify not authorized"
    
    try:
        cache_handler = DatabaseCacheHandler(connection_id)
        auth_manager = SpotifyOAuth(
            client_id=conn.spotify_client_id,
            client_secret=conn.spotify_client_secret,
            redirect_uri="http://localhost:5000/callback",  # Will be updated
            scope=SCOPES['import'],
            cache_handler=cache_handler
        )
        
        # Force token refresh if needed
        token_info = cache_handler.get_cached_token()
        if token_info and auth_manager.is_token_expired(token_info):
            token_info = auth_manager.refresh_access_token(token_info['refresh_token'])
            cache_handler.save_token_to_cache(token_info)
        
        client = spotipy.Spotify(auth_manager=auth_manager)
        # Verify client works
        client.current_user()
        return client, None
        
    except Exception as e:
        return None, f"Spotify client error: {str(e)}"


def get_oauth(connection_id: int, redirect_uri: str = None) -> Optional[SpotifyOAuth]:
    """
    Create SpotifyOAuth object for authorization flow.
    
    Args:
        connection_id: Database ID of the connection
        redirect_uri: OAuth redirect URI (defaults to localhost)
        
    Returns:
        SpotifyOAuth object or None if connection invalid
    """
    conn = db.session.get(Connection, connection_id)
    if not conn or not conn.spotify_client_id:
        return None
    
    return SpotifyOAuth(
        client_id=conn.spotify_client_id,
        client_secret=conn.spotify_client_secret,
        redirect_uri=redirect_uri or "http://localhost:5000/callback",
        scope=SCOPES['import'],
        cache_handler=DatabaseCacheHandler(connection_id)
    )


def check_scopes(connection_id: int, required_scopes: list) -> Tuple[bool, list]:
    """
    Check if connection has required OAuth scopes.
    
    Args:
        connection_id: Database ID of the connection
        required_scopes: List of scope strings to check
        
    Returns:
        Tuple of (all_present: bool, missing_scopes: list)
    """
    conn = db.session.get(Connection, connection_id)
    if not conn or not conn.spotify_access_token:
        return False, required_scopes
    
    # Token scope is stored during authorization
    # For now, assume if authorized, scopes are present
    # Full implementation would decode token or store scopes in DB
    return True, []
```

#### Migration Steps

1. Create `services/spotify.py` with all components
2. Update `routes/routes.py` imports:
   ```python
   from services.spotify import (
       DatabaseCacheHandler,
       get_client as get_spotify_client,
       get_oauth as get_spotify_oauth,
       SCOPES as SPOTIFY_SCOPES
   )
   ```
3. Replace internal calls with service calls
4. Remove original class/functions from routes.py
5. Verify OAuth flow still works

#### Verification

- [ ] Spotify OAuth authorization flow works
- [ ] Token refresh works when expired
- [ ] `run_spotify_scraper()` still works
- [ ] No import errors on app startup

---

### 0A.3 Extract Scheduler Utilities
**Source:** `routes/routes.py` lines 182-294
**Target:** `services/scheduler.py`
**Time:** 20 minutes

#### Functions to Extract

| Function | Current Location | Purpose |
|----------|------------------|---------|
| `schedule_existing_jobs()` | routes.py:182 | Load all active connections and schedule jobs |
| `add_scheduled_job()` | routes.py:212 | Add a new scheduled job for a connection |
| `remove_scheduled_job()` | routes.py:241 | Remove a scheduled job |
| `update_scheduled_job()` | routes.py:259 | Update job schedule |
| `update_connection_schedule()` | routes.py:284 | Helper to update connection's schedule |

#### New File Structure

```python
# services/scheduler.py
"""
APScheduler utilities for connection and subscription scheduling.
"""
import logging
from datetime import datetime, timedelta
from typing import Optional, Callable

from flask import current_app
from flask_apscheduler import APScheduler

from models.models import db, Connection

logger = logging.getLogger(__name__)


# Schedule string to cron mapping
SCHEDULE_MAP = {
    'hourly': {'hour': '*'},
    'daily': {'hour': '3'},  # 3 AM
    'weekly': {'day_of_week': 'sun', 'hour': '3'},
    'monthly': {'day': '1', 'hour': '3'},
}


def get_scheduler() -> APScheduler:
    """Get the APScheduler instance from Flask app."""
    return current_app.scheduler


def schedule_existing_jobs() -> int:
    """
    Load all active connections and schedule their jobs.
    Called on app startup.
    
    Returns:
        Number of jobs scheduled
    """
    scheduler = get_scheduler()
    connections = Connection.query.filter_by(is_active=True).all()
    count = 0
    
    for conn in connections:
        if conn.schedule and conn.schedule != 'manual':
            job_id = f"connection_{conn.id}"
            if not scheduler.get_job(job_id):
                add_job_for_connection(conn.id, conn.schedule)
                count += 1
    
    logger.info(f"Scheduled {count} existing connection jobs")
    return count


def add_job_for_connection(connection_id: int, schedule: str) -> bool:
    """
    Add a scheduled job for a connection.
    
    Args:
        connection_id: Database ID of the connection
        schedule: Schedule string (hourly, daily, weekly, monthly, manual)
        
    Returns:
        True if job was added, False if manual or error
    """
    if schedule == 'manual':
        return False
    
    scheduler = get_scheduler()
    job_id = f"connection_{connection_id}"
    
    # Remove existing job if present
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    
    cron_args = SCHEDULE_MAP.get(schedule)
    if not cron_args:
        logger.error(f"Unknown schedule: {schedule}")
        return False
    
    scheduler.add_job(
        id=job_id,
        func='routes.routes:run_scraper',
        trigger='cron',
        args=[current_app._get_current_object(), connection_id],
        **cron_args,
        misfire_grace_time=3600
    )
    
    logger.info(f"Scheduled job {job_id} with schedule: {schedule}")
    return True


def remove_job_for_connection(connection_id: int) -> bool:
    """
    Remove a scheduled job for a connection.
    
    Args:
        connection_id: Database ID of the connection
        
    Returns:
        True if job was removed, False if not found
    """
    scheduler = get_scheduler()
    job_id = f"connection_{connection_id}"
    
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info(f"Removed job {job_id}")
        return True
    return False


def update_job_for_connection(connection_id: int, old_schedule: str, 
                               new_schedule: str) -> bool:
    """
    Update schedule for a connection's job.
    
    Args:
        connection_id: Database ID of the connection
        old_schedule: Previous schedule string
        new_schedule: New schedule string
        
    Returns:
        True if updated, False if no change needed
    """
    if old_schedule == new_schedule:
        return False
    
    remove_job_for_connection(connection_id)
    return add_job_for_connection(connection_id, new_schedule)


def get_next_run_time(job_id: str) -> Optional[datetime]:
    """
    Get the next scheduled run time for a job.
    
    Args:
        job_id: Job identifier
        
    Returns:
        Next run datetime or None if not scheduled
    """
    scheduler = get_scheduler()
    job = scheduler.get_job(job_id)
    if job:
        return job.next_run_time
    return None


def get_all_jobs() -> list:
    """
    Get all scheduled jobs.
    
    Returns:
        List of job info dicts
    """
    scheduler = get_scheduler()
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            'id': job.id,
            'next_run': job.next_run_time.isoformat() if job.next_run_time else None,
            'trigger': str(job.trigger)
        })
    return jobs
```

#### Migration Steps

1. Create `services/scheduler.py` with all functions
2. Update `routes/routes.py` imports:
   ```python
   from services.scheduler import (
       schedule_existing_jobs,
       add_job_for_connection,
       remove_job_for_connection,
       update_job_for_connection
   )
   ```
3. Update `app.py` to import from service:
   ```python
   from services.scheduler import schedule_existing_jobs
   ```
4. Replace internal calls with service calls
5. Remove original functions from routes.py

#### Verification

- [ ] App starts and schedules existing jobs
- [ ] Creating new connection adds scheduled job
- [ ] Updating connection schedule updates job
- [ ] Deleting connection removes job
- [ ] `/scheduler_health` endpoint works

---

### 0A.4 Add `updated_at` to Connection Model
**File:** `models/models.py`
**Time:** 5 minutes

#### Current State

```python
class Connection(db.Model):
    ...
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    # Missing: updated_at
```

#### Change Required

```python
class Connection(db.Model):
    ...
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())
```

#### Migration Steps

1. Add `updated_at` column to Connection model
2. SQLite will auto-migrate on next restart (with `db.create_all()`)
3. Update `to_dict()` method to include `updated_at`

#### Verification

- [ ] App starts without error
- [ ] Editing a connection updates `updated_at`
- [ ] API returns `updated_at` in connection data

---

### 0A.5 Centralize Rate Limiter
**Source:** `services/musicbrainz.py` lines 24-30
**Target:** `services/rate_limiter.py`
**Time:** 30 minutes

#### Current State

MusicBrainz has its own rate limiter:

```python
# services/musicbrainz.py
RATE_LIMIT_SECONDS = 1.1

class MusicBrainzService:
    def __init__(self):
        self._last_request_time = 0
    
    def _rate_limit(self):
        now = time.time()
        elapsed = now - self._last_request_time
        if elapsed < RATE_LIMIT_SECONDS:
            time.sleep(RATE_LIMIT_SECONDS - elapsed)
        self._last_request_time = time.time()
```

#### New Centralized Implementation

```python
# services/rate_limiter.py
"""
Centralized rate limiting for all external API calls.
Thread-safe singleton pattern ensures proper rate limiting across
concurrent requests from scheduler, manual runs, and API calls.
"""
import time
import threading
from typing import Dict, Optional


class RateLimiter:
    """
    Thread-safe rate limiter with per-service limits.
    
    Usage:
        from services.rate_limiter import RateLimiter
        
        # Before making API call:
        RateLimiter.wait('musicbrainz')
        response = requests.get(...)
    """
    
    _instances: Dict[str, 'RateLimiter'] = {}
    _lock = threading.Lock()
    
    # Rate limits in seconds between requests
    LIMITS = {
        'musicbrainz': 1.1,   # 1 req/sec with buffer
        'lastfm': 1.0,        # 1 req/sec
        'spotify': 0.2,       # 5 req/sec (conservative)
        'lidarr': 0.1,        # 10 req/sec (local service)
    }
    
    def __init__(self, service: str, limit: float):
        """
        Initialize rate limiter for a service.
        
        Args:
            service: Service name
            limit: Minimum seconds between requests
        """
        self.service = service
        self.limit = limit
        self._last_request_time = 0.0
        self._service_lock = threading.Lock()
    
    @classmethod
    def get(cls, service: str) -> 'RateLimiter':
        """
        Get or create rate limiter for a service.
        
        Args:
            service: Service name (musicbrainz, lastfm, spotify, lidarr)
            
        Returns:
            RateLimiter instance for the service
            
        Raises:
            ValueError: If service is unknown
        """
        if service not in cls.LIMITS:
            raise ValueError(f"Unknown service: {service}. Valid: {list(cls.LIMITS.keys())}")
        
        with cls._lock:
            if service not in cls._instances:
                cls._instances[service] = cls(service, cls.LIMITS[service])
            return cls._instances[service]
    
    @classmethod
    def wait(cls, service: str) -> float:
        """
        Wait if needed to respect rate limit, then record request time.
        
        Convenience method that gets the limiter and calls wait().
        
        Args:
            service: Service name
            
        Returns:
            Seconds waited (0 if no wait needed)
        """
        limiter = cls.get(service)
        return limiter._wait()
    
    def _wait(self) -> float:
        """
        Wait if needed to respect rate limit.
        
        Thread-safe: only one thread can check/update at a time.
        
        Returns:
            Seconds waited (0 if no wait needed)
        """
        with self._service_lock:
            now = time.time()
            elapsed = now - self._last_request_time
            wait_time = 0.0
            
            if elapsed < self.limit:
                wait_time = self.limit - elapsed
                time.sleep(wait_time)
            
            self._last_request_time = time.time()
            return wait_time
    
    @classmethod
    def reset(cls, service: str = None) -> None:
        """
        Reset rate limiter(s). Useful for testing.
        
        Args:
            service: Service to reset, or None for all
        """
        with cls._lock:
            if service:
                if service in cls._instances:
                    cls._instances[service]._last_request_time = 0.0
            else:
                for limiter in cls._instances.values():
                    limiter._last_request_time = 0.0
    
    @classmethod
    def get_stats(cls) -> Dict[str, Dict]:
        """
        Get rate limiter statistics for monitoring.
        
        Returns:
            Dict of service -> stats
        """
        stats = {}
        for service, limiter in cls._instances.items():
            stats[service] = {
                'limit_seconds': limiter.limit,
                'last_request': limiter._last_request_time,
                'requests_per_second': 1.0 / limiter.limit if limiter.limit > 0 else 0
            }
        return stats
```

#### Update MusicBrainz to Use Centralized Limiter

```python
# services/musicbrainz.py - Updated
from services.rate_limiter import RateLimiter

class MusicBrainzService:
    def __init__(self):
        # Remove: self._last_request_time = 0
        self._session = requests.Session()
        ...
    
    # Remove: def _rate_limit(self): ...
    
    def _make_request(self, endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make a rate-limited request to MusicBrainz API."""
        RateLimiter.wait('musicbrainz')  # Use centralized limiter
        params['fmt'] = 'json'
        url = f"{MUSICBRAINZ_API_BASE}/{endpoint}"
        response = self._session.get(url, params=params, timeout=30)
        response.raise_for_status()
        return response.json()
```

#### Migration Steps

1. Create `services/rate_limiter.py`
2. Update `services/musicbrainz.py` to use centralized limiter
3. Remove `RATE_LIMIT_SECONDS`, `_last_request_time`, and `_rate_limit()` from MusicBrainz
4. Add unit tests for rate limiter
5. Verify MusicBrainz searches still work

#### Verification

- [ ] MusicBrainz searches work with rate limiting
- [ ] Multiple concurrent requests are properly rate limited
- [ ] No import errors on app startup

---

## Phase 0A Completion Checklist

After completing all Phase 0A tasks:

- [ ] `routes/routes.py` reduced by ~300 lines
- [ ] All existing functionality works unchanged
- [ ] New services are importable without circular dependencies
- [ ] Unit tests pass
- [ ] App starts and schedules jobs correctly

### Commit Strategy

Commit each extraction separately for easy rollback:

1. `refactor: extract Lidarr service from routes.py`
2. `refactor: extract Spotify client factory from routes.py`
3. `refactor: extract scheduler utilities from routes.py`
4. `feat: add updated_at column to Connection model`
5. `refactor: centralize rate limiter, update MusicBrainz`

---

## Phase 0B: Shared Infrastructure

**Depends on:** Phase 0A completed (services extracted)

This phase builds the new infrastructure needed for subscription and import features,
leveraging the services extracted in Phase 0A.

---

### 0B.1 Extend Rate Limiter for All Services
**File:** `services/rate_limiter.py` (created in 0A.5)
**Time:** 30 minutes
**Depends on:** 0A.5

The rate limiter was created in Phase 0A. This task adds configuration for any
additional services and adds monitoring/stats endpoints.

**Tasks:**
- [ ] Verify rate limiter works for Last.fm API calls
- [ ] Verify rate limiter works for Spotify API calls  
- [ ] Add `/api/rate-limiter/stats` endpoint for monitoring
- [ ] Add unit tests for concurrent access patterns

---

### 0B.2 Lidarr Cache Service
**File:** `services/lidarr_cache.py`
**Time:** 1.5 hours
**Depends on:** 0A.1 (Lidarr service extracted)

Uses the `get_all_artists_detailed()` function from the extracted Lidarr service.

```python
# services/lidarr_cache.py
"""
Lidarr library cache for fast duplicate detection.
Refreshed once per subscription/import run.
"""
from typing import Set, Optional
from datetime import datetime

from services.lidarr import get_all_artists_detailed, normalize_artist_name


class LidarrArtistCache:
    """
    In-memory cache of Lidarr library for duplicate detection.
    
    Refreshed at the start of each subscription/import run.
    Valid for the duration of that run only.
    """
    
    def __init__(self, connection):
        self.connection = connection
        self.mbids: Set[str] = set()
        self.names: Set[str] = set()
        self.last_refresh: Optional[datetime] = None
        self._is_valid = False
    
    def refresh(self) -> bool:
        """
        Fetch all artists from Lidarr and build lookup sets.
        
        Returns:
            True if refresh successful, False on error
        """
        result = get_all_artists_detailed(self.connection)
        if 'error' in result:
            return False
        
        self.mbids = result['mbids']
        self.names = result['names']
        self.last_refresh = datetime.utcnow()
        self._is_valid = True
        return True
    
    def exists_by_mbid(self, mbid: str) -> bool:
        """Check if artist exists by MusicBrainz ID."""
        return mbid in self.mbids
    
    def exists_by_name(self, name: str) -> bool:
        """Check if artist exists by normalized name."""
        return normalize_artist_name(name) in self.names
    
    def exists(self, name: str = None, mbid: str = None) -> bool:
        """Check if artist exists by MBID (preferred) or name."""
        if mbid and self.exists_by_mbid(mbid):
            return True
        if name and self.exists_by_name(name):
            return True
        return False
    
    @property
    def is_valid(self) -> bool:
        """Check if cache has been refreshed this run."""
        return self._is_valid
    
    @property
    def artist_count(self) -> int:
        """Number of artists in cache."""
        return len(self.mbids)
```

**Tasks:**
- [ ] Create `services/lidarr_cache.py`
- [ ] Implement cache class using extracted Lidarr service
- [ ] Add unit tests
- [ ] Integrate into subscription runner (Phase 1)

---

### 0B.3 Unified Subscription Schema Migration
**File:** `models/models.py`
**Time:** 2 hours

Adds the database models for subscriptions. Uses the unified schema that supports
both Last.fm and Spotify subscriptions.

```python
# Added to models/models.py

class Subscription(db.Model):
    """
    A subscription to a music discovery source.
    Supports both Last.fm and Spotify sources.
    """
    __tablename__ = 'subscriptions'
    
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    connection_id = db.Column(db.Integer, db.ForeignKey('connections.id'), nullable=False)
    
    # Source configuration
    source_service = db.Column(db.String(20), nullable=False)  # 'lastfm' or 'spotify'
    source_type = db.Column(db.String(50), nullable=False)     # 'chart', 'tag', 'geo', 'playlist', etc.
    api_endpoint = db.Column(db.String(255), nullable=True)    # Specific API endpoint
    filters = db.Column(db.JSON, nullable=True)                # Filter parameters as JSON
    
    # Result settings
    result_limit = db.Column(db.Integer, default=50)
    result_handling = db.Column(db.String(20), default='add_all')  # 'add_all', 'queue_review'
    
    # Scheduling
    schedule = db.Column(db.String(20), default='daily')
    is_active = db.Column(db.Boolean, default=True)
    
    # Run state (for concurrency control)
    is_running = db.Column(db.Boolean, default=False)
    run_started_at = db.Column(db.DateTime, nullable=True)
    
    # History
    last_run = db.Column(db.DateTime, nullable=True)
    last_run_status = db.Column(db.String(255), nullable=True)
    
    # Timestamps
    created_at = db.Column(db.DateTime, server_default=db.func.now())
    updated_at = db.Column(db.DateTime, server_default=db.func.now(), onupdate=db.func.now())
    
    # Relationships
    connection = db.relationship('Connection', backref='subscriptions')
    runs = db.relationship('SubscriptionRun', backref='subscription', lazy='dynamic')


class SubscriptionRun(db.Model):
    """Record of a subscription run."""
    __tablename__ = 'subscription_runs'
    
    id = db.Column(db.Integer, primary_key=True)
    subscription_id = db.Column(db.Integer, db.ForeignKey('subscriptions.id'), nullable=False)
    
    started_at = db.Column(db.DateTime, nullable=False)
    completed_at = db.Column(db.DateTime, nullable=True)
    status = db.Column(db.String(20), nullable=False)  # 'running', 'success', 'failed'
    
    # Results
    artists_found = db.Column(db.Integer, default=0)
    artists_added = db.Column(db.Integer, default=0)
    artists_skipped = db.Column(db.Integer, default=0)
    artists_failed = db.Column(db.Integer, default=0)
    
    error_message = db.Column(db.Text, nullable=True)


class SubscriptionResult(db.Model):
    """Individual artist result from a subscription run."""
    __tablename__ = 'subscription_results'
    
    id = db.Column(db.Integer, primary_key=True)
    run_id = db.Column(db.Integer, db.ForeignKey('subscription_runs.id'), nullable=False)
    
    artist_name = db.Column(db.String(255), nullable=False)
    artist_mbid = db.Column(db.String(36), nullable=True)
    
    status = db.Column(db.String(20), nullable=False)  # 'added', 'skipped', 'failed', 'pending'
    error_message = db.Column(db.Text, nullable=True)
    
    created_at = db.Column(db.DateTime, server_default=db.func.now())
```

**Tasks:**
- [ ] Add Subscription model to models.py
- [ ] Add SubscriptionRun model
- [ ] Add SubscriptionResult model
- [ ] Add model methods: `to_dict()`, `acquire_lock()`, `release_lock()`, `is_stale_lock()`
- [ ] Test with `db.create_all()` on fresh database
- [ ] Test with existing database (migration)

---

### 0B.4 Base Scheduler Infrastructure
**File:** `services/scheduler.py` (extend from 0A.3)
**Time:** 1.5 hours
**Depends on:** 0A.3 (scheduler utilities extracted)

Extends the scheduler utilities extracted in Phase 0A to support subscription scheduling
with staggered job execution.

```python
# Added to services/scheduler.py

# Subscription-specific scheduling

def schedule_subscription(subscription_id: int, schedule: str, 
                          stagger_minutes: int = 0) -> bool:
    """
    Schedule a subscription job with optional stagger delay.
    
    Args:
        subscription_id: Database ID of subscription
        schedule: Schedule string (hourly, daily, weekly, monthly)
        stagger_minutes: Minutes to delay from base schedule time
        
    Returns:
        True if scheduled, False if manual or error
    """
    if schedule == 'manual':
        return False
    
    scheduler = get_scheduler()
    job_id = f"subscription_{subscription_id}"
    
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    
    cron_args = SCHEDULE_MAP.get(schedule, {}).copy()
    if not cron_args:
        return False
    
    # Apply stagger
    if stagger_minutes > 0:
        cron_args['minute'] = stagger_minutes
    
    scheduler.add_job(
        id=job_id,
        func='services.subscription_runner:run_subscription',
        trigger='cron',
        args=[subscription_id],
        **cron_args,
        misfire_grace_time=3600
    )
    return True


def schedule_all_subscriptions(stagger_delay: int = 5) -> int:
    """
    Schedule all active subscriptions with staggered execution.
    
    Args:
        stagger_delay: Minutes between each subscription's run time
        
    Returns:
        Number of subscriptions scheduled
    """
    from models.models import Subscription
    
    subscriptions = Subscription.query.filter_by(is_active=True).all()
    count = 0
    
    for i, sub in enumerate(subscriptions):
        if sub.schedule and sub.schedule != 'manual':
            stagger = (i * stagger_delay) % 60
            if schedule_subscription(sub.id, sub.schedule, stagger):
                count += 1
    
    return count


def unschedule_subscription(subscription_id: int) -> bool:
    """Remove scheduled job for a subscription."""
    scheduler = get_scheduler()
    job_id = f"subscription_{subscription_id}"
    
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        return True
    return False
```

**Tasks:**
- [ ] Add subscription scheduling functions to services/scheduler.py
- [ ] Implement staggered scheduling (5-min delay between jobs)
- [ ] Add `schedule_all_subscriptions()` for app startup
- [ ] Update app.py to call subscription scheduler on startup
- [ ] Add unit tests

---

## Phase 0B Completion Checklist

After completing Phase 0B:

- [ ] Rate limiter works for all services (MB, Last.fm, Spotify, Lidarr)
- [ ] Lidarr cache refreshes and detects duplicates
- [ ] Subscription models created and working
- [ ] Scheduler can schedule subscriptions with stagger
- [ ] All unit tests pass
- [ ] App starts without errors

### Commit Strategy

1. `feat: add rate limiter stats endpoint`
2. `feat: add Lidarr cache service for duplicate detection`
3. `feat: add subscription database models`
4. `feat: add subscription scheduler with stagger support`

---

## Phase 1: Last.fm Subscriptions

### 1.1 Last.fm API Service
**File:** `services/lastfm.py`
**Time:** 3 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 2

**Tasks:**
- [ ] Create `services/lastfm.py`
- [ ] Implement `get_top_artists_chart()`
- [ ] Implement `get_top_artists_by_tag()`
- [ ] Implement `get_top_artists_by_country()`
- [ ] Add rate limiting integration
- [ ] Add error handling
- [ ] Add unit tests

---

### 1.2 MusicBrainz Query Builder
**File:** `services/musicbrainz.py` (extend existing)
**Time:** 4 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 2

**Tasks:**
- [ ] Add `search_artists_by_date_range()`
- [ ] Add `search_artists_by_tag()`
- [ ] Implement Lucene query building
- [ ] Add pagination support
- [ ] Add rate limiting integration
- [ ] Add unit tests

---

### 1.3 Subscription Models
**File:** `models/models.py`
**Time:** 2 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 5

**Tasks:**
- [ ] Verify unified schema implementation (from Phase 0)
- [ ] Add model methods: `is_due()`, `acquire_lock()`, `release_lock()`
- [ ] Add `to_dict()` for API serialization
- [ ] Add unit tests

---

### 1.4 Preset Definitions
**File:** `services/subscription_presets.py`
**Time:** 4 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 2

**Tier 1 Presets (14):**
- [ ] Top 50 Weekly Chart
- [ ] Top 50 Monthly Chart
- [ ] Rising Artists (chart velocity)
- [ ] New Releases This Week
- [ ] New Releases This Month
- [ ] Top Rock Artists
- [ ] Top Hip-Hop Artists
- [ ] Top Electronic Artists
- [ ] Top Pop Artists
- [ ] Top Metal Artists
- [ ] Top Jazz Artists
- [ ] Top Country Artists
- [ ] Top R&B/Soul Artists
- [ ] Top Classical Artists

**Tier 2 Presets (5):**
- [ ] New Artists in [Genre]
- [ ] USA Top Artists
- [ ] UK Top Artists
- [ ] Germany Top Artists
- [ ] Japan Top Artists

**Tier 3 Presets (3) - Phase 2:**
- [ ] Similar to [Artist]
- [ ] Similar to [Top N in Library]
- [ ] Recommendations Based on Library

---

### 1.5 Subscription Routes
**File:** `routes/subscriptions.py`
**Time:** 3 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 6

**Tasks:**
- [ ] Create `routes/subscriptions.py` Blueprint
- [ ] `GET /api/subscriptions` - List all
- [ ] `POST /api/subscriptions` - Create new
- [ ] `GET /api/subscriptions/<id>` - Get one
- [ ] `PUT /api/subscriptions/<id>` - Update
- [ ] `DELETE /api/subscriptions/<id>` - Delete
- [ ] `POST /api/subscriptions/<id>/run` - Manual run
- [ ] `GET /api/subscriptions/<id>/history` - Run history
- [ ] `GET /api/subscriptions/presets` - List presets
- [ ] Register blueprint in `app.py`
- [ ] Add unit tests

---

### 1.6 Subscription UI
**File:** `templates/subscriptions.html`, `static/js/subscriptions.js`
**Time:** 4 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 1, 11

**Tasks:**
- [ ] Create subscription list view
- [ ] Create subscription cards with status indicators
- [ ] Add "Create Subscription" modal
- [ ] Add preset selection UI
- [ ] Add run history modal
- [ ] Add edit/delete actions
- [ ] Add manual run button
- [ ] Wire up JavaScript event handlers

---

### 1.7 Custom Builder UI
**File:** Extend `templates/subscriptions.html`
**Time:** 3 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 3

**Tasks:**
- [ ] Create source type selector (Chart, Tag, Country, Date Range)
- [ ] Create dynamic filter fields per source type
- [ ] Add filter validation
- [ ] Add JSON preview
- [ ] Wire up form submission

---

### 1.8 Scheduler Integration
**File:** `services/subscription_runner.py`
**Time:** 3 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 15

**Tasks:**
- [ ] Create `services/subscription_runner.py`
- [ ] Implement `run_subscription(subscription_id)` 
- [ ] Add concurrency control (lock acquisition)
- [ ] Add result processing (add to Lidarr)
- [ ] Add run history logging
- [ ] Register scheduled jobs on app startup
- [ ] Handle job rescheduling on subscription update

---

### 1.9 Run History & Logging
**File:** Extend existing
**Time:** 2 hours
**Spec Reference:** SUBSCRIPTION_SPEC.md Section 5

**Tasks:**
- [ ] Implement 30-day data retention purge job
- [ ] Add detailed logging for subscription runs
- [ ] Add success/failure metrics
- [ ] Add run history API endpoint

---

## Phase 2: Spotify Subscriptions

### 2.1 Spotify Subscription Service
**File:** `services/spotify_subscription.py`
**Time:** 3 hours
**Spec Reference:** SPOTIFY_SUBSCRIPTION_SPEC.md Section 2

**Tasks:**
- [ ] Create `services/spotify_subscription.py`
- [ ] Implement `get_new_releases()`
- [ ] Implement `get_featured_playlists()`
- [ ] Implement `get_category_playlists()`
- [ ] Implement `get_personalized_playlists()` (Discover Weekly, etc.)
- [ ] Add rate limiting integration

---

### 2.2 Preset Configuration
**File:** `services/spotify_subscription_presets.py`
**Time:** 2 hours
**Spec Reference:** SPOTIFY_SUBSCRIPTION_SPEC.md Section 3

**Public Presets (10):**
- [ ] New Releases (All)
- [ ] New Releases (Country-filtered)
- [ ] Featured Playlists
- [ ] Top 50 Global
- [ ] Top 50 USA
- [ ] Top 50 UK
- [ ] Viral 50 Global
- [ ] RapCaviar
- [ ] Today's Top Hits
- [ ] Rock This

**Personalized Presets (4):**
- [ ] Discover Weekly
- [ ] Release Radar
- [ ] Daily Mix 1-6
- [ ] On Repeat

---

### 2.3 Album Extraction Logic
**File:** `services/spotify_subscription.py`
**Time:** 2 hours
**Spec Reference:** SPOTIFY_SUBSCRIPTION_SPEC.md Section 13

**Tasks:**
- [ ] Implement `extract_albums_from_playlist()`
- [ ] Implement `extract_artists_from_albums()`
- [ ] Handle duplicate album detection
- [ ] Handle Various Artists albums
- [ ] Add MusicBrainz lookup for artist MBID

---

### 2.4 Scheduler Integration
**Time:** 2 hours

**Tasks:**
- [ ] Extend `subscription_runner.py` for Spotify source type
- [ ] Add OAuth token refresh handling
- [ ] Add scope validation with user warning

---

### 2.5 UI Integration
**Time:** 2-4 hours

**Tasks:**
- [ ] Extend subscription UI for Spotify presets
- [ ] Add Spotify-specific filter options
- [ ] Add personalized playlist detection indicator
- [ ] Add OAuth scope warning banner

---

## Phase 3: Spotify Import

### 3.1 Import Source Models
**File:** `models/models.py`
**Time:** 2 hours
**Spec Reference:** SPOTIFY_IMPORT_SPEC.md Section 3

**Tasks:**
- [ ] Add `SpotifyImportSource` model
- [ ] Add `SpotifyImportResult` model
- [ ] Add `SpotifyImportSettings` model
- [ ] Add model methods
- [ ] Create migration

---

### 3.2 Import Service
**File:** `services/spotify_import.py`
**Time:** 6 hours
**Spec Reference:** SPOTIFY_IMPORT_SPEC.md Section 7

**Tasks:**
- [ ] Create `services/spotify_import.py`
- [ ] Implement `import_liked_songs()` - extract albums, get artists
- [ ] Implement `import_saved_albums()` - get artists
- [ ] Implement `import_followed_artists()` - direct add
- [ ] Implement `import_playlists()` - extract albums, get artists
- [ ] Add incremental sync (track last sync position)
- [ ] Add Lidarr cache integration
- [ ] Add rate limiting

---

### 3.3 Import Routes
**File:** `routes/spotify_import.py`
**Time:** 2 hours
**Spec Reference:** SPOTIFY_IMPORT_SPEC.md Section 4

**Tasks:**
- [ ] Create `routes/spotify_import.py` Blueprint
- [ ] `GET /api/spotify/import/sources` - List sources
- [ ] `PUT /api/spotify/import/sources/<id>` - Toggle source
- [ ] `POST /api/spotify/import/run` - Manual import
- [ ] `GET /api/spotify/import/preview/<source>` - Preview items
- [ ] `GET /api/spotify/import/settings` - Get settings
- [ ] `PUT /api/spotify/import/settings` - Update settings
- [ ] Register blueprint

---

### 3.4 Import UI
**File:** `templates/spotify_import.html`, `static/js/spotify_import.js`
**Time:** 3 hours
**Spec Reference:** SPOTIFY_IMPORT_SPEC.md Section 11

**Tasks:**
- [ ] Create import source cards (Liked Songs, Albums, Artists, Playlists)
- [ ] Add toggle for each source
- [ ] Add import count display
- [ ] Add "Import Now" button per source
- [ ] Add "Import All" button
- [ ] Add preview modal
- [ ] Add settings panel (schedule, result handling)

---

### 3.5 Review Queue
**Time:** 2 hours
**Spec Reference:** SPOTIFY_IMPORT_SPEC.md Section 16

**Tasks:**
- [ ] Create review queue UI
- [ ] Add approve/reject actions
- [ ] Add bulk approve/reject
- [ ] Add filter by source

---

### 3.6 Scheduler Integration
**Time:** 2 hours

**Tasks:**
- [ ] Create import scheduler job
- [ ] Add concurrency control
- [ ] Add staggered execution
- [ ] Add OAuth token refresh

---

## Phase 4: Testing & Polish

### 4.1 Integration Testing
**Time:** 3 hours

**Tasks:**
- [ ] Test full subscription flow (create → run → add to Lidarr)
- [ ] Test full import flow (enable → import → add to Lidarr)
- [ ] Test scheduler execution
- [ ] Test error recovery

---

### 4.2 Error Handling Validation
**Time:** 2 hours

**Tasks:**
- [ ] Verify rate limit handling
- [ ] Verify API error handling
- [ ] Verify OAuth token expiry handling
- [ ] Verify database error handling

---

### 4.3 UI Polish & Edge Cases
**Time:** 2-4 hours

**Tasks:**
- [ ] Loading states for all async operations
- [ ] Error message display
- [ ] Empty state handling
- [ ] Mobile responsiveness check

---

### 4.4 Documentation Updates
**Time:** 1-3 hours

**Tasks:**
- [ ] Update README.md with new features
- [ ] Update ISSUES.md to mark completed items
- [ ] Add user guide for subscriptions
- [ ] Add user guide for import

---

## Recommended Implementation Order

1. **Phase 0A (Code Extraction)** - Prepare codebase, reduce routes.py complexity
2. **Phase 0B (Shared Infrastructure)** - Build on extracted services
3. **Phase 1 (Last.fm)** - Most complex, establishes patterns for Phase 2
4. **Phase 2 (Spotify Subs)** - Reuses subscription infrastructure
5. **Phase 3 (Spotify Import)** - Separate feature, can be parallelized with Phase 2 after shared infra
6. **Phase 4** - Final polish after all features work

---

## Time Estimates Summary

| Phase | Description | Estimated Hours |
|-------|-------------|-----------------|
| **0A** | Code Extraction & Cleanup | 2-3 |
| **0B** | Shared Infrastructure | 5-6 |
| **1** | Last.fm Subscriptions | 26-37 |
| **2** | Spotify Subscriptions | 11-15 |
| **3** | Spotify Import | 15-21 |
| **4** | Testing & Polish | 8-12 |
| | **Total** | **67-94** |

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| MusicBrainz rate limiting | Aggressive caching, batch queries |
| Spotify API changes | Abstract API calls, version check |
| OAuth token expiry mid-run | Token refresh before each run |
| Large Lidarr libraries | Pagination, progress indicators |
| Scheduler job overlap | Concurrency control, stale lock detection |

---

## Success Criteria

### Phase 0A (Code Extraction)
- [ ] `services/lidarr.py` created with all Lidarr functions
- [ ] `services/spotify.py` created with client factory
- [ ] `services/scheduler.py` created with job utilities
- [ ] `services/rate_limiter.py` created and integrated with MusicBrainz
- [ ] `Connection.updated_at` column added
- [ ] `routes/routes.py` reduced by ~300 lines
- [ ] All existing functionality works unchanged

### Phase 0B (Shared Infrastructure)
- [ ] Rate limiter works for all services
- [ ] Lidarr cache detects duplicates correctly
- [ ] Subscription models created and working
- [ ] Scheduler supports staggered subscription jobs

### Phase 1-4 (Features)
- [ ] All 14 Tier 1 Last.fm presets functional
- [ ] All 5 Tier 2 Last.fm presets functional
- [ ] All 10 public Spotify presets functional
- [ ] All 4 personalized Spotify presets functional
- [ ] All 4 Spotify import sources functional
- [ ] Scheduler runs subscriptions on schedule
- [ ] Artists added to Lidarr without duplicates
- [ ] No data loss on application restart
- [ ] Error handling for all API failures
- [ ] UI provides clear feedback on all operations

---

# Phase 5: Full-Stack Conversion

## Implementation Strategy

Full-Stack JavaScript Conversion (SPEC-008) integrating all feature specifications:
- **SPEC-005**: Collapsible Sidebar Navigation — built into React from the start
- **SPEC-006**: Dark Mode Theme — native Tailwind dark mode support
- **SPEC-007**: Responsive Design — mobile-first with Tailwind
- **SPEC-009**: User Authentication — Node.js/Passport.js implementation

SPEC-004 (Flask Refactoring) is superseded by the full rewrite.

---

## Master Task List

```
┌─────────────────────────────────────────────────────────────────────────┐
│                 PHASE 5: FULL-STACK CONVERSION (SPEC-008)               │
│                        (Estimated: 120-160 hours)                       │
│            Includes: Sidebar, Dark Mode, Responsive, Auth              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  STAGE 5.1: PROJECT FOUNDATION (8-12 hours)                            │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.1.1 Initialize monorepo structure (packages/, apps/)            │
│  [ ] 5.1.2 Configure Next.js 14 with TypeScript                        │
│  [ ] 5.1.3 Configure Express backend with TypeScript                   │
│  [ ] 5.1.4 Set up Docker Compose (MySQL 8, Redis, Node services)       │
│  [ ] 5.1.5 Configure Prisma ORM with MySQL                             │
│  [ ] 5.1.6 Set up ESLint, Prettier, shared TypeScript configs          │
│  [ ] 5.1.7 Create shared types package                                 │
│                                                                         │
│  STAGE 5.2: DATABASE MIGRATION (6-8 hours)                             │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.2.1 Design Prisma schema matching current MySQL schema          │
│  [ ] 5.2.2 Add users, sessions tables (from SPEC-009)                  │
│  [ ] 5.2.3 Add user_id foreign keys to all user-owned tables           │
│  [ ] 5.2.4 Create migration scripts                                    │
│  [ ] 5.2.5 Write data migration utility (Flask DB → new schema)        │
│  [ ] 5.2.6 Test migration with production data copy                    │
│                                                                         │
│  STAGE 5.3: AUTHENTICATION SYSTEM (12-16 hours) [SPEC-009]             │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.3.1 Implement Passport.js local strategy                        │
│  [ ] 5.3.2 Create session management with Redis                        │
│  [ ] 5.3.3 Build setup wizard for first admin                          │
│  [ ] 5.3.4 Create login/logout API endpoints                           │
│  [ ] 5.3.5 Implement role-based middleware (admin/user)                │
│  [ ] 5.3.6 Add user_id scoping to all data queries                     │
│  [ ] 5.3.7 Build admin user management endpoints                       │
│  [ ] 5.3.8 Create password reset (admin-initiated)                     │
│                                                                         │
│  STAGE 5.4: CORE API LAYER (16-20 hours)                               │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.4.1 Create rate limiter service                                 │
│  [ ] 5.4.2 Port Lidarr service to TypeScript                           │
│  [ ] 5.4.3 Port Spotify service to TypeScript                          │
│  [ ] 5.4.4 Port Last.fm service to TypeScript                          │
│  [ ] 5.4.5 Port MusicBrainz service to TypeScript                      │
│  [ ] 5.4.6 Create Lidarr cache service                                 │
│  [ ] 5.4.7 Implement connections API (CRUD)                            │
│  [ ] 5.4.8 Implement settings API                                      │
│  [ ] 5.4.9 Implement search API                                        │
│  [ ] 5.4.10 Create WebSocket server for real-time updates              │
│                                                                         │
│  STAGE 5.5: JOB QUEUE SYSTEM (8-10 hours)                              │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.5.1 Configure BullMQ with Redis                                 │
│  [ ] 5.5.2 Port subscription runner to TypeScript                      │
│  [ ] 5.5.3 Create job scheduling system                                │
│  [ ] 5.5.4 Implement job progress WebSocket events                     │
│  [ ] 5.5.5 Add job history and logging                                 │
│  [ ] 5.5.6 Create job management API                                   │
│                                                                         │
│  STAGE 5.6: UI FOUNDATION (12-16 hours) [SPEC-005/006/007]             │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.6.1 Set up Tailwind CSS with dark mode                          │
│  [ ] 5.6.2 Configure Shadcn/UI component library                       │
│  [ ] 5.6.3 Create base layout with collapsible sidebar                 │
│  [ ] 5.6.4 Implement sidebar expand/collapse with persistence          │
│  [ ] 5.6.5 Implement hamburger menu for mobile                         │
│  [ ] 5.6.6 Create dark/light theme toggle                              │
│  [ ] 5.6.7 Implement OS theme detection + localStorage                 │
│  [ ] 5.6.8 Define responsive breakpoints                               │
│  [ ] 5.6.9 Create mobile-first CSS utilities                           │
│                                                                         │
│  STAGE 5.7: AUTHENTICATION UI (6-8 hours) [SPEC-009]                   │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.7.1 Create setup wizard component                               │
│  [ ] 5.7.2 Create login page                                           │
│  [ ] 5.7.3 Create user profile page                                    │
│  [ ] 5.7.4 Create admin user management page                           │
│  [ ] 5.7.5 Add protected route wrapper                                 │
│  [ ] 5.7.6 Implement session timeout handling                          │
│                                                                         │
│  STAGE 5.8: FEATURE PAGES (20-25 hours)                                │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.8.1 Dashboard page (connection status, quick stats)             │
│  [ ] 5.8.2 Connections page (CRUD, test connection)                    │
│  [ ] 5.8.3 Search page (artist search, preview, add)                   │
│  [ ] 5.8.4 Subscriptions list page                                     │
│  [ ] 5.8.5 Subscription detail/edit page                               │
│  [ ] 5.8.6 Subscription preset selector                                │
│  [ ] 5.8.7 Spotify Import page                                         │
│  [ ] 5.8.8 Import review queue modal                                   │
│  [ ] 5.8.9 Logs page with filtering                                    │
│  [ ] 5.8.10 Settings page                                              │
│                                                                         │
│  STAGE 5.9: PWA & POLISH (8-10 hours)                                  │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.9.1 Configure PWA manifest                                      │
│  [ ] 5.9.2 Implement service worker                                    │
│  [ ] 5.9.3 Add offline fallback page                                   │
│  [ ] 5.9.4 Optimize for mobile install prompts                         │
│  [ ] 5.9.5 Add loading states and skeletons                            │
│  [ ] 5.9.6 Implement error boundaries                                  │
│  [ ] 5.9.7 Add toast notifications                                     │
│                                                                         │
│  STAGE 5.10: TESTING & MIGRATION (16-20 hours)                         │
│  ─────────────────────────────────────────────────────────────         │
│  [ ] 5.10.1 Set up Jest for unit tests                                 │
│  [ ] 5.10.2 Set up Playwright for E2E tests                            │
│  [ ] 5.10.3 Write unit tests for all services                          │
│  [ ] 5.10.4 Write API integration tests                                │
│  [ ] 5.10.5 Write E2E tests for critical paths                         │
│  [ ] 5.10.6 Create migration guide documentation                       │
│  [ ] 5.10.7 Test Docker deployment                                     │
│  [ ] 5.10.8 Performance testing and optimization                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘

Total Phase 5 Estimate: 112-145 hours
```

---

## Specification Reference

| Spec | Title | Location | Est. Hours |
|------|-------|----------|------------|
| SPEC-005 | Collapsible Sidebar Navigation | `docs/specs/SPEC-005-SIDEBAR-NAVIGATION.md` | Integrated |
| SPEC-006 | Dark Mode Theme | `docs/specs/SPEC-006-DARK-MODE.md` | Integrated |
| SPEC-007 | Mobile-Friendly Responsive Design | `docs/specs/SPEC-007-RESPONSIVE-DESIGN.md` | Integrated |
| SPEC-008 | Full-Stack JavaScript Conversion | `docs/specs/SPEC-008-FULLSTACK-CONVERSION.md` | 120-160 |
| SPEC-009 | User Management & Authentication | `docs/specs/SPEC-009-USER-AUTHENTICATION.md` | Integrated |

*SPEC-004 (Codebase Refactoring) is superseded by the full-stack conversion.*

---

# Phase 6: V2 Gap Remediation

## Overview

Phase 5 (Full-Stack Conversion) was partially implemented but has significant gaps.
See `v2/GAP-ANALYSIS.md` for detailed analysis.

**Status:** V2 Docker containers run but core features missing.

---

## Critical Gaps (P0)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   PHASE 6.0: CRITICAL FIXES (P0)                        │
│                        (Estimated: 8-10 hours)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ ] 6.0.1 Auth Enforcement (15 min)                                   │
│      - Wrap layout.tsx with AuthGuard component                        │
│      - Verify all routes require authentication                        │
│                                                                         │
│  [ ] 6.0.2 AI Integration - Schema (30 min)                            │
│      - Add AISettings model to Prisma schema                           │
│      - Add aiEnabled, maxAiRecommendations to Connection               │
│      - Run migration                                                    │
│                                                                         │
│  [ ] 6.0.3 AI Integration - Backend (3 hours)                          │
│      - Create services/ai.ts with OpenAI/Anthropic clients             │
│      - Create routes/ai.ts with settings CRUD                          │
│      - Add openai, anthropic npm packages                              │
│      - Port strategy prompts from v1                                   │
│                                                                         │
│  [ ] 6.0.4 AI Integration - Frontend (2 hours)                         │
│      - Create settings/ai/page.tsx                                     │
│      - OpenAI card: enable, API key, strategy                          │
│      - Anthropic card: enable, API key, strategy                       │
│                                                                         │
│  [ ] 6.0.5 Spotify Import Refresh (1 hour)                             │
│      - Add POST /api/imports/refresh endpoint                          │
│      - Fetch sources from Spotify API                                  │
│      - Create/update ImportSource records                              │
│                                                                         │
│  [ ] 6.0.6 Port Subscription Presets (2 hours)                         │
│      - Port all 30+ presets from v1 subscription_presets.py            │
│      - Add missing Last.fm tags: R&B, Country, Classical, Jazz         │
│      - Add missing geo presets (11+ countries)                         │
│      - Add MusicBrainz presets                                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## High Priority Gaps (P1)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   PHASE 6.1: CORE FEATURES (P1)                         │
│                        (Estimated: 10-12 hours)                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ ] 6.1.1 AI in Subscriptions (2 hours)                               │
│      - Integrate AI recommendations into subscription-worker.ts        │
│      - Add AI results to preview and queue                             │
│      - Filter against Lidarr library                                   │
│                                                                         │
│  [ ] 6.1.2 Spotify Editorial Presets (3 hours)                         │
│      - New Releases preset                                             │
│      - Featured Playlists preset                                       │
│      - Category Playlists presets                                      │
│      - Implement spotify_new_releases handler in worker                │
│                                                                         │
│  [ ] 6.1.3 Spotify Personalized Presets (3 hours)                      │
│      - Discover Weekly preset                                          │
│      - Release Radar preset                                            │
│      - Daily Mix presets                                               │
│      - Top Artists preset                                              │
│      - Handle playlist discovery from user library                     │
│                                                                         │
│  [ ] 6.1.4 MusicBrainz Presets (2 hours)                               │
│      - New releases by date preset                                     │
│      - New releases by tag preset                                      │
│      - Integrate with existing MusicBrainz service                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Medium Priority Gaps (P2)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   PHASE 6.2: UX IMPROVEMENTS (P2)                       │
│                        (Estimated: 4-6 hours)                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  [ ] 6.2.1 Setup Wizard Fix (30 min)                                   │
│      - Make Lidarr connection required in step 2                       │
│      - Test connection before allowing proceed                         │
│                                                                         │
│  [ ] 6.2.2 Spotify Import UI (2 hours)                                 │
│      - Add refresh sources button                                      │
│      - Display source list with counts                                 │
│      - Add enable/disable toggles per source                           │
│      - Show import history                                             │
│                                                                         │
│  [ ] 6.2.3 Additional Presets (1 hour)                                 │
│      - Complete remaining Last.fm tag presets                          │
│      - Complete remaining geo country presets                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 6 Summary

| Stage | Description | Est. Hours | Priority |
|-------|-------------|------------|----------|
| 6.0 | Critical Fixes (Auth, AI, Presets) | 8-10 | P0 |
| 6.1 | Core Features (AI Integration, Spotify/MB) | 10-12 | P1 |
| 6.2 | UX Improvements | 4-6 | P2 |
| **Total** | | **22-28** | |

---

## V2 Production Readiness Checklist

- [ ] Auth enforced on all routes
- [ ] AI settings page functional
- [ ] AI recommendations in subscription results
- [ ] All 30+ subscription presets available
- [ ] Spotify editorial presets working
- [ ] Spotify personalized presets working
- [ ] MusicBrainz presets working
- [ ] Spotify Import refresh sources working
- [ ] Setup wizard requires Lidarr connection
- [ ] Docker containers stable
- [ ] No critical console errors
