/**
 * Spotify Service
 * 
 * Handles all interactions with the Spotify API.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

const API_TIMEOUT = 15_000;

interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string | number;
  tokenExpiresAt?: number; // Alternative field name used by connections
}

interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface SpotifyArtist {
  id: string;
  name: string;
  genres: string[];
  images: Array<{ url: string; width: number; height: number }>;
  external_urls: { spotify: string };
}

interface SpotifyTrack {
  id: string;
  name: string;
  artists: SpotifyArtist[];
  album: {
    id: string;
    name: string;
    release_date: string;
    images: Array<{ url: string; width: number; height: number }>;
  };
}

interface SpotifyAlbum {
  id: string;
  name: string;
  release_date: string;
  artists: SpotifyArtist[];
  images: Array<{ url: string; width: number; height: number }>;
}

interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string;
  owner: { display_name: string };
  images: Array<{ url: string }>;
  tracks: { total: number };
}

export class SpotifyService {
  private clientId: string;
  private clientSecret: string;
  private tokens: SpotifyTokens | null = null;
  private onTokenRefresh?: (tokens: SpotifyTokens) => void;
  private refreshPromise: Promise<void> | null = null; // Prevent concurrent refresh

  constructor(config: SpotifyConfig, onTokenRefresh?: (tokens: SpotifyTokens) => void) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.onTokenRefresh = onTokenRefresh;
    
    if (config.accessToken && config.refreshToken) {
      // Handle both expiresAt and tokenExpiresAt field names
      const expiresAtValue = config.expiresAt || config.tokenExpiresAt;
      this.tokens = {
        accessToken: config.accessToken,
        refreshToken: config.refreshToken,
        expiresAt: expiresAtValue ? (typeof expiresAtValue === 'number' ? expiresAtValue : new Date(expiresAtValue).getTime()) : 0,
      };
    }
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const scopes = [
      'user-library-read',
      'user-follow-read',
      'playlist-read-private',
      'playlist-read-collaborative',
    ].join(' ');

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      state,
      scope: scopes,
    });

    return `https://accounts.spotify.com/authorize?${params}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<SpotifyTokens> {
    const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error('Failed to exchange authorization code');
    }

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };
    
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.onTokenRefresh?.(this.tokens);
    return this.tokens;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    // If a refresh is already in progress, wait for it instead of starting another
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    // Start the refresh and store the promise
    this.refreshPromise = this.doRefreshAccessToken();
    
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async doRefreshAccessToken(): Promise<void> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refreshToken,
      }),
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error('Failed to refresh access token');
    }

    const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
    
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    this.onTokenRefresh?.(this.tokens);
  }

  private async request<T>(endpoint: string): Promise<T> {
    if (!this.tokens) {
      throw new Error('Not authenticated with Spotify');
    }

    // Refresh token if expired
    if (Date.now() >= this.tokens.expiresAt - 60000) {
      await this.refreshAccessToken();
    }

    await rateLimit('spotify');

    const response = await fetchWithTimeout(`https://api.spotify.com/v1${endpoint}`, {
      headers: {
        Authorization: `Bearer ${this.tokens.accessToken}`,
      },
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{ success: boolean; user?: string; error?: string }> {
    try {
      const me = await this.request<{ display_name: string }>('/me');
      return { success: true, user: me.display_name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async getLikedSongs(limit: number = 50, offset: number = 0): Promise<{
    items: Array<{ track: SpotifyTrack }>;
    total: number;
    next: string | null;
  }> {
    return this.request(`/me/tracks?limit=${limit}&offset=${offset}`);
  }

  async getAllLikedSongs(): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.getLikedSongs(limit, offset);
      tracks.push(...response.items.map(item => item.track));
      
      if (!response.next) break;
      offset += limit;
    }

    return tracks;
  }

  async getSavedAlbums(limit: number = 50, offset: number = 0): Promise<{
    items: Array<{ album: SpotifyAlbum }>;
    total: number;
    next: string | null;
  }> {
    return this.request(`/me/albums?limit=${limit}&offset=${offset}`);
  }

  async getAllSavedAlbums(): Promise<SpotifyAlbum[]> {
    const albums: SpotifyAlbum[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.getSavedAlbums(limit, offset);
      albums.push(...response.items.map(item => item.album));
      
      if (!response.next) break;
      offset += limit;
    }

    return albums;
  }

  async getFollowedArtists(limit: number = 50, after?: string): Promise<{
    artists: {
      items: SpotifyArtist[];
      next: string | null;
      cursors: { after: string | null };
    };
  }> {
    const params = new URLSearchParams({ type: 'artist', limit: limit.toString() });
    if (after) params.set('after', after);
    return this.request(`/me/following?${params}`);
  }

  async getAllFollowedArtists(): Promise<SpotifyArtist[]> {
    const artists: SpotifyArtist[] = [];
    let after: string | undefined;

    while (true) {
      const response = await this.getFollowedArtists(50, after);
      artists.push(...response.artists.items);
      
      if (!response.artists.cursors.after) break;
      after = response.artists.cursors.after;
    }

    return artists;
  }

  async getPlaylist(playlistId: string): Promise<SpotifyPlaylist> {
    return this.request(`/playlists/${playlistId}`);
  }

  async getPlaylistTracks(playlistId: string, limit: number = 100, offset: number = 0): Promise<{
    items: Array<{ track: SpotifyTrack | null }>;
    total: number;
    next: string | null;
  }> {
    return this.request(`/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}`);
  }

  async getAllPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    let offset = 0;
    const limit = 100;

    while (true) {
      const response = await this.getPlaylistTracks(playlistId, limit, offset);
      tracks.push(...response.items.filter(item => item.track).map(item => item.track!));
      
      if (!response.next) break;
      offset += limit;
    }

    return tracks;
  }

  async getUserPlaylists(limit: number = 50, offset: number = 0): Promise<{
    items: SpotifyPlaylist[];
    total: number;
    next: string | null;
  }> {
    return this.request(`/me/playlists?limit=${limit}&offset=${offset}`);
  }

  /**
   * Get all user playlists (paginated)
   */
  async getAllUserPlaylists(): Promise<SpotifyPlaylist[]> {
    const playlists: SpotifyPlaylist[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.getUserPlaylists(limit, offset);
      playlists.push(...response.items);
      
      if (!response.next) break;
      offset += limit;
    }

    return playlists;
  }

  /**
   * Find a Spotify-generated personalized playlist by name pattern
   * Returns the playlist if found, null otherwise
   */
  async findSpotifyPlaylistByName(namePattern: string | RegExp): Promise<SpotifyPlaylist | null> {
    const playlists = await this.getAllUserPlaylists();
    
    return playlists.find(p => {
      // Spotify-generated playlists are owned by 'spotify'
      const isSpotifyOwned = p.owner.display_name?.toLowerCase() === 'spotify';
      const nameMatches = typeof namePattern === 'string'
        ? p.name.toLowerCase().includes(namePattern.toLowerCase())
        : namePattern.test(p.name);
      return isSpotifyOwned && nameMatches;
    }) || null;
  }

  /**
   * Find all Spotify-generated playlists matching a name pattern
   */
  async findSpotifyPlaylistsByPattern(namePattern: RegExp): Promise<SpotifyPlaylist[]> {
    const playlists = await this.getAllUserPlaylists();
    
    return playlists.filter(p => {
      const isSpotifyOwned = p.owner.display_name?.toLowerCase() === 'spotify';
      return isSpotifyOwned && namePattern.test(p.name);
    });
  }

  /**
   * Get Discover Weekly playlist tracks
   * Note: Must be followed/saved in user's library to be accessible
   */
  async getDiscoverWeeklyTracks(): Promise<SpotifyTrack[]> {
    const playlist = await this.findSpotifyPlaylistByName('Discover Weekly');
    if (!playlist) {
      throw new Error(
        'Discover Weekly playlist not found in your library. ' +
        'You must follow/save this playlist in Spotify (click the heart icon) for the API to access it. ' +
        'Alternatively, use "Liked Songs" or "Followed Artists" subscription types.'
      );
    }
    return this.getAllPlaylistTracks(playlist.id);
  }

  /**
   * Get Release Radar playlist tracks
   */
  async getReleaseRadarTracks(): Promise<SpotifyTrack[]> {
    const playlist = await this.findSpotifyPlaylistByName('Release Radar');
    if (!playlist) {
      throw new Error(
        'Release Radar playlist not found in your library. ' +
        'You must follow/save this playlist in Spotify (click the heart icon) for the API to access it. ' +
        'Alternatively, use "Liked Songs" or "Followed Artists" subscription types.'
      );
    }
    return this.getAllPlaylistTracks(playlist.id);
  }

  /**
   * Get all Daily Mix playlist tracks combined
   * Note: Daily Mix playlists must be in user's library (followed) to be accessible via API
   */
  async getDailyMixTracks(): Promise<SpotifyTrack[]> {
    // Try Spotify-owned first, then fall back to any Daily Mix pattern
    let playlists = await this.findSpotifyPlaylistsByPattern(/^Daily Mix \d+$/i);
    
    if (playlists.length === 0) {
      // Maybe user has manually saved Daily Mix or it has different owner
      // Use looser pattern to catch saved copies like "Daily Mix 6 4-10-2021"
      const allPlaylists = await this.getAllUserPlaylists();
      playlists = allPlaylists.filter(p => /Daily Mix \d+/i.test(p.name));
    }
    
    if (playlists.length === 0) {
      throw new Error(
        'No Daily Mix playlists found in your library. ' +
        'Daily Mix playlists must be explicitly added to your library (click the heart/follow button on the playlist in Spotify) ' +
        'for the API to access them. Alternatively, try using "Saved Tracks" or "Followed Artists" subscription types.'
      );
    }
    
    const allTracks: SpotifyTrack[] = [];
    for (const playlist of playlists) {
      const tracks = await this.getAllPlaylistTracks(playlist.id);
      allTracks.push(...tracks);
    }
    
    // Deduplicate by track ID
    const seen = new Set<string>();
    return allTracks.filter(track => {
      if (seen.has(track.id)) return false;
      seen.add(track.id);
      return true;
    });
  }

  /**
   * Get On Repeat playlist tracks
   */
  async getOnRepeatTracks(): Promise<SpotifyTrack[]> {
    const playlist = await this.findSpotifyPlaylistByName('On Repeat');
    if (!playlist) {
      throw new Error(
        'On Repeat playlist not found in your library. ' +
        'You must follow/save this playlist in Spotify (click the heart icon) for the API to access it. ' +
        'Alternatively, use "Liked Songs" or "Followed Artists" subscription types.'
      );
    }
    return this.getAllPlaylistTracks(playlist.id);
  }

  /**
   * Get new album releases from Spotify Browse API
   */
  async getNewReleases(limit: number = 50, offset: number = 0, country?: string): Promise<{
    albums: {
      items: SpotifyAlbum[];
      total: number;
      next: string | null;
    };
  }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (country) params.set('country', country);
    return this.request(`/browse/new-releases?${params.toString()}`);
  }

  /**
   * Get all new releases (paginated)
   */
  async getAllNewReleases(maxAlbums: number = 100, country?: string): Promise<SpotifyAlbum[]> {
    const albums: SpotifyAlbum[] = [];
    let offset = 0;
    const limit = 50;

    while (albums.length < maxAlbums) {
      const response = await this.getNewReleases(limit, offset, country);
      albums.push(...response.albums.items);
      
      if (!response.albums.next || albums.length >= maxAlbums) break;
      offset += limit;
    }

    return albums.slice(0, maxAlbums);
  }

  /**
   * Get Spotify featured playlists
   */
  async getFeaturedPlaylists(limit: number = 50, offset: number = 0, locale?: string): Promise<{
    playlists: {
      items: SpotifyPlaylist[];
      total: number;
      next: string | null;
    };
  }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (locale) params.set('locale', locale);
    return this.request(`/browse/featured-playlists?${params.toString()}`);
  }

  /**
   * Get artists from featured playlists
   */
  async getFeaturedPlaylistsArtists(limit: number = 50): Promise<SpotifyArtist[]> {
    const response = await this.getFeaturedPlaylists(10);
    const artistMap = new Map<string, SpotifyArtist>();

    for (const playlist of response.playlists.items.slice(0, 5)) {
      try {
        const tracks = await this.getAllPlaylistTracks(playlist.id);
        for (const track of tracks.slice(0, limit)) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, artist);
            }
          }
        }
      } catch {
        // Skip playlists that fail
      }
    }

    return Array.from(artistMap.values()).slice(0, limit);
  }

  /**
   * Get browse categories
   */
  async getCategories(limit: number = 50, offset: number = 0, locale?: string): Promise<{
    categories: {
      items: Array<{ id: string; name: string; icons: Array<{ url: string }> }>;
      total: number;
      next: string | null;
    };
  }> {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
    });
    if (locale) params.set('locale', locale);
    return this.request(`/browse/categories?${params.toString()}`);
  }

  /**
   * Get playlists for a category
   */
  async getCategoryPlaylists(categoryId: string, limit: number = 20): Promise<{
    playlists: {
      items: SpotifyPlaylist[];
      total: number;
    };
  }> {
    return this.request(`/browse/categories/${categoryId}/playlists?limit=${limit}`);
  }

  /**
   * Get artists from a category's playlists
   */
  async getCategoryArtists(categoryId: string, limit: number = 50): Promise<SpotifyArtist[]> {
    const response = await this.getCategoryPlaylists(categoryId, 5);
    const artistMap = new Map<string, SpotifyArtist>();

    for (const playlist of response.playlists.items) {
      try {
        const tracks = await this.getAllPlaylistTracks(playlist.id);
        for (const track of tracks.slice(0, 50)) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, artist);
            }
          }
        }
      } catch {
        // Skip playlists that fail
      }
    }

    return Array.from(artistMap.values()).slice(0, limit);
  }

  /**
   * Search for artists by name
   */
  async searchArtists(query: string, limit: number = 10): Promise<Array<{
    id: string;
    name: string;
    popularity: number;
    genres: string[];
    imageUrl: string | null;
    followers: number;
  }>> {
    const params = new URLSearchParams({
      q: query,
      type: 'artist',
      limit: Math.min(limit, 10).toString(),
    });
    
    const response = await this.request<{
      artists: {
        items: Array<SpotifyArtist & { popularity?: number; followers?: { total: number } }>;
      };
    }>(`/search?${params}`);
    
    return response.artists.items.map(artist => ({
      id: artist.id,
      name: artist.name,
      popularity: artist.popularity || 0,
      genres: artist.genres || [],
      imageUrl: artist.images?.[0]?.url || null,
      followers: artist.followers?.total || 0,
    }));
  }
}
