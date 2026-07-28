/**
 * Deezer Service
 * 
 * Public Deezer API endpoints (no authentication required).
 * Documentation: https://developers.deezer.com/api
 */

interface DeezerArtist {
  id: number;
  name: string;
  link?: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  radio?: boolean;
  tracklist?: string;
  type?: string;
}

interface DeezerSearchResponse {
  data?: DeezerArtist[];
  total?: number;
  next?: string;
}

interface DeezerChartResponse {
  data: DeezerArtist[];
  total?: number;
}

interface DeezerGenre {
  id: number;
  name: string;
  picture?: string;
  picture_small?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
}

interface DeezerGenreListResponse {
  data: DeezerGenre[];
}

const DEEZER_API_BASE = 'https://api.deezer.com';

import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

const API_TIMEOUT = 15_000;

/**
 * Fetch artist image by name (search)
 */
export async function fetchDeezerArtistImage(artistName: string): Promise<string | undefined> {
  try {
    const response = await fetchWithTimeout(
      `${DEEZER_API_BASE}/search/artist?q=${encodeURIComponent(artistName)}`,
      { timeout: API_TIMEOUT }
    );
    if (response.ok) {
      const data = await response.json() as DeezerSearchResponse;
      if (data.data && data.data.length > 0) {
        const artist = data.data[0];
        return artist.picture_xl || artist.picture_big || artist.picture_medium || artist.picture;
      }
    }
  } catch {
    // Ignore image fetch errors
  }
  return undefined;
}

/**
 * Fetch images for multiple artists in parallel
 */
export async function fetchDeezerArtistImages(
  artistNames: string[]
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  
  await Promise.all(
    artistNames.map(async (name) => {
      const imageUrl = await fetchDeezerArtistImage(name);
      if (imageUrl) {
        imageMap.set(name, imageUrl);
      }
    })
  );
  
  return imageMap;
}

/**
 * Get top chart artists (public, no auth required)
 */
export async function getDeezerChartArtists(limit: number = 100): Promise<DeezerArtist[]> {
  const response = await fetchWithTimeout(`${DEEZER_API_BASE}/chart/0/artists?limit=${limit}`, { timeout: API_TIMEOUT });
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

/**
 * Get all available genres
 */
export async function getDeezerGenres(): Promise<DeezerGenre[]> {
  const response = await fetchWithTimeout(`${DEEZER_API_BASE}/genre`, { timeout: API_TIMEOUT });
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerGenreListResponse;
  return data.data || [];
}

/**
 * Get artists by genre ID
 */
export async function getDeezerGenreArtists(genreId: number, limit: number = 100): Promise<DeezerArtist[]> {
  const response = await fetchWithTimeout(`${DEEZER_API_BASE}/genre/${genreId}/artists?limit=${limit}`, { timeout: API_TIMEOUT });
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

/**
 * Search for artists
 */
export async function searchDeezerArtists(query: string, limit: number = 25): Promise<DeezerArtist[]> {
  const response = await fetchWithTimeout(
    `${DEEZER_API_BASE}/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`,
    { timeout: API_TIMEOUT }
  );
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerSearchResponse;
  return data.data || [];
}

/**
 * Get related artists for an artist ID
 */
export async function getDeezerRelatedArtists(artistId: number, limit: number = 25): Promise<DeezerArtist[]> {
  const response = await fetchWithTimeout(`${DEEZER_API_BASE}/artist/${artistId}/related?limit=${limit}`, { timeout: API_TIMEOUT });
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = await response.json() as DeezerChartResponse;
  return data.data || [];
}

// ---------------------------------------------------------------------------
// Track search (playback previews) — the public general `search` endpoint returns
// TRACKS carrying a 30s `preview` MP3 URL plus artist/title/album-cover art. Used
// by the constellation /play resolution (Design §8 playback chain).
// ---------------------------------------------------------------------------

interface DeezerTrackAlbum {
  cover?: string;
  cover_small?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
}

interface DeezerTrackSearchItem {
  id: number;
  title: string;
  /** 30-second MP3 preview URL (may be absent/empty for some tracks). */
  preview?: string;
  artist?: { name?: string };
  album?: DeezerTrackAlbum;
}

interface DeezerTrackSearchResponse {
  data?: DeezerTrackSearchItem[];
}

/** A resolved Deezer track preview (30s clip) with cover art for the player. */
export interface DeezerTrackPreview {
  previewUrl: string;
  title: string;
  artist: string;
  coverUrl?: string;
}

/**
 * Search Deezer for a playable 30s preview of a track (or an artist's top hit
 * when no track is given). Returns the first result that actually carries a
 * `preview` URL, or `null` when nothing playable is found. Throws on an HTTP
 * error so the caller can decide how to degrade (the constellation /play route
 * falls through to a YouTube link-out).
 */
export async function searchDeezerTrackPreview(
  artist: string,
  track?: string,
): Promise<DeezerTrackPreview | null> {
  const query = track ? `${artist} ${track}` : artist;
  const response = await fetchWithTimeout(
    `${DEEZER_API_BASE}/search?q=${encodeURIComponent(query)}&limit=10`,
    { timeout: API_TIMEOUT },
  );
  if (!response.ok) {
    throw new Error(`Deezer API error: ${response.status}`);
  }
  const data = (await response.json()) as DeezerTrackSearchResponse;
  const items = data.data ?? [];
  const hit = items.find((i) => typeof i.preview === 'string' && i.preview.length > 0);
  if (!hit) return null;
  const album = hit.album ?? {};
  return {
    previewUrl: hit.preview!,
    title: hit.title,
    artist: hit.artist?.name ?? artist,
    coverUrl: album.cover_big || album.cover_medium || album.cover || album.cover_small,
  };
}

/**
 * Get artist details by ID
 */
export async function getDeezerArtist(artistId: number): Promise<DeezerArtist | null> {
  const response = await fetchWithTimeout(`${DEEZER_API_BASE}/artist/${artistId}`, { timeout: API_TIMEOUT });
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Deezer API error: ${response.status}`);
  }
  return response.json() as Promise<DeezerArtist>;
}
