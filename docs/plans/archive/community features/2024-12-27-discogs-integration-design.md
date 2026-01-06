# Discogs Integration Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 2 - Medium Impact  
**Effort:** Medium  

## Problem Statement

Discogs has exceptional metadata for:
- Vinyl/physical release details
- Classical and jazz with detailed credits
- Rare/obscure releases not well-documented elsewhere
- High-quality artist images

The existing Metadata Enrichment design mentions Discogs as a source, but it's not implemented as a connection type or integrated into the app.

## Solution

Add Discogs as a full integration:
1. Connection type with OAuth authentication
2. Metadata enrichment source (artist bios, images, genres)
3. Optional: Collection import as subscription source

## Discogs API Overview

**Authentication:** OAuth 1.0a (consumer key/secret + user token)
**Rate Limits:** 60 requests/minute for authenticated users
**Documentation:** https://www.discogs.com/developers/

### Key Endpoints

```
GET /artists/{id}           - Artist details, bio, images
GET /database/search        - Search for artists/releases
GET /users/{username}/collection/folders - User's collection
GET /users/{username}/wants  - User's wantlist
GET /labels/{id}            - Label details and releases
```

## Design

### Connection Type

**New connection type:** `discogs`

```typescript
interface DiscogsConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
  username?: string;  // For collection access
}
```

### OAuth Flow

Discogs uses OAuth 1.0a which is more complex than OAuth 2.0:

```
1. GET /oauth/request_token → request_token, request_token_secret
2. Redirect user to /oauth/authorize?oauth_token={request_token}
3. User authorizes, returns with oauth_verifier
4. POST /oauth/access_token → access_token, access_token_secret
5. Store tokens in connection config
```

### Discogs Service

**File:** `apps/api/src/services/discogs.ts`

```typescript
import OAuth from 'oauth-1.0a';

export class DiscogsService {
  private baseUrl = 'https://api.discogs.com';
  private oauth: OAuth;
  
  constructor(private config: DiscogsConfig) {
    this.oauth = new OAuth({
      consumer: { key: config.consumerKey, secret: config.consumerSecret },
      signature_method: 'HMAC-SHA1',
    });
  }
  
  // Artist metadata for enrichment
  async getArtist(discogsId: number): Promise<DiscogsArtist>;
  async searchArtist(name: string): Promise<DiscogsArtist[]>;
  
  // Collection for subscription
  async getCollection(username: string): Promise<CollectionItem[]>;
  async getWantlist(username: string): Promise<WantlistItem[]>;
  
  // Labels for browsing
  async getLabel(labelId: number): Promise<DiscogsLabel>;
  async getLabelReleases(labelId: number): Promise<Release[]>;
}

interface DiscogsArtist {
  id: number;
  name: string;
  profile: string;      // Bio/overview
  images: Image[];      // Multiple resolutions
  urls: string[];       // External links
  namevariations: string[];
  members?: Member[];   // For groups
}

interface Image {
  type: 'primary' | 'secondary';
  uri: string;
  uri150: string;       // Thumbnail
  width: number;
  height: number;
}
```

### Metadata Enrichment Integration

Extend `MetadataEnrichmentService` to use Discogs:

```typescript
// In metadata-enrichment.ts
async fetchFromDiscogs(artistName: string, mbid?: string): Promise<SourceMetadata> {
  const discogs = this.getDiscogsService();
  if (!discogs) return null;
  
  // Search by name (Discogs doesn't use MBIDs)
  const results = await discogs.searchArtist(artistName);
  if (results.length === 0) return null;
  
  const artist = await discogs.getArtist(results[0].id);
  
  return {
    source: 'discogs',
    overview: artist.profile,
    genres: [], // Discogs doesn't have artist-level genres
    images: artist.images.map(img => ({
      url: img.uri,
      width: img.width,
      height: img.height,
      type: img.type === 'primary' ? 'poster' : 'fanart',
    })),
  };
}
```

### Subscription Types (Optional)

If user connects Discogs with username:

| Type | Description |
|------|-------------|
| `discogs_collection` | Artists from your Discogs collection |
| `discogs_wantlist` | Artists from your wantlist |

### Connection OAuth Routes

**File:** `apps/api/src/routes/connections.ts`

```typescript
// GET /api/connections/:id/discogs/auth
// Initiate OAuth flow, return authorize URL

// GET /api/connections/:id/discogs/callback
// Handle OAuth callback, exchange for access tokens

// GET /api/connections/:id/discogs/status
// Check if OAuth is completed

// POST /api/connections/:id/discogs/revoke
// Clear stored tokens
```

### Schema Changes

```prisma
enum ConnectionType {
  // ... existing
  discogs
}

enum SubscriptionType {
  // ... existing
  discogs_collection
  discogs_wantlist
}
```

### Frontend Connection Form

Add Discogs to connections page:

```typescript
{
  value: 'discogs',
  label: 'Discogs',
  color: '#333333',
  description: 'Vinyl collection & metadata enrichment',
  requiresOAuth: true,
  oauthNote: 'Create app at https://www.discogs.com/settings/developers',
}
```

Fields needed:
- Consumer Key (from Discogs developer app)
- Consumer Secret (from Discogs developer app)
- OAuth button to initiate authorization
- Username (optional, for collection access)

## Rate Limiting

Add to `rate-limiter.ts`:

```typescript
discogs: { requestsPerSecond: 1, burstSize: 5 }, // 60/minute limit
```

## Challenges

1. **OAuth 1.0a Complexity:** More involved than OAuth 2.0, requires HMAC signing
2. **No MBID Mapping:** Must search by name, may have false matches
3. **No Artist-Level Genres:** Discogs has styles on releases, not artists
4. **Image Quality Varies:** Some artists have no images

## Mitigation Strategies

1. Use battle-tested `oauth-1.0a` npm package for signing
2. Match by name + verify with external links (Spotify, official site)
3. For genres, could aggregate styles from top releases
4. Fallback to other sources when Discogs lacks images

## Implementation Checklist

1. [ ] Create DiscogsService with OAuth support
2. [ ] Add OAuth 1.0a flow routes
3. [ ] Integrate as metadata enrichment source
4. [ ] Add connection form UI
5. [ ] Optional: Add collection/wantlist subscription types
6. [ ] Add rate limiting
7. [ ] Write tests

## Success Metrics

- Discogs provides bio enrichment for 30%+ of artists missing bios
- High-quality images available from Discogs
- OAuth flow completes successfully
