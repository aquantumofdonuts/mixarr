/**
 * Public Playlist Import Service
 * 
 * Fetches public Spotify playlists without authentication using the embed endpoint.
 */

export interface PlaylistTrack {
  name: string;
  artists: Array<{ name: string }>;
}

export interface PublicPlaylistData {
  name: string;
  description?: string;
  imageUrl?: string;
  tracks: PlaylistTrack[];
  totalTracks: number;
}

export interface ExtractOptions {
  includeAllArtists?: boolean;
}

/**
 * Parse a Spotify playlist URL to extract the playlist ID
 */
export function parseSpotifyPlaylistUrl(url: string): string | null {
  if (!url) return null;
  
  const patterns = [
    // Standard URL: https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M
    /open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/([a-zA-Z0-9]+)/,
    // URI: spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
    /^spotify:playlist:([a-zA-Z0-9]+)$/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Extract unique artist names from playlist tracks
 */
export function extractArtistsFromPlaylist(
  tracks: PlaylistTrack[],
  options: ExtractOptions = {}
): string[] {
  const artistNames = new Set<string>();
  
  for (const track of tracks) {
    if (!track.artists || track.artists.length === 0) continue;
    
    if (options.includeAllArtists) {
      // Include all artists from collaborations
      for (const artist of track.artists) {
        if (artist.name) artistNames.add(artist.name);
      }
    } else {
      // Only include the primary (first) artist
      if (track.artists[0]?.name) {
        artistNames.add(track.artists[0].name);
      }
    }
  }
  
  return Array.from(artistNames);
}

/**
 * Fetch public playlist data from Spotify's embed endpoint
 */
export async function fetchPublicPlaylist(playlistId: string): Promise<PublicPlaylistData> {
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;
  
  const response = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });
  
  if (!response.ok) {
    throw new Error(`Failed to fetch playlist: ${response.status}`);
  }
  
  const html = await response.text();
  
  // Extract __NEXT_DATA__ JSON from the HTML
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!nextDataMatch) {
    throw new Error('Could not parse playlist data');
  }
  
  try {
    const nextData = JSON.parse(nextDataMatch[1]);
    const entity = nextData?.props?.pageProps?.state?.data?.entity;
    
    if (!entity) {
      throw new Error('Could not parse playlist data');
    }
    
    // Extract tracks from trackList
    // New Spotify embed format: title = track name, subtitle = artist name(s)
    const tracks: PlaylistTrack[] = (entity.trackList || []).map((item: any) => {
      // New format uses subtitle for artist, comma-separated for multiple artists
      const subtitle = item.subtitle || '';
      const artistNames = subtitle.split(/,\s*/).filter(Boolean);
      
      return {
        name: item.title || item.track?.name || item.name || 'Unknown',
        artists: artistNames.length > 0 
          ? artistNames.map((name: string) => ({ name: name.trim() }))
          : (item.track?.artists || item.artists || []).map((a: any) => ({ name: a.name })),
      };
    });
    
    return {
      name: entity.name || entity.title || 'Unknown Playlist',
      description: entity.description,
      imageUrl: entity.coverArt?.extractedColors?.colorDark?.hex || entity.images?.[0]?.url,
      tracks,
      totalTracks: tracks.length,
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Could not parse playlist data');
    }
    throw error;
  }
}

/**
 * Full import flow: parse URL, fetch data, extract artists
 */
export async function importPublicPlaylist(
  url: string,
  options: ExtractOptions = {}
): Promise<{
  playlistName: string;
  artistNames: string[];
  totalTracks: number;
}> {
  const playlistId = parseSpotifyPlaylistUrl(url);
  if (!playlistId) {
    throw new Error('Invalid Spotify playlist URL');
  }
  
  const playlist = await fetchPublicPlaylist(playlistId);
  const artistNames = extractArtistsFromPlaylist(playlist.tracks, options);
  
  return {
    playlistName: playlist.name,
    artistNames,
    totalTracks: playlist.totalTracks,
  };
}
