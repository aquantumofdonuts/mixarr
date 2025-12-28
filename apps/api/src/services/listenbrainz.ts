/**
 * ListenBrainz Service
 * 
 * Handles all interactions with the ListenBrainz API for music tracking and recommendations.
 * ListenBrainz is an open-source alternative to Last.fm.
 */

import { rateLimit } from './rate-limiter.js';

// Valid time periods for statistics queries
export type ListenBrainzPeriod = 'week' | 'month' | 'quarter' | 'half_yearly' | 'year' | 'all_time';

// Valid recommendation types
export type ListenBrainzRecommendationType = 'top_artist' | 'similar_artist';

// Valid radio modes
export type ListenBrainzRadioMode = 'easy' | 'medium' | 'hard';

interface ListenBrainzArtist {
  artist_name: string;
  listen_count: number;
  artist_mbid?: string;
}

interface ListenBrainzRecommendation {
  recording_mbid: string;
  score?: number;
}

interface ListenBrainzSimilarUser {
  user_name: string;
  similarity: number;
}

interface TopArtistsResponse {
  payload: {
    artists: ListenBrainzArtist[];
    count: number;
    total_artist_count: number;
    range?: string;
    user_id?: string;
  };
}

interface RecommendationsResponse {
  payload: {
    mbids: ListenBrainzRecommendation[];
    count: number;
    user_name?: string;
  };
}

interface SimilarUsersResponse {
  payload: ListenBrainzSimilarUser[];
}

// Fresh Releases response interfaces
interface FreshRelease {
  artist_credit_name: string;
  artist_mbids: string[];
  release_name: string;
  release_mbid: string;
  release_date?: string;
}

interface FreshReleasesResponse {
  payload: {
    releases: FreshRelease[];
  };
}

// Year in Music response interfaces
interface YearInMusicArtist {
  artist_name: string;
  artist_mbid?: string;
  listen_count: number;
}

interface YearInMusicResponse {
  payload: {
    data: {
      top_artists?: YearInMusicArtist[];
      total_listen_count?: number;
    };
  };
}

// Playlist response interfaces
interface PlaylistInfo {
  identifier: string;
  title: string;
  creator: string;
  track_count?: number;
}

interface PlaylistsResponse {
  playlists: Array<{ playlist: PlaylistInfo }>;
  playlist_count: number;
}

interface PlaylistTrack {
  title: string;
  creator: string;
  identifier?: string[];
  extension?: {
    'https://musicbrainz.org/doc/jspf#track'?: {
      artist_identifiers?: string[];
    };
  };
}

interface PlaylistResponse {
  playlist: {
    identifier: string;
    title: string;
    creator: string;
    track: PlaylistTrack[];
  };
}

// Radio response interfaces
interface RadioResponse {
  payload: {
    jspf: {
      playlist: {
        track: PlaylistTrack[];
      };
    };
  };
}

// Loved tracks response interfaces
interface LovedTrackFeedback {
  recording_mbid: string;
  score: number;
  track_metadata?: {
    artist_name?: string;
    track_name?: string;
    mbid_mapping?: {
      artist_mbids?: string[];
    };
  };
}

interface LovedTracksResponse {
  feedback: LovedTrackFeedback[];
  count: number;
  total_count: number;
  offset: number;
}

// Default timeout for API requests (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Valid periods for validation
export const VALID_PERIODS: ListenBrainzPeriod[] = ['week', 'month', 'quarter', 'half_yearly', 'year', 'all_time'];

export class ListenBrainzService {
  private username: string;
  private token?: string;
  private baseUrl = 'https://api.listenbrainz.org';
  private timeoutMs: number;

  constructor(username: string, token?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    if (!username || username.trim() === '') {
      throw new Error('ListenBrainz username is required');
    }
    this.username = username.trim();
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Create a fetch request with timeout and optional authorization
   */
  private async fetchWithTimeout(url: string, useAuth: boolean = true): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };

    if (useAuth && this.token) {
      headers['Authorization'] = `Token ${this.token}`;
    }

