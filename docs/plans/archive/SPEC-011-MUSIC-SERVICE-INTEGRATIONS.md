# SPEC-011: Music Service Integrations Research

## Overview

This document contains research findings on integrating additional music streaming services as subscription sources for the lidarr-spotify-scraper application. The goal is to scrape listening history, playlists, recommendations, and charts from these services to discover new music for import into Lidarr.

## Executive Summary

| Service | API Status | Auth Method | User Data Access | Feasibility | Priority |
|---------|------------|-------------|------------------|-------------|----------|
| **Deezer** | Public API available | OAuth 2.0 | ✅ Full (history, playlists, favorites) | High | P1 |
| **Apple Music** | MusicKit API | JWT + Music User Token | ✅ Full (library, history, recommendations) | Medium | P2 |
| **TIDAL** | Public API (Beta) | OAuth 2.0 | ✅ Full (collections, playlists, recommendations) | High | P1 |
| **SoundCloud** | Public API | OAuth 2.1 + PKCE | ✅ Partial (likes, playlists, follows) | Medium | P3 |
| **Amazon Music** | Closed Beta | N/A | ❌ None | Not Feasible | - |
| **YouTube Music** | YouTube Data API v3 | OAuth 2.0 | ⚠️ Limited (video-focused) | Low | P4 |

---

## 1. Deezer

### API Overview
- **Base URL:** `https://api.deezer.com`
- **Documentation:** https://developers.deezer.com/api
- **Status:** Public, well-documented API

### Authentication
- **Method:** OAuth 2.0
- **Flow:** Authorization Code flow
- **Scopes Required:**
  - `basic_access` - Access user's basic info
  - `email` - Access user's email
  - `offline_access` - Access while user is offline
  - `manage_library` - Manage user's library
  - `listening_history` - Access listening history

### Available Data for Subscription Sources

#### User Listening History
```
GET /user/me/history
```
Returns the user's listening history with track details including artist, album, and play timestamps.

#### User Playlists
```
GET /user/me/playlists
GET /playlist/{id}/tracks
```
Access all user-created and followed playlists with full track listings.

#### User Favorites/Library
```
GET /user/me/tracks      # Loved tracks
GET /user/me/albums      # Favorite albums
GET /user/me/artists     # Favorite artists
```

#### Recommendations
```
GET /user/me/recommendations/tracks
GET /user/me/recommendations/albums
GET /user/me/recommendations/artists
GET /user/me/flow        # Personalized "Flow" mix
```

#### Charts
```
GET /chart               # Global charts
GET /chart/{genre_id}    # Genre-specific charts
GET /chart/0/tracks      # Top tracks
GET /chart/0/albums      # Top albums
GET /chart/0/artists     # Top artists
```

#### Radio/Discovery
```
GET /radio/top           # Top radio stations
GET /artist/{id}/radio   # Artist radio
GET /genre/{id}/radio    # Genre radio
```

### Rate Limits
- 50 requests per 5 seconds
- Requires proper error handling for 429 responses

### Subscription Type Ideas
| Type | Endpoint | Description |
|------|----------|-------------|
| `deezer_history` | `/user/me/history` | Recent listening history |
| `deezer_favorites` | `/user/me/tracks` | Loved/saved tracks |
| `deezer_playlist` | `/playlist/{id}` | Specific playlist sync |
| `deezer_flow` | `/user/me/flow` | Personalized recommendations |
| `deezer_chart_top100` | `/chart/0/tracks` | Top 100 tracks chart |
| `deezer_artist_radio` | `/artist/{id}/radio` | Artist-based discovery |

### Implementation Notes
- Well-documented REST API
- JSON responses
- Good rate limits for our use case
- Requires app registration at https://developers.deezer.com

---

## 2. Apple Music

### API Overview
- **Base URL:** `https://api.music.apple.com/v1`
- **Documentation:** https://developer.apple.com/documentation/applemusicapi
- **Status:** Public MusicKit API

### Authentication
**Two-layer authentication required:**

