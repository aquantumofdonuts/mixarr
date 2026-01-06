# Deeper ListenBrainz Integration Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 1 - High Impact  
**Effort:** Low  

## Problem Statement

ListenBrainz is an open-source music tracking service that many self-hosted enthusiasts prefer over Last.fm. The community explicitly requests ListenBrainz integration for:
- Recommendations based on listening history
- Discovery of trending music
- Open-source alternative to commercial services

Current Mixarr state has 3 basic ListenBrainz subscription types, but there's room for deeper integration.

## Current Implementation

```
listenbrainz_top        - Top artists from listening history
listenbrainz_similar    - Similar artists based on library
listenbrainz_recommendations - Official LB recommendations
```

## Proposed Enhancements

### New Subscription Types

| Type | Description | API Endpoint |
|------|-------------|--------------|
| `listenbrainz_explore` | Trending/popular discoveries | `/explore/fresh-releases` |
| `listenbrainz_year_review` | Top artists from yearly review | `/stats/user/{user}/year-in-music` |
| `listenbrainz_playlist` | Import from LB playlists | `/playlist/{playlist_id}` |
| `listenbrainz_radio` | Artist radio recommendations | `/radio/artist/{mbid}` |
| `listenbrainz_loved` | Loved/favorited tracks artists | `/feedback/user/{user}/get-feedback` |

### ListenBrainz API Endpoints to Leverage

```typescript
// Fresh releases (popular new music)
GET https://api.listenbrainz.org/1/explore/fresh-releases

// User's yearly stats
GET https://api.listenbrainz.org/1/stats/user/{user}/year-in-music/{year}

// User's playlists
GET https://api.listenbrainz.org/1/user/{user}/playlists

// Artist radio (similar to artist)
GET https://api.listenbrainz.org/1/radio/artist/{mbid}

// User's loved recordings
GET https://api.listenbrainz.org/1/feedback/user/{user}/get-feedback?score=1
```

## Design

### Enhanced ListenBrainz Service

**File:** `apps/api/src/services/listenbrainz.ts`

```typescript
export class ListenBrainzService {
  private baseUrl = 'https://api.listenbrainz.org/1';
  
  constructor(private token?: string) {}
  
  // Existing methods
  async getTopArtists(username: string, range: string): Promise<Artist[]>;
  async getSimilarArtists(mbid: string): Promise<Artist[]>;
  async getRecommendations(username: string): Promise<Artist[]>;
  
  // New methods
  async getFreshReleases(days?: number): Promise<Release[]>;
  async getYearInMusic(username: string, year: number): Promise<YearStats>;
  async getUserPlaylists(username: string): Promise<Playlist[]>;
  async getPlaylistTracks(playlistId: string): Promise<Track[]>;
  async getArtistRadio(mbid: string, mode?: 'easy' | 'medium' | 'hard'): Promise<Artist[]>;
  async getLovedRecordings(username: string): Promise<Recording[]>;
}

interface Release {
  artistName: string;
  mbid: string;
  releaseDate: string;
  listenCount: number;
}

interface YearStats {
  topArtists: Artist[];
  topRecordings: Recording[];
  totalListens: number;
  newArtistsDiscovered: number;
}
```

### Subscription Worker Handlers

Add to `apps/api/src/jobs/subscription-worker.ts`:

```typescript
case 'listenbrainz_explore':
  const releases = await listenbrainz.getFreshReleases(config.days || 7);
  artists = releases.map(r => ({
    name: r.artistName,
    mbid: r.mbid,
    source: 'listenbrainz_explore',
  }));
  break;

case 'listenbrainz_year':
  const yearStats = await listenbrainz.getYearInMusic(config.username, config.year);
  artists = yearStats.topArtists.map(a => ({
    name: a.name,
    mbid: a.mbid,
    source: 'listenbrainz_year',
  }));
  break;

case 'listenbrainz_playlist':
  const tracks = await listenbrainz.getPlaylistTracks(config.playlistId);
  artists = extractUniqueArtists(tracks);
  break;

case 'listenbrainz_radio':
  const radioArtists = await listenbrainz.getArtistRadio(config.seedMbid, config.mode);
  artists = radioArtists;
  break;

case 'listenbrainz_loved':
  const loved = await listenbrainz.getLovedRecordings(config.username);
  artists = extractUniqueArtists(loved);
  break;
```

### Subscription Presets

Add to frontend preset picker:

```typescript
// ListenBrainz category
{
  category: 'ListenBrainz',
  presets: [
    {
      name: 'Fresh Releases (This Week)',
      type: 'listenbrainz_explore',
      config: { days: 7 },
      description: 'Popular new releases from the past week',
    },
    {
      name: 'Fresh Releases (This Month)',
      type: 'listenbrainz_explore',
      config: { days: 30 },
      description: 'Popular new releases from the past month',
    },
    {
      name: 'Year in Music 2024',
      type: 'listenbrainz_year',
      config: { year: 2024 },
      description: 'Your top artists from 2024',
    },
    {
      name: 'Loved Tracks Artists',
      type: 'listenbrainz_loved',
      config: {},
      description: 'Artists from your loved/favorited tracks',
    },
    {
      name: 'Artist Radio',
      type: 'listenbrainz_radio',
      config: { mode: 'medium' },
      description: 'Discover artists similar to a seed artist',
    },
  ],
}
```

### Connection Enhancements

ListenBrainz connection already exists. Add optional username field for user-specific features:

```typescript
interface ListenBrainzConfig {
  apiToken?: string;  // Optional, for authenticated requests
  username: string;   // Required for user stats
}
```

### Schema Changes

Add new subscription types to Prisma enum:

```prisma
enum SubscriptionType {
  // ... existing types
  listenbrainz_top
  listenbrainz_similar  
  listenbrainz_recommendations
  listenbrainz_explore      // NEW
  listenbrainz_year         // NEW
  listenbrainz_playlist     // NEW
  listenbrainz_radio        // NEW
  listenbrainz_loved        // NEW
}
```

## API Rate Limits

ListenBrainz is generous but be respectful:
- No strict documented limits
- Recommended: 1 request/second
- Already configured in rate-limiter: `listenbrainz: { requestsPerSecond: 2, burstSize: 5 }`

## Competitive Analysis

Sonobarr (competitor) has ListenBrainz integration. This enhancement ensures Mixarr has feature parity plus extras like:
- Fresh Releases (trending discoveries)
- Year in Music stats import
- Artist radio recommendations

## Implementation Checklist

1. [ ] Extend ListenBrainz service with new methods
2. [ ] Add subscription type handlers to worker
3. [ ] Add new enum values to Prisma schema
4. [ ] Add presets to frontend subscription picker
5. [ ] Update connection form to require username
6. [ ] Add tests for new subscription types

## Success Metrics

- 5+ new subscription types available
- Feature parity with Sonobarr's ListenBrainz support
- Users can discover fresh releases without commercial service dependency
