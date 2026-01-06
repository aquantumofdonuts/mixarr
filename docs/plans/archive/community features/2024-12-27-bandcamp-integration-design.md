# Bandcamp Integration Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 3 - Niche  
**Effort:** High  

## Problem Statement

Bandcamp is the preferred platform for indie, underground, and experimental music. Users in this community want:
- Discover new releases from Bandcamp Daily
- Import their Bandcamp collection/wishlist
- Subscribe to artists/labels on Bandcamp

Bandcamp has no public API, making integration challenging.

## Solution

Implement Bandcamp integration via web scraping:
1. Bandcamp Daily new releases (public, scrapable)
2. Collection import (requires login cookies)
3. Tag-based discovery (public)

## Design

### Approach: Web Scraping

Bandcamp has no API. All features require scraping:

```typescript
import * as cheerio from 'cheerio';

export class BandcampService {
  private baseUrl = 'https://bandcamp.com';
  
  // Public endpoints (no auth)
  async getDailyFeatures(): Promise<BandcampRelease[]>;
  async getTagReleases(tag: string): Promise<BandcampRelease[]>;
  async getNewAndNotable(): Promise<BandcampRelease[]>;
  
  // Authenticated (requires session cookies)
  async getCollection(cookies: string): Promise<CollectionItem[]>;
  async getWishlist(cookies: string): Promise<WishlistItem[]>;
}
```

### Bandcamp Daily Scraping

```typescript
async getDailyFeatures(): Promise<BandcampRelease[]> {
  const url = 'https://daily.bandcamp.com/';
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);
  
  const releases: BandcampRelease[] = [];
  
  $('.list-article').each((i, el) => {
    releases.push({
      title: $(el).find('.title').text().trim(),
      artist: $(el).find('.artist').text().trim(),
      url: $(el).find('a').attr('href'),
      imageUrl: $(el).find('img').attr('src'),
      genre: $(el).find('.genre').text().trim(),
    });
  });
  
  return releases;
}
```

### Tag-Based Discovery

```typescript
async getTagReleases(tag: string, page = 1): Promise<BandcampRelease[]> {
  // Bandcamp tag pages: https://bandcamp.com/tag/ambient
  const url = `https://bandcamp.com/tag/${encodeURIComponent(tag)}?page=${page}`;
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);
  
  const releases: BandcampRelease[] = [];
  
  $('.item').each((i, el) => {
    releases.push({
      title: $(el).find('.title').text().trim(),
      artist: $(el).find('.artist').text().trim(),
      url: $(el).find('a').attr('href'),
      // ... etc
    });
  });
  
  return releases;
}
```

### Collection Import (Advanced)

Bandcamp collection requires authentication. Options:

#### Option A: Cookie-Based Auth (Fragile)

User provides session cookies manually:

```typescript
async getCollection(sessionCookie: string): Promise<CollectionItem[]> {
  const url = 'https://bandcamp.com/api/fancollection/1/collection_items';
  
  const response = await fetch(url, {
    headers: {
      Cookie: sessionCookie,
    },
  });
  
  if (!response.ok) throw new Error('Authentication failed');
  
  const data = await response.json();
  return data.items;
}
```

#### Option B: Browser Extension Relay (Complex)

User installs browser extension that relays authenticated requests:

1. Extension captures session when user logs into Bandcamp
2. Extension provides API for Mixarr to request data
3. Much more complex but more reliable

### Subscription Types

| Type | Description | Auth Required |
|------|-------------|---------------|
| `bandcamp_daily` | Bandcamp Daily featured artists | No |
| `bandcamp_tag` | New releases by tag | No |
| `bandcamp_notable` | New and Notable releases | No |
| `bandcamp_collection` | Your purchased collection | Yes (cookies) |
| `bandcamp_wishlist` | Your wishlist items | Yes (cookies) |

### Connection Configuration

```typescript
interface BandcampConfig {
  // Optional - for collection access
  sessionCookie?: string;
  username?: string;
  
  // When cookie was last updated (they expire)
  cookieUpdatedAt?: Date;
}
```

### Frontend Connection Form

```
┌──────────────────────────────────────────────────────────────┐
│ Configure Bandcamp                                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ✓ Public features (Daily, Tags) work without login          │
│                                                              │
│  ─────────────────────────────────────────────────────────   │
│                                                              │
│  Optional: Collection Access                                 │
│                                                              │
│  To import your Bandcamp collection:                         │
│  1. Log into bandcamp.com in your browser                    │
│  2. Open Developer Tools (F12)                               │
│  3. Go to Application > Cookies > bandcamp.com               │
│  4. Copy the "identity" cookie value                         │
│                                                              │
│  Session Cookie:                                             │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ ••••••••••••••••••••••••••••••••                       │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ⚠️ Cookie expires after ~2 weeks. You'll need to update it. │
│                                                              │
│  [Test Connection]                            [Save]         │
└──────────────────────────────────────────────────────────────┘
```

### Artist Name Extraction

Bandcamp URLs → artist names for Lidarr:

```typescript
async function extractArtistFromBandcamp(releaseUrl: string): Promise<string> {
  // URL format: https://artistname.bandcamp.com/album/albumname
  const match = releaseUrl.match(/https?:\/\/([^.]+)\.bandcamp\.com/);
  if (!match) throw new Error('Invalid Bandcamp URL');
  
  // Subdomain is URL-safe artist name
  const subdomain = match[1];
  
  // Fetch page to get proper artist name
  const html = await fetch(releaseUrl).then(r => r.text());
  const $ = cheerio.load(html);
  
  return $('#band-name-location .title').text().trim() || subdomain;
}
```

### Schema Changes

```prisma
enum ConnectionType {
  // existing...
  bandcamp
}

enum SubscriptionType {
  // existing...
  bandcamp_daily
  bandcamp_tag
  bandcamp_notable
  bandcamp_collection
  bandcamp_wishlist
}
```

## Challenges

1. **No API:** Entirely dependent on scraping
2. **Anti-Scraping:** Bandcamp may block or rate-limit
3. **Cookie Expiry:** Collection access requires periodic re-auth
4. **HTML Changes:** Scraper breaks when Bandcamp updates UI
5. **Legal Gray Area:** Scraping ToS concerns

## Mitigation Strategies

1. Cache aggressively to minimize requests
2. Respect robots.txt, add delays between requests
3. Warn users about cookie expiry, notify when refresh needed
4. Use defensive parsing, handle missing fields gracefully
5. Focus on public features (Daily, Tags) first

## Rate Limiting

```typescript
// Very conservative for scraping
bandcamp: { requestsPerSecond: 0.2, burstSize: 2 }, // 1 per 5 seconds
```

## Implementation Phases

**Phase 1:** Public features only (Daily, Tags, Notable)
**Phase 2:** Collection import with cookie auth
**Phase 3:** Label browsing, artist pages

## Implementation Checklist

1. [ ] Create BandcampService with cheerio scraping
2. [ ] Implement Bandcamp Daily parser
3. [ ] Implement tag-based discovery
4. [ ] Add connection type and form
5. [ ] Add subscription handlers
6. [ ] Optional: Cookie-based collection import
7. [ ] Add robust error handling for HTML changes
8. [ ] Test against real Bandcamp pages

## Success Metrics

- Daily and tag subscriptions work reliably
- Indie music fans can discover new artists
- Scraper resilient to minor HTML changes