1. **Developer Token (JWT)**
   - Algorithm: ES256 (P-256 elliptic curve)
   - Created with Apple Developer account credentials
   - Maximum lifetime: 6 months
   - Header: `Authorization: Bearer {developer_token}`

2. **Music User Token**
   - Required for accessing personal user data
   - Obtained via MusicKit on client platforms
   - Header: `Music-User-Token: {user_token}`

### Available Data for Subscription Sources

#### User Library
```
GET /v1/me/library/albums
GET /v1/me/library/artists
GET /v1/me/library/songs
GET /v1/me/library/playlists
```

#### Listening History
```
GET /v1/me/recent/played/tracks
GET /v1/me/recent/played/albums
GET /v1/me/recent/played/stations
```

#### Recommendations
```
GET /v1/me/recommendations
```
Returns personalized content recommendations including playlists, albums, and stations.

#### Apple Music Replay (Year in Review)
```
GET /v1/me/history/heavy-rotation
```
Access to frequently played content (similar to Spotify Wrapped).

#### Charts
```
GET /v1/catalog/{storefront}/charts
```
Parameters: `types=songs,albums,playlists`

#### Curated Playlists
```
GET /v1/catalog/{storefront}/playlists/{id}
```
Access Apple's editorial playlists (Today's Hits, A-List, etc.)

### Rate Limits
- Returns 429 when exceeded
- Implement exponential backoff

### Subscription Type Ideas
| Type | Endpoint | Description |
|------|----------|-------------|
| `apple_recent_tracks` | `/v1/me/recent/played/tracks` | Recently played songs |
| `apple_library` | `/v1/me/library/songs` | Full library sync |
| `apple_heavy_rotation` | `/v1/me/history/heavy-rotation` | Most played tracks |
| `apple_recommendations` | `/v1/me/recommendations` | Personalized picks |
| `apple_charts` | `/v1/catalog/{sf}/charts` | Regional charts |
| `apple_playlist` | Specific playlist ID | Editorial playlist sync |

### Implementation Notes
- **Complexity:** High - requires Apple Developer account ($99/year)
- JWT token generation required server-side
- Music User Token acquisition requires MusicKit SDK integration
- May need browser-based OAuth flow workaround
- Consider whether complexity is worth the user base

---

## 3. TIDAL

### API Overview
- **Base URL:** `https://openapi.tidal.com/v2`
- **Documentation:** https://developer.tidal.com
- **API Reference:** https://tidal-music.github.io/tidal-api-reference/
- **Status:** Public API (Beta)
- **Format:** JSON:API specification compliant

### Authentication
- **Method:** OAuth 2.0
- **Flow:** Authorization Code flow with PKCE
- **Dashboard:** https://developer.tidal.com/dashboard

### Available Data for Subscription Sources

#### User Collections (Favorites)
```
GET /userCollections/{id}/relationships/albums
GET /userCollections/{id}/relationships/artists
GET /userCollections/{id}/relationships/playlists
GET /userCollections/{id}/relationships/tracks
GET /userCollections/{id}/relationships/videos
```

#### User Playlists
```
GET /playlists
GET /playlists/{id}
GET /playlists/{id}/relationships/items
```

#### User Recommendations
```
GET /userRecommendations/{id}
GET /userRecommendations/{id}/relationships/discoveryMixes
GET /userRecommendations/{id}/relationships/myMixes
GET /userRecommendations/{id}/relationships/newArrivalMixes
```

#### Search
```
GET /searchResults/{query}
GET /searchResults/{id}/relationships/albums
GET /searchResults/{id}/relationships/artists
GET /searchResults/{id}/relationships/tracks
```

#### Artist Discovery
```
GET /artists/{id}/relationships/similarArtists
GET /artists/{id}/relationships/radio
GET /tracks/{id}/relationships/similarTracks
```

#### Current User
```
GET /users/me
```

