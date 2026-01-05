/**
 * Jellyfin Service
 * 
 * Handles interactions with Jellyfin API for listening history.
 */

import { rateLimit } from './rate-limiter.js';

export interface JellyfinConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId?: string;
  jellyfinLibraryId?: string;
}

export interface JellyfinUser {
  userId: string;
  username: string;
  isAdmin: boolean;
}

export interface JellyfinLibrary {
  libraryId: string;
  name: string;
  type: string;
}

export interface JellyfinArtist {
  name: string;
  playCount: number;
  lastPlayed?: Date;
  thumb?: string;
}

export class JellyfinService {
  constructor() {}

  async testConnection(config: JellyfinConfig): Promise<{ success: boolean; error?: string; serverName?: string }> {
    try {
      const response = await this.callApi<{ ServerName: string; Version: string }>(
        config,
        '/System/Info/Public'
      );
      return { success: true, serverName: response.ServerName };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      };
    }
  }

  async getUsers(config: JellyfinConfig): Promise<JellyfinUser[]> {
    interface JellyfinUserResponse {
      Id: string;
      Name: string;
      Policy: { IsAdministrator: boolean };
    }

    const users = await this.callApi<JellyfinUserResponse[]>(config, '/Users');
    
    return users.map(user => ({
      userId: user.Id,
      username: user.Name,
      isAdmin: user.Policy?.IsAdministrator ?? false,
    }));
  }

  async getLibraries(config: JellyfinConfig): Promise<JellyfinLibrary[]> {
    interface JellyfinLibraryResponse {
      ItemId: string;
      Name: string;
      CollectionType: string;
    }

    const libraries = await this.callApi<JellyfinLibraryResponse[]>(
      config,
      '/Library/VirtualFolders'
    );
    
    return libraries
      .filter(lib => lib.CollectionType === 'music')
      .map(lib => ({
        libraryId: lib.ItemId,
        name: lib.Name,
        type: lib.CollectionType,
      }));
  }

  async getTopArtists(
    config: JellyfinConfig,
    options: { period: 'week' | 'month' | 'year' | 'all'; limit?: number }
  ): Promise<JellyfinArtist[]> {
    if (!config.jellyfinUserId) {
      throw new Error('Jellyfin user ID is required to fetch listening history');
    }

    const limit = options.limit || 25;
    const minDate = this.periodToDate(options.period);

    // Jellyfin tracks play counts on Audio items (songs), not on Artists directly.
    // We need to query played Audio items and aggregate by artist name.
    interface JellyfinItemsResponse {
      Items: Array<{
        Id: string;
        Name: string;
        AlbumArtist?: string;
        Artists?: string[];
        UserData?: { PlayCount?: number; LastPlayedDate?: string; Played?: boolean };
        ImageTags?: { Primary?: string };
      }>;
      TotalRecordCount: number;
    }

    const params: Record<string, string> = {
      userId: config.jellyfinUserId,
      IncludeItemTypes: 'Audio',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Recursive: 'true',
      IsPlayed: 'true',  // Only items that have been played
      Limit: '500',  // Get more tracks to aggregate artists from
      Fields: 'UserData',
    };

    if (config.jellyfinLibraryId) {
      params.ParentId = config.jellyfinLibraryId;
    }

    if (minDate) {
      params.MinDateLastPlayed = minDate.toISOString();
    }

    const response = await this.callApi<JellyfinItemsResponse>(
      config,
      `/Users/${config.jellyfinUserId}/Items`,
      params
    );

    // Aggregate play counts by artist
    const artistPlayCounts = new Map<string, { playCount: number; lastPlayed?: Date }>();
    
    for (const item of response.Items) {
      // Get artist name - prefer AlbumArtist, fall back to first artist
      const artistName = item.AlbumArtist || item.Artists?.[0];
      if (!artistName) continue;

      const playCount = item.UserData?.PlayCount || 1;
      const lastPlayed = item.UserData?.LastPlayedDate 
        ? new Date(item.UserData.LastPlayedDate) 
        : undefined;

      const existing = artistPlayCounts.get(artistName);
      if (existing) {
        existing.playCount += playCount;
        // Keep the most recent play date
        if (lastPlayed && (!existing.lastPlayed || lastPlayed > existing.lastPlayed)) {
          existing.lastPlayed = lastPlayed;
        }
      } else {
        artistPlayCounts.set(artistName, { playCount, lastPlayed });
      }
    }

    // Sort by play count and return top artists
    return Array.from(artistPlayCounts.entries())
      .map(([name, data]) => ({
        name,
        playCount: data.playCount,
        lastPlayed: data.lastPlayed,
      }))
      .sort((a, b) => b.playCount - a.playCount)
      .slice(0, limit);
  }

  private periodToDate(period: string): Date | null {
    const now = new Date();
    switch (period) {
      case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case 'month': return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case 'year': return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      case 'all': return null;
      default: return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }

  private async callApi<T>(config: JellyfinConfig, endpoint: string, params?: Record<string, string>): Promise<T> {
    await rateLimit('jellyfin');

    const url = new URL(endpoint, config.jellyfinUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: {
        'X-Emby-Token': config.jellyfinApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`Jellyfin API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }
}
