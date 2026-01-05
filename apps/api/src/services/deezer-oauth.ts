/**
 * Deezer OAuth Service
 * 
 * Handles OAuth authentication and API interactions with Deezer.
 * Documentation: https://developers.deezer.com/api
 */

import { rateLimit } from './rate-limiter.js';

interface DeezerConfig {
  appId: string;
  appSecret: string;
  accessToken?: string;
}

interface DeezerTokens {
  accessToken: string;
  expiresAt: number; // Deezer tokens can be long-lived
}

interface DeezerArtist {
  id: number;
  name: string;
  picture?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_album?: number;
  nb_fan?: number;
}

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  artist: DeezerArtist;
  album: {
    id: number;
    title: string;
    cover?: string;
    cover_medium?: string;
    cover_big?: string;
  };
  timestamp?: number; // For history items
}

interface DeezerAlbum {
  id: number;
  title: string;
  artist: DeezerArtist;
  cover?: string;
  cover_medium?: string;
  cover_big?: string;
  release_date?: string;
  nb_tracks?: number;
}

interface DeezerPlaylist {
  id: number;
  title: string;
  description?: string;
  picture?: string;
  picture_medium?: string;
  nb_tracks: number;
  creator: {
    id: number;
    name: string;
  };
}

interface DeezerUser {
  id: number;
  name: string;
  email?: string;
  picture?: string;
  picture_medium?: string;
  country?: string;
}

export class DeezerOAuthService {
  private appId: string;
  private appSecret: string;
  private tokens: DeezerTokens | null = null;
  private onTokenRefresh?: (tokens: DeezerTokens) => void;

  constructor(config: DeezerConfig, onTokenRefresh?: (tokens: DeezerTokens) => void) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.onTokenRefresh = onTokenRefresh;
    