    try {
      const response = await fetch(url, { 
        headers, 
        signal: controller.signal 
      });
      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(endpoint: string, useAuth: boolean = true): Promise<T> {
    await rateLimit('listenbrainz');

    const response = await this.fetchWithTimeout(`${this.baseUrl}${endpoint}`, useAuth);

    // Handle empty response bodies
    const text = await response.text();

    if (!response.ok) {
      // Try to extract error message from response body
      try {
        const errorData = JSON.parse(text) as { error?: string; code?: number };
        if (errorData.error) {
          throw new Error(`ListenBrainz API error: ${errorData.error}`);
        }
      } catch {
        // Ignore parse errors, fall through to generic message
      }
      throw new Error(`ListenBrainz API error: ${response.status} ${response.statusText}`);
    }

    if (!text || text.trim() === '') {
      throw new Error(`ListenBrainz API returned empty response for ${endpoint}`);
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`ListenBrainz API returned invalid JSON for ${endpoint}: ${text.substring(0, 100)}`);
    }
  }

  /**
   * Validate if a user exists on ListenBrainz
   * If a token is provided, uses the validate-token endpoint (more reliable)
   * Otherwise, checks if the user profile exists
   * @returns true if user exists, false if not found
   */
  async validateUser(): Promise<boolean> {
    await rateLimit('listenbrainz');

    // If we have a token, use the validate-token endpoint with Authorization header
    // (not in URL to avoid token leakage in logs/caches)
    if (this.token) {
      try {
        const response = await this.fetchWithTimeout(`${this.baseUrl}/1/validate-token`, true);

        if (!response.ok) {
          return false;
        }

        const data = await response.json() as { valid: boolean; user_name?: string };
        
        // Verify username matches the token (case-insensitive)
        if (data.user_name && data.user_name.toLowerCase() !== this.username.toLowerCase()) {
          return false; // Token doesn't match the provided username
        }
        
        return data.valid === true;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('ListenBrainz API request timed out');
        }
        throw error;
      }
    }