### Subscription Type Ideas
| Type | Endpoint | Description |
|------|----------|-------------|
| `tidal_collection_tracks` | `/userCollections/.../tracks` | Saved tracks |
| `tidal_collection_albums` | `/userCollections/.../albums` | Saved albums |
| `tidal_discovery_mix` | `/userRecommendations/.../discoveryMixes` | Discovery Weekly equivalent |
| `tidal_my_mix` | `/userRecommendations/.../myMixes` | Personalized mixes |
| `tidal_new_arrivals` | `/userRecommendations/.../newArrivalMixes` | New releases for you |
| `tidal_playlist` | `/playlists/{id}` | Specific playlist sync |

### Implementation Notes
- Modern JSON:API format (structured, predictable)
- Beta status - API may change
- High-quality audio focus - appeals to audiophile users
- Good OAuth 2.0 implementation
- Active developer community (GitHub Discussions)

---

## 4. SoundCloud

### API Overview
- **Base URL:** `https://api.soundcloud.com`
- **Documentation:** https://developers.soundcloud.com/docs/api/guide
- **API Reference:** https://developers.soundcloud.com/docs/api/explorer/open-api
- **Status:** Public API

### Authentication
- **Method:** OAuth 2.1 with PKCE (required)
- **Flows:**
  - Authorization Code - for user data access
  - Client Credentials - for public data only
- **Token Lifetime:** ~1 hour (refresh tokens provided)

### Rate Limits
- Client Credentials: 50 tokens per 12h per app, 30 tokens per 1h per IP
- Implement token reuse and refresh token flow

### Available Data for Subscription Sources

#### User Likes
```
GET /me/likes/tracks
GET /me/likes/playlists
```
Note: SoundCloud calls favorites "likes"

#### User Playlists
```
GET /me/playlists
GET /playlists/{id}
```

#### User Following/Activity
```
GET /me/followings
GET /me/activities
```
Activity feed includes tracks from followed artists

#### Track Search
```
GET /tracks?q={query}&genres={genre}&bpm[from]={bpm}
```

#### Charts/Trending
```
GET /tracks?genres={genre}&limit=50
```
Filter by `created_at` for trending content

### Subscription Type Ideas
| Type | Endpoint | Description |
|------|----------|-------------|
| `soundcloud_likes` | `/me/likes/tracks` | Liked tracks |
| `soundcloud_playlist` | `/playlists/{id}` | Specific playlist |
| `soundcloud_following_activity` | `/me/activities` | Feed from followed artists |
| `soundcloud_genre_trending` | `/tracks?genres={genre}` | Trending in genre |

### Implementation Notes
- OAuth 2.1 with PKCE is modern and secure
- Heavy focus on independent/emerging artists
- Different music catalog than mainstream services
- Good for discovering underground/indie music
- Some tracks may have restricted streaming access
- 1-hour token lifetime requires refresh handling

---

## 5. Amazon Music

### API Overview
- **Documentation:** https://developer.amazon.com/docs/music/landing_home.html
- **Status:** **CLOSED BETA** - Not publicly available

### Current Status
> "The Amazon Music Web API is currently in a closed Beta. Please check back soon for updates."

### Available Integrations (Limited)
- Device integrations (Fire TV, Echo, etc.)
- Alexa Skills Kit
- No direct web API for third-party apps

### Recommendation
**Not feasible for integration** - No public API access for user data.

---

## 6. YouTube Music

### API Overview
- **Base URL:** `https://www.googleapis.com/youtube/v3`
- **Documentation:** https://developers.google.com/youtube/v3
- **Status:** YouTube Data API v3 (not YouTube Music specific)

### Authentication
- **Method:** OAuth 2.0
- **Console:** https://console.cloud.google.com

### Limitations
**Critical:** There is no official YouTube Music API. The YouTube Data API v3 is video-focused.

### Available Data (Limited Music Focus)
```
GET /playlists           # User playlists (includes music playlists)
GET /playlistItems       # Items in a playlist
GET /subscriptions       # Channel subscriptions
GET /activities          # User activity feed
GET /videos              # Video details
```

### Music-Related Workarounds
- Access "Liked Videos" playlist (includes liked songs)
- Access user-created playlists
- No access to YouTube Music's algorithmic playlists (Your Mix, etc.)
- No listening history API