    if (config.accessToken) {
      this.tokens = {
        accessToken: config.accessToken,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000, // Deezer tokens are long-lived
      };
    }
  }

  /**
   * Generate OAuth authorization URL
   * Scopes: basic_access, email, offline_access, manage_library, listening_history
   */
  getAuthUrl(redirectUri: string, state: string): string {
    const perms = [
      'basic_access',
      'email',
      'offline_access',
      'manage_library',
      'listening_history',
    ].join(',');

    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: redirectUri,
      perms,
      state,
    });

    return `https://connect.deezer.com/oauth/auth.php?${params}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCode(code: string): Promise<DeezerTokens> {
    const params = new URLSearchParams({
      app_id: this.appId,
      secret: this.appSecret,
      code,
      output: 'json',
    });

    const response = await fetch(`https://connect.deezer.com/oauth/access_token.php?${params}`);
    
    if (!response.ok) {
      throw new Error('Failed to exchange authorization code');
    }

    const data = await response.json() as { access_token?: string; expires?: number; error?: { message: string } };
    
    if (data.error) {
      throw new Error(data.error.message || 'Failed to get access token');
    }

    if (!data.access_token) {
      throw new Error('No access token in response');
    }

    this.tokens = {
      accessToken: data.access_token,
      // Deezer tokens with offline_access permission don't expire
      expiresAt: data.expires ? Date.now() + data.expires * 1000 : Date.now() + 365 * 24 * 60 * 60 * 1000,
    };

    this.onTokenRefresh?.(this.tokens);
    return this.tokens;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(endpoint: string): Promise<T> {
    if (!this.tokens) {
      throw new Error('Not authenticated with Deezer');
    }

    await rateLimit('deezer');

    const url = `https://api.deezer.com${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${this.tokens.accessToken}`;
    
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Deezer API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as T & { error?: { type: string; message: string; code: number } };
    
    if (data.error) {
      throw new Error(data.error.message || 'Deezer API error');
    }

    return data;
  }

  /**
   * Test connection by getting current user
   */
  async testConnection(): Promise<{ success: boolean; user?: string; error?: string }> {
    try {
      const me = await this.request<DeezerUser>('/user/me');
      return { success: true, user: me.name };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Get current user profile
   */
  async getMe(): Promise<DeezerUser> {
    return this.request<DeezerUser>('/user/me');
  }

  // LISTENING HISTORY

  /**
   * Get user's listening history (recently played tracks)
   */
  async getListeningHistory(limit: number = 50): Promise<{ data: DeezerTrack[]; total: number }> {
    const data = await this.request<{ data: DeezerTrack[]; total: number }>(`/user/me/history?limit=${limit}`);
    return data;
  }

  /**
   * Get all listening history with pagination
   */
  async getAllListeningHistory(): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    let index = 0;
    const limit = 50;

    while (true) {
      const response = await this.request<{ data: DeezerTrack[]; next?: string }>(`/user/me/history?limit=${limit}&index=${index}`);
      tracks.push(...response.data);
      
      if (!response.next || response.data.length < limit) break;
      index += limit;
      
      // Safety limit
      if (tracks.length >= 500) break;
    }

    return tracks;
  }

  // FAVORITES (LOVED TRACKS)

  /**
   * Get user's favorite/loved tracks
   */
  async getFavoriteTracks(limit: number = 50): Promise<{ data: DeezerTrack[]; total: number }> {
    return this.request<{ data: DeezerTrack[]; total: number }>(`/user/me/tracks?limit=${limit}`);
  }

  /**
   * Get all favorite tracks with pagination
   */
  async getAllFavoriteTracks(): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    let index = 0;
    const limit = 50;

    while (true) {
      const response = await this.request<{ data: DeezerTrack[]; next?: string }>(`/user/me/tracks?limit=${limit}&index=${index}`);
      tracks.push(...response.data);
      
      if (!response.next || response.data.length < limit) break;
      index += limit;
    }

    return tracks;
  }

  /**
   * Get user's favorite albums
   */
  async getFavoriteAlbums(limit: number = 50): Promise<{ data: DeezerAlbum[]; total: number }> {
    return this.request<{ data: DeezerAlbum[]; total: number }>(`/user/me/albums?limit=${limit}`);
  }

  /**
   * Get user's favorite artists
   */
  async getFavoriteArtists(limit: number = 50): Promise<{ data: DeezerArtist[]; total: number }> {
    return this.request<{ data: DeezerArtist[]; total: number }>(`/user/me/artists?limit=${limit}`);
  }

  // PLAYLISTS

  /**
   * Get user's playlists
   */
  async getPlaylists(limit: number = 50): Promise<{ data: DeezerPlaylist[]; total: number }> {
    return this.request<{ data: DeezerPlaylist[]; total: number }>(`/user/me/playlists?limit=${limit}`);
  }

  /**
   * Get all user playlists
   */
  async getAllPlaylists(): Promise<DeezerPlaylist[]> {
    const playlists: DeezerPlaylist[] = [];
    let index = 0;
    const limit = 50;

    while (true) {
      const response = await this.request<{ data: DeezerPlaylist[]; next?: string }>(`/user/me/playlists?limit=${limit}&index=${index}`);
      playlists.push(...response.data);
      
      if (!response.next || response.data.length < limit) break;
      index += limit;
    }

    return playlists;
  }

  /**
   * Get tracks from a specific playlist
   */
  async getPlaylistTracks(playlistId: string, limit: number = 50): Promise<{ data: DeezerTrack[]; total: number }> {
    return this.request<{ data: DeezerTrack[]; total: number }>(`/playlist/${playlistId}/tracks?limit=${limit}`);
  }

  /**
   * Get all tracks from a playlist
   */
  async getAllPlaylistTracks(playlistId: string): Promise<DeezerTrack[]> {
    const tracks: DeezerTrack[] = [];
    let index = 0;
    const limit = 50;

    while (true) {
      const response = await this.request<{ data: DeezerTrack[]; next?: string }>(`/playlist/${playlistId}/tracks?limit=${limit}&index=${index}`);
      tracks.push(...response.data);
      
      if (!response.next || response.data.length < limit) break;
      index += limit;
    }

    return tracks;
  }

  // FLOW (PERSONALIZED RECOMMENDATIONS)

  /**
   * Get user's personalized Flow recommendations
   */
  async getFlow(limit: number = 50): Promise<{ data: DeezerTrack[] }> {
    return this.request<{ data: DeezerTrack[] }>(`/user/me/flow?limit=${limit}`);
  }

  // CHARTS

  /**
   * Get top charts (global or by genre)
   */
  async getChartTracks(limit: number = 50): Promise<{ data: DeezerTrack[]; total: number }> {
    return this.request<{ data: DeezerTrack[]; total: number }>(`/chart/0/tracks?limit=${limit}`);
  }

  /**
   * Get chart artists
   */
  async getChartArtists(limit: number = 50): Promise<{ data: DeezerArtist[]; total: number }> {
    return this.request<{ data: DeezerArtist[]; total: number }>(`/chart/0/artists?limit=${limit}`);
  }

  /**
   * Get chart albums
   */
  async getChartAlbums(limit: number = 50): Promise<{ data: DeezerAlbum[]; total: number }> {
    return this.request<{ data: DeezerAlbum[]; total: number }>(`/chart/0/albums?limit=${limit}`);
  }

  // RECOMMENDATIONS

  /**
   * Get track recommendations based on user profile
   */
  async getRecommendedTracks(limit: number = 50): Promise<{ data: DeezerTrack[] }> {
    return this.request<{ data: DeezerTrack[] }>(`/user/me/recommendations/tracks?limit=${limit}`);
  }

  /**
   * Get album recommendations
   */
  async getRecommendedAlbums(limit: number = 50): Promise<{ data: DeezerAlbum[] }> {
    return this.request<{ data: DeezerAlbum[] }>(`/user/me/recommendations/albums?limit=${limit}`);
  }

  /**
   * Get artist recommendations
   */
  async getRecommendedArtists(limit: number = 50): Promise<{ data: DeezerArtist[] }> {
    return this.request<{ data: DeezerArtist[] }>(`/user/me/recommendations/artists?limit=${limit}`);
  }

  // ARTIST RADIO

  /**
   * Get artist radio (similar tracks)
   */
  async getArtistRadio(artistId: number, limit: number = 50): Promise<{ data: DeezerTrack[] }> {
    return this.request<{ data: DeezerTrack[] }>(`/artist/${artistId}/radio?limit=${limit}`);
  }

  // SEARCH (no auth required but included for completeness)

  /**
   * Search for artists
   */
  async searchArtists(query: string, limit: number = 25): Promise<{ data: DeezerArtist[]; total: number }> {
    return this.request<{ data: DeezerArtist[]; total: number }>(`/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  /**
   * Search for tracks
   */
  async searchTracks(query: string, limit: number = 25): Promise<{ data: DeezerTrack[]; total: number }> {
    return this.request<{ data: DeezerTrack[]; total: number }>(`/search/track?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  /**
   * Search for albums
   */
  async searchAlbums(query: string, limit: number = 25): Promise<{ data: DeezerAlbum[]; total: number }> {
    return this.request<{ data: DeezerAlbum[]; total: number }>(`/search/album?q=${encodeURIComponent(query)}&limit=${limit}`);
  }
}

// Re-export the image helper from original deezer.ts for backward compatibility
export { fetchDeezerArtistImage, fetchDeezerArtistImages } from './deezer.js';