    // Without token, try to access user's public statistics
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/1/stats/user/${this.username}/artists?range=all_time&count=1`,
        false
      );

      if (response.status === 404) {
        return false;
      }

      if (!response.ok) {
        throw new Error(`ListenBrainz API error: ${response.status} ${response.statusText}`);
      }

      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('ListenBrainz API request timed out');
      }
      throw error;
    }
  }

  /**
   * Get top artists for the user
   * @param period - Time period for statistics
   * @param count - Number of artists to return (default: 25)
   */
  async getUserTopArtists(
    period: ListenBrainzPeriod,
    count: number = 25
  ): Promise<{
    artists: ListenBrainzArtist[];
    count: number;
    totalArtistCount: number;
  }> {
    const response = await this.request<TopArtistsResponse>(
      `/1/stats/user/${this.username}/artists?range=${period}&count=${count}`
    );

    return {
      artists: response.payload.artists,
      count: response.payload.count,
      totalArtistCount: response.payload.total_artist_count,
    };
  }

  /**
   * Get personalized recommendations for the user
   * @param type - Type of recommendations (top_artist or similar_artist)
   * @param count - Number of recommendations to return (default: 25)
   */
  async getRecommendations(
    type: ListenBrainzRecommendationType,
    count: number = 25
  ): Promise<{
    mbids: ListenBrainzRecommendation[];
    count: number;
  }> {
    const response = await this.request<RecommendationsResponse>(
      `/1/cf/recommendation/user/${this.username}/recording?artist_type=${type}&count=${count}`
    );

    return {
      mbids: response.payload.mbids,
      count: response.payload.count,
    };
  }

  /**
   * Get users with similar listening habits
   */
  async getSimilarUsers(): Promise<ListenBrainzSimilarUser[]> {
    const response = await this.request<SimilarUsersResponse>(
      `/1/user/${this.username}/similar-users`
    );

    return response.payload;
  }

  /**
   * Get fresh/trending releases from ListenBrainz explore
   * Returns popular new music releases
   */
  async getFreshReleases(): Promise<{ releases: FreshRelease[] }> {
    const response = await this.request<FreshReleasesResponse>(
      '/1/explore/fresh-releases'
    );

    return {
      releases: response.payload.releases,
    };
  }

  /**
   * Get user's year in music statistics
   * @param year - The year to get stats for (defaults to current year)
   */
  async getYearInMusic(year?: number): Promise<{
    topArtists: YearInMusicArtist[];
    totalListenCount?: number;
  }> {
    const targetYear = year ?? new Date().getFullYear();
    const response = await this.request<YearInMusicResponse>(
      `/1/stats/user/${this.username}/year-in-music/${targetYear}`
    );

    return {
      topArtists: response.payload.data.top_artists ?? [],
      totalListenCount: response.payload.data.total_listen_count,
    };
  }

  /**
   * Get user's playlists from ListenBrainz
   */
  async getUserPlaylists(): Promise<{
    playlists: Array<{ title: string; identifier: string; creator: string; track_count?: number }>;
    playlist_count: number;
  }> {
    const response = await this.request<PlaylistsResponse>(
      `/1/user/${this.username}/playlists`
    );

    return {
      playlists: response.playlists.map(p => ({
        title: p.playlist.title,
        identifier: p.playlist.identifier,
        creator: p.playlist.creator,
        track_count: p.playlist.track_count,
      })),
      playlist_count: response.playlist_count,
    };
  }

  /**
   * Get tracks from a specific playlist
   * @param playlistId - The playlist ID (MBID or full URL)
   */
  async getPlaylist(playlistId: string): Promise<{
    title: string;
    tracks: Array<{ artist_name: string; artist_mbid?: string; title: string }>;
  }> {
    const response = await this.request<PlaylistResponse>(
      `/1/playlist/${playlistId}`
    );

    return {
      title: response.playlist.title,
      tracks: response.playlist.track.map(t => {
        // Extract artist MBID from extension URL if available
        const artistMbidUrl = t.extension?.['https://musicbrainz.org/doc/jspf#track']?.artist_identifiers?.[0];
        const artistMbid = artistMbidUrl?.replace('https://musicbrainz.org/artist/', '');
        
        return {
          artist_name: t.creator,
          artist_mbid: artistMbid,
          title: t.title,
        };
      }),
    };
  }

  /**
   * Get artist radio recommendations (similar artists/tracks)
   * @param artistMbid - The seed artist's MusicBrainz ID
   * @param mode - Radio mode: easy, medium, or hard (default: medium)
   */
  async getArtistRadio(
    artistMbid: string,
    mode: ListenBrainzRadioMode = 'medium'
  ): Promise<{
    tracks: Array<{ artist_name: string; artist_mbid?: string; title: string }>;
  }> {
    const prompt = `artist:(${artistMbid})`;
    const response = await this.request<RadioResponse>(
      `/1/explore/lb-radio?prompt=${prompt}&mode=${mode}`
    );

    const tracks = response.payload.jspf.playlist.track.map(t => {
      // Extract artist MBID from extension URL if available
      const artistMbidUrl = t.extension?.['https://musicbrainz.org/doc/jspf#track']?.artist_identifiers?.[0];
      const extractedMbid = artistMbidUrl?.replace('https://musicbrainz.org/artist/', '');
      
      return {
        artist_name: t.creator,
        artist_mbid: extractedMbid,
        title: t.title,
      };
    });

    return { tracks };
  }

  /**
   * Get user's loved/favorited recordings
   * @param count - Number of results to return (optional)
   * @param offset - Offset for pagination (optional)
   */
  async getLovedTracks(
    count?: number,
    offset?: number
  ): Promise<{
    feedback: Array<{ recording_mbid: string; artist_name?: string; artist_mbid?: string }>;
    total_count: number;
  }> {
    let url = `/1/feedback/user/${this.username}/get-feedback?score=1`;
    if (count !== undefined) {
      url += `&count=${count}`;
    }
    if (offset !== undefined) {
      url += `&offset=${offset}`;
    }
    
    const response = await this.request<LovedTracksResponse>(url);

    return {
      feedback: response.feedback.map(f => ({
        recording_mbid: f.recording_mbid,
        artist_name: f.track_metadata?.artist_name,
        artist_mbid: f.track_metadata?.mbid_mapping?.artist_mbids?.[0],
      })),
      total_count: response.total_count,
    };
  }
}