### Subscription Type Ideas (Limited)
| Type | Endpoint | Description |
|------|----------|-------------|
| `youtube_liked_music` | Liked Videos playlist | Liked music videos |
| `youtube_playlist` | `/playlistItems` | Specific playlist sync |

### Implementation Notes
- **Low priority** - Not designed for music streaming data
- Quota limits apply (10,000 units/day default)
- Would need to filter music content from video content
- Consider only if users specifically request it

---

## Implementation Priority

### Phase 1 (High Priority)
1. **Deezer** - Best API for our use case
   - Public, well-documented API
   - Full listening history access
   - Comprehensive user data endpoints
   - Reasonable rate limits

2. **TIDAL** - Modern API, audiophile audience
   - JSON:API format (clean integration)
   - Good user collection/recommendation endpoints
   - Active developer support

### Phase 2 (Medium Priority)
3. **Apple Music** - Large user base, complex auth
   - Requires Apple Developer account
   - JWT + Music User Token complexity
   - Large iOS/Mac user base justifies effort

4. **SoundCloud** - Indie/underground focus
   - Different catalog (emerging artists)
   - OAuth 2.1 is straightforward
   - Niche but valuable for discovery

### Phase 3 (Low Priority)
5. **YouTube Music** - Limited API, workarounds needed
   - Only if users specifically request
   - Video-focused API requires filtering

### Not Planned
- **Amazon Music** - No public API available

---

## Technical Architecture Considerations

### Service Abstraction
Create a unified interface for music services:

```python
class MusicServiceProvider(ABC):
    @abstractmethod
    def authenticate(self, credentials: dict) -> bool
    
    @abstractmethod
    def get_user_tracks(self, limit: int) -> List[Track]
    
    @abstractmethod
    def get_user_playlists(self) -> List[Playlist]
    
    @abstractmethod
    def get_playlist_tracks(self, playlist_id: str) -> List[Track]
    
    @abstractmethod
    def get_recommendations(self) -> List[Track]
```

### OAuth Token Storage
- Encrypt tokens at rest
- Implement refresh token rotation
- Store per-user, per-service tokens
- Handle token expiration gracefully

### Rate Limit Handling
- Per-service rate limiters
- Exponential backoff on 429 responses
- Request queuing for batch operations

### Track Matching
All services return tracks in different formats. Need unified matching:
1. ISRC (International Standard Recording Code) - most reliable
2. MusicBrainz ID lookup
3. Fuzzy matching (artist + title + album)

---

## Required Configuration

### Per-Service Credentials
```env
# Deezer
DEEZER_APP_ID=
DEEZER_APP_SECRET=
DEEZER_REDIRECT_URI=

# Apple Music
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY_PATH=

# TIDAL
TIDAL_CLIENT_ID=
TIDAL_CLIENT_SECRET=
TIDAL_REDIRECT_URI=

# SoundCloud
SOUNDCLOUD_CLIENT_ID=
SOUNDCLOUD_CLIENT_SECRET=
SOUNDCLOUD_REDIRECT_URI=
```

---

## Next Steps

1. [ ] Register developer accounts for priority services (Deezer, TIDAL)
2. [ ] Design unified track/artist data models
3. [ ] Implement OAuth callback handling in web UI
4. [ ] Create base `MusicServiceProvider` abstraction
5. [ ] Implement Deezer integration (Phase 1)
6. [ ] Implement TIDAL integration (Phase 1)
7. [ ] Add Apple Music support (Phase 2)
8. [ ] Add SoundCloud support (Phase 2)

---

## References

- Deezer API: https://developers.deezer.com/api
- Apple MusicKit: https://developer.apple.com/documentation/applemusicapi
- TIDAL Developer: https://developer.tidal.com
- TIDAL API Reference: https://tidal-music.github.io/tidal-api-reference/
- SoundCloud API: https://developers.soundcloud.com/docs/api/guide
- YouTube Data API: https://developers.google.com/youtube/v3
