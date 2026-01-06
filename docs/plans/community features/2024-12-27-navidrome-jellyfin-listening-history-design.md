# Navidrome/Jellyfin Listening History Integration Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 2 - Medium Impact  
**Effort:** Medium-High  

## Problem Statement

Users want music discovery based on what they actually listen to, not just what's in their library. Community requests include:
- "Music streaming integrated with Lidarr and providing recommendations?"
- Recommendations based on play counts and listening patterns
- Discovery based on "most played" rather than "owned"

Current state: Mixarr has Tautulli (Plex) integration for listening history. Users of Navidrome and Jellyfin lack this capability.

## Solution

Add connections for self-hosted music servers to import listening history and generate recommendations:
1. Navidrome (Subsonic API)
2. Jellyfin (Jellyfin API)

Create subscription types that leverage play counts and listening patterns.

## Target Services

### Navidrome

**API:** Subsonic API (standard across many music servers)
**Authentication:** Username + password/token
**Relevant Endpoints:**

```
GET /rest/getStarred      - Starred/favorited items
GET /rest/getNowPlaying   - Currently playing
GET /rest/getTopSongs     - Top songs by artist
GET /rest/getArtists      - All artists with play counts
```

### Jellyfin

**API:** REST API with API key or user token
**Authentication:** API key or username/password
**Relevant Endpoints:**

```
GET /Users/{userId}/Items           - Library items with play counts
GET /Items?SortBy=PlayCount         - Sort by most played
GET /Users/{userId}/Items/Latest    - Recently played
GET /Users/{userId}/FavoriteItems   - Favorited items
```

## Design

### New Connection Types

```prisma
enum ConnectionType {
  // ... existing
  navidrome
  jellyfin
}
```

### Connection Configs

```typescript
interface NavidromeConfig {
  url: string;           // Server URL
  username: string;
  password: string;      // Or token
}

interface JellyfinConfig {
  url: string;           // Server URL
  apiKey: string;        // API key
  userId?: string;       // Specific user (admin can access multiple)
}
```

### Navidrome Service

**File:** `apps/api/src/services/navidrome.ts`

```typescript
export class NavidromeService {
  private baseUrl: string;
  
  constructor(private config: NavidromeConfig) {
    this.baseUrl = config.url;
  }
  
  // Authentication uses MD5 token per Subsonic spec
  private getAuthParams(): URLSearchParams;
  
  async getArtists(): Promise<SubsonicArtist[]>;
  async getStarred(): Promise<StarredItems>;
  async getTopSongs(artistId: string, count?: number): Promise<Song[]>;
  async getRecentlyPlayed(): Promise<Song[]>;
  async getMostPlayed(limit?: number): Promise<Artist[]>;
}

interface SubsonicArtist {
  id: string;
  name: string;
  albumCount: number;
  starred?: string;  // Date if starred
  playCount?: number;
}
```

### Jellyfin Service

**File:** `apps/api/src/services/jellyfin.ts`

```typescript
export class JellyfinService {
  private baseUrl: string;
  
  constructor(private config: JellyfinConfig) {
    this.baseUrl = config.url;
  }
  
  async getArtists(sortBy?: 'PlayCount' | 'DatePlayed'): Promise<JellyfinArtist[]>;
  async getFavorites(): Promise<JellyfinItem[]>;
  async getRecentlyPlayed(limit?: number): Promise<JellyfinItem[]>;
  async getMostPlayed(limit?: number): Promise<JellyfinArtist[]>;
  async getUserId(): Promise<string>;  // Get current user ID
}

interface JellyfinArtist {
  Id: string;
  Name: string;
  UserData: {
    PlayCount: number;
    IsFavorite: boolean;
    LastPlayedDate: string;
  };
}
```

### Subscription Types

| Type | Description |
|------|-------------|
| `navidrome_starred` | Starred artists from Navidrome |
| `navidrome_most_played` | Most played artists |
| `navidrome_recently_played` | Recently played artists |
| `jellyfin_favorites` | Favorited artists from Jellyfin |
| `jellyfin_most_played` | Most played artists |
| `jellyfin_recently_played` | Recently played artists |

### Subscription Worker Handlers

