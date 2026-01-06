# Public Playlist Import Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 3 - Nice to Have  
**Effort:** Low  

## Problem Statement

Currently, importing from Spotify playlists requires OAuth authentication. Users want to:
- Paste a public playlist URL and import artists without logging in
- Share playlists with friends who can import without having Spotify accounts
- Quick one-time imports without OAuth setup

## Solution

Add "public playlist import" that works without authentication:
1. Parse playlist ID from URL
2. Fetch via Spotify's public embed API or web scraping
3. Extract artist names and add to review queue

## Design

### URL Parsing

```typescript
function parseSpotifyPlaylistUrl(url: string): string | null {
  // Formats:
  // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
  // https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=...
  // spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
  
  const patterns = [
    /spotify\.com\/playlist\/([a-zA-Z0-9]+)/,
    /spotify:playlist:([a-zA-Z0-9]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}
```

### Approach Options

#### Option A: Spotify Embed API (Preferred)

Spotify's embed endpoint returns playlist data without auth:

```typescript
async function getPublicPlaylist(playlistId: string): Promise<PlaylistData> {
  // Embed endpoint - no auth required
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  
  // Fetch HTML and extract data from script tag
  const html = await fetch(embedUrl).then(r => r.text());
  
  // Parse __NEXT_DATA__ or similar JSON blob
  const data = extractEmbedData(html);
  
  return {
    name: data.name,
    tracks: data.tracks.map(t => ({
      name: t.name,
      artist: t.artists[0].name,
    })),
  };
}
```

#### Option B: Spotify oEmbed API

```typescript
async function getPlaylistInfo(playlistId: string): Promise<BasicInfo> {
  const url = `https://open.spotify.com/oembed?url=https://open.spotify.com/playlist/${playlistId}`;
  const data = await fetch(url).then(r => r.json());
  
  // Only returns basic info, not track list
  return {
    title: data.title,
    thumbnail: data.thumbnail_url,
  };
}
```

#### Option C: Web Scraping

```typescript
async function scrapePlaylist(playlistId: string): Promise<PlaylistData> {
  const url = `https://open.spotify.com/playlist/${playlistId}`;
  
  // Use puppeteer or similar for dynamic content
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url);
  
  // Extract track list from DOM
  const tracks = await page.evaluate(() => {
    // ... DOM extraction logic
  });
  
  await browser.close();
  return { tracks };
}
```

### API Endpoint

**File:** `apps/api/src/routes/imports.ts`

```typescript
// POST /api/imports/public-playlist
importsRouter.post('/public-playlist', async (req, res) => {
  const { url, mode = 'queue' } = req.body;
  
  // Parse URL
  const playlistId = parseSpotifyPlaylistUrl(url);
  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
  }
  
  try {
    // Fetch public data
    const playlist = await getPublicPlaylist(playlistId);
    
    // Extract unique artists
    const artistNames = [...new Set(
      playlist.tracks.map(t => t.artist)
    )];
    
    // Based on mode, add to review queue or return preview
    if (mode === 'preview') {
      return res.json({
        playlistName: playlist.name,
        artistCount: artistNames.length,
        artists: artistNames.slice(0, 50), // Limit preview
      });
    }
    
    // Add to review queue
    for (const artistName of artistNames) {
      await prisma.reviewItem.create({
        data: {
          userId: req.user!.id,
          artistName,
          source: `playlist:${playlist.name}`,
          status: 'pending',
        },
      });
    }
    
    return res.json({
      success: true,
      artistsQueued: artistNames.length,
    });
    
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch playlist' });
  }
});
```

### Frontend UI

Add quick-import widget to Review Queue or Dashboard:

```
┌──────────────────────────────────────────────────────────────┐
│ Quick Import from Public Playlist                            │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Paste Spotify playlist URL:                                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYB  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  [Preview Artists]  [Import to Queue]                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Preview Modal

```
┌──────────────────────────────────────────────────────────────┐
│ Playlist: "Today's Top Hits"                                 │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Found 47 unique artists:                                    │
│                                                              │
│  ☑ The Weeknd                                                │
│  ☑ Dua Lipa                                                  │
│  ☑ Drake                                                     │
│  ☑ Taylor Swift                                              │
│  ☐ Ed Sheeran (already in library)                          │
│  ... and 42 more                                             │
│                                                              │
│  [Select All]  [Deselect Existing]                           │
│                                                              │
│                    [Cancel]  [Import Selected (45)]          │
└──────────────────────────────────────────────────────────────┘
```

## Limitations

1. **Embed API Changes:** Spotify may change embed format without notice
2. **Rate Limits:** No auth means stricter rate limits likely
3. **Private Playlists:** Only works for public playlists
4. **Track Limit:** May not get all tracks from very long playlists

## Future Extensions

- Apple Music public playlist import
- YouTube Music playlist import
- Deezer public playlist import

## Implementation Checklist

1. [ ] Implement URL parser for Spotify playlist URLs
2. [ ] Create embed API fetcher with error handling
3. [ ] Add API endpoint for public playlist import
4. [ ] Build frontend quick-import widget
5. [ ] Add preview modal with artist selection
6. [ ] Handle rate limits gracefully
7. [ ] Test with various playlist sizes

## Success Metrics

- Users can import from public playlist in < 1 minute
- No OAuth required for public playlist import
- Clear error messages for private/invalid playlists
