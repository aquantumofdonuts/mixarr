/**
 * Tautulli Service
 * 
 * Handles all interactions with the Tautulli API for Plex listening history.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { validateServiceUrl } from '../lib/validate-service-url.js';

export interface TautulliConfig {
  tautulliUrl: string;
  tautulliApiKey: string;
  plexLibraryId?: number;
  plexUserId?: number;
}

export interface PlexUser {
  userId: number;
  username: string;
  friendlyName: string;
  thumb?: string;
  isAdmin: boolean;
}

export interface PlexLibrary {
  sectionId: number;
  sectionName: string;
  sectionType: string;
  count: number;
}

export interface PlexArtist {
  name: string;
  playCount: number;
  lastPlayed?: Date;
  thumb?: string;
}

interface TautulliResponse<T> {
  response: {
    result: string;
    message?: string;
    data: T;
  };
}

interface TautulliHistoryData {
  recordsFiltered: number;
  recordsTotal: number;
  data: Array<{
    grandparent_title: string;
    parent_title?: string;
    title: string;
    plays?: number;
    play_count?: number;
    stopped?: number;
    grandparent_thumb?: string;
  }>;
}

interface TautulliLibraryData {
  section_id: number;
  section_name: string;
  section_type: string;
  count: number;
}

interface TautulliUserData {
  user_id: number;
  username: string;
  friendly_name: string;
  thumb?: string;
  is_admin: number;
}

export class TautulliService {
  /**
   * Test connection to Tautulli API
   */
  async testConnection(config: TautulliConfig): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await this.callApi<{ message: string }>(config, 'arnold', {});
      if (response.response.result === 'success') {
        return { success: true };
      }
      return { success: false, error: response.response.message || 'Unknown error' };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  /**
   * Get list of Plex users from Tautulli
   */
  async getUsers(config: TautulliConfig): Promise<PlexUser[]> {
    const response = await this.callApi<TautulliUserData[]>(config, 'get_users', {});
    
    if (!response.response.data || !Array.isArray(response.response.data)) {
      return [];
    }

    return response.response.data.map(user => ({
      userId: user.user_id,
      username: user.username,
      friendlyName: user.friendly_name || user.username,
      thumb: user.thumb,
      isAdmin: user.is_admin === 1
    }));
  }

  /**
   * Get list of Plex libraries (filtered to music type)
   */
  async getLibraries(config: TautulliConfig): Promise<PlexLibrary[]> {
    const response = await this.callApi<TautulliLibraryData[]>(config, 'get_libraries', {});
    
    if (!response.response.data || !Array.isArray(response.response.data)) {
      return [];
    }

    // Filter to music libraries only (section_type = 'artist' or 'music')
    return response.response.data
      .filter(lib => lib.section_type === 'artist' || lib.section_type === 'music')
      .map(lib => ({
        sectionId: lib.section_id,
        sectionName: lib.section_name,
        sectionType: lib.section_type,
        count: lib.count
      }));
  }

  /**
   * Get top artists from listening history for a specific user
   */
  async getTopArtists(
    config: TautulliConfig,
    options: { period: 'week' | 'month' | 'year' | 'all'; limit?: number }
  ): Promise<PlexArtist[]> {
    if (!config.plexUserId) {
      throw new Error('Plex user ID is required to fetch listening history');
    }

    const afterTimestamp = this.periodToTimestamp(options.period);
    const limit = options.limit || 25;

    // Fetch history grouped by artist
    const params: Record<string, string> = {
      user_id: config.plexUserId.toString(),
      media_type: 'track',
      order_column: 'plays',
      order_dir: 'desc',
      length: (limit * 10).toString(), // Fetch more to account for grouping
    };

    if (config.plexLibraryId) {
      params.section_id = config.plexLibraryId.toString();
    }

    if (afterTimestamp > 0) {
      params.after = afterTimestamp.toString();
    }

    const response = await this.callApi<TautulliHistoryData>(config, 'get_history', params);
    
    if (!response.response.data?.data || !Array.isArray(response.response.data.data)) {
      return [];
    }

    // Aggregate by artist (grandparent_title)
    const artistMap = new Map<string, { playCount: number; lastPlayed?: number; thumb?: string }>();
    
    for (const row of response.response.data.data) {
      const artistName = row.grandparent_title;
      if (!artistName) continue;

      const existing = artistMap.get(artistName);
      const playCount = row.plays || row.play_count || 1;
      
      if (existing) {
        existing.playCount += playCount;
        if (row.stopped && (!existing.lastPlayed || row.stopped > existing.lastPlayed)) {
          existing.lastPlayed = row.stopped;
        }
      } else {
        artistMap.set(artistName, {
          playCount,
          lastPlayed: row.stopped,
          thumb: row.grandparent_thumb
        });
      }
    }

    // Sort by play count and return top N
    return Array.from(artistMap.entries())
      .sort((a, b) => b[1].playCount - a[1].playCount)
      .slice(0, limit)
      .map(([name, data]) => ({
        name,
        playCount: data.playCount,
        lastPlayed: data.lastPlayed ? new Date(data.lastPlayed * 1000) : undefined,
        thumb: data.thumb
      }));
  }

  /**
   * Convert period string to Unix timestamp
   */
  private periodToTimestamp(period: string): number {
    const now = Math.floor(Date.now() / 1000);
    switch (period) {
      case 'week': return now - (7 * 24 * 60 * 60);
      case 'month': return now - (30 * 24 * 60 * 60);
      case 'year': return now - (365 * 24 * 60 * 60);
      case 'all': return 0;
      default: return now - (30 * 24 * 60 * 60);
    }
  }

  /**
   * Make a request to the Tautulli API
   */
  private async callApi<T>(
    config: TautulliConfig,
    cmd: string,
    params: Record<string, string>
  ): Promise<TautulliResponse<T>> {
    await rateLimit('tautulli');

    const validatedBase = validateServiceUrl(config.tautulliUrl, 'Tautulli');
    const url = new URL('/api/v2', validatedBase);
    url.searchParams.set('apikey', config.tautulliApiKey);
    url.searchParams.set('cmd', cmd);
    
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const response = await fetchWithTimeout(url.toString());

    if (!response.ok) {
      throw new Error(`Tautulli API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as TautulliResponse<T>;
    
    if (data.response.result !== 'success') {
      throw new Error(`Tautulli API error: ${data.response.message || 'Unknown error'}`);
    }

    return data;
  }
}