```typescript
case 'navidrome_starred':
  const starred = await navidrome.getStarred();
  artists = starred.artists.map(a => ({
    name: a.name,
    source: 'navidrome_starred',
  }));
  break;

case 'navidrome_most_played':
  const mostPlayed = await navidrome.getMostPlayed(config.limit || 50);
  artists = mostPlayed.map(a => ({
    name: a.name,
    source: 'navidrome_most_played',
  }));
  break;

case 'jellyfin_favorites':
  const favorites = await jellyfin.getFavorites();
  artists = favorites
    .filter(item => item.Type === 'MusicArtist')
    .map(a => ({ name: a.Name, source: 'jellyfin_favorites' }));
  break;

case 'jellyfin_most_played':
  const jfMostPlayed = await jellyfin.getMostPlayed(config.limit || 50);
  artists = jfMostPlayed.map(a => ({
    name: a.Name,
    source: 'jellyfin_most_played',
  }));
  break;
```

### Smart Discovery: "Expand What I Listen To"

Beyond simple imports, create intelligent discovery:

```typescript
// Find artists similar to user's top played
async function discoverFromListeningHistory(
  jellyfinOrNavidrome: any,
  musicbrainz: MusicBrainzService,
  lastfm: LastfmService,
): Promise<Artist[]> {
  // 1. Get top 20 most played artists
  const topArtists = await service.getMostPlayed(20);
  
  // 2. For each, get similar artists from Last.fm
  const similarSets = await Promise.all(
    topArtists.map(a => lastfm.getSimilarArtists(a.name))
  );
  
  // 3. Merge and dedupe, weighted by source play count
  const discovered = mergeWithWeights(similarSets, topArtists);
  
  // 4. Filter out artists already in library
  return filterExisting(discovered);
}
```

### Connection Form UI

**Navidrome:**
```
┌─────────────────────────────────────────────┐
│ Configure Navidrome                         │
├─────────────────────────────────────────────┤
│ Server URL: [http://navidrome.local:4533  ] │
│ Username:   [admin                        ] │
│ Password:   [••••••••                     ] │
│                                             │
│ [Test Connection]            [Save]         │
└─────────────────────────────────────────────┘
```

**Jellyfin:**
```
┌─────────────────────────────────────────────┐
│ Configure Jellyfin                          │
├─────────────────────────────────────────────┤
│ Server URL: [http://jellyfin.local:8096   ] │
│ API Key:    [••••••••••••••••             ] │
│                                             │
│ ℹ️ Get API key from Dashboard > API Keys    │
│                                             │
│ [Test Connection]            [Save]         │
└─────────────────────────────────────────────┘
```

### Schema Changes

```prisma
enum ConnectionType {
  // existing...
  navidrome
  jellyfin
}

enum SubscriptionType {
  // existing...
  navidrome_starred
  navidrome_most_played
  navidrome_recently_played
  jellyfin_favorites
  jellyfin_most_played
  jellyfin_recently_played
}
```

## Rate Limiting

```typescript
// Self-hosted services, be conservative
navidrome: { requestsPerSecond: 5, burstSize: 10 },
jellyfin: { requestsPerSecond: 5, burstSize: 10 },
```

## Challenges

1. **Subsonic API Variations:** Different servers implement slightly different versions
2. **No MBIDs:** Must search by name to add to Lidarr
3. **Play Count Accuracy:** Depends on user scrobbling habits
4. **Authentication Complexity:** Subsonic uses MD5 password hashing

## Mitigation Strategies

1. Test against Navidrome specifically (most popular Subsonic server)
2. Use MusicBrainz search to find MBIDs from names
3. Offer "minimum play count" filter to avoid noise
4. Implement Subsonic auth spec correctly with salt+token

## Implementation Checklist

1. [ ] Create NavidromeService with Subsonic API support
2. [ ] Create JellyfinService with REST API support
3. [ ] Add connection types and forms
4. [ ] Add subscription type handlers
5. [ ] Add "smart discovery" based on listening patterns
6. [ ] Test against real Navidrome/Jellyfin instances
7. [ ] Write tests with mocked responses

## Success Metrics

- Users can import starred/favorite artists from self-hosted servers
- Discovery recommendations based on play counts
- Subscription runs complete successfully
