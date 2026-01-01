/**
 * Lidarr Service
 * 
 * Handles all interactions with the Lidarr API.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Lidarr');

interface LidarrConfig {
  url: string;
  apiKey: string;
}

export interface LidarrArtist {
  id: number;
  artistName: string;
  foreignArtistId: string;
  monitored: boolean;
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  path?: string;
  overview?: string;
  artistType?: string;
  disambiguation?: string;
  genres?: string[];
  images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
  ratings?: { votes: number; value: number };
  statistics?: {
    albumCount: number;
    trackCount: number;
    trackFileCount: number;
    sizeOnDisk: number;
  };
}

interface LidarrSearchResult {
  foreignArtistId: string;
  artistName: string;
  overview?: string;
  images?: Array<{ coverType: string; url: string }>;
}

interface LidarrAlbumSearchResult {
  foreignAlbumId: string;
  title: string;
  artistName?: string;
  artist?: { foreignArtistId: string; artistName: string };
  releaseDate?: string;
  albumType?: string;
}

export interface LidarrAlbum {
  id: number;
  title: string;
  foreignAlbumId: string;
  artistId: number;
  monitored: boolean;
  albumType?: string;
  releaseDate?: string;
  statistics?: {
    trackCount: number;
    trackFileCount: number;
    percentOfTracks: number;
  };
}

export interface LidarrCommand {
  id: number;
  name: string;
  status: 'queued' | 'started' | 'completed' | 'failed' | 'aborted';
  message?: string;
  started?: string;
  ended?: string;
  stateChangeTime?: string;
}

export interface LidarrTrackFile {
  id: number;
  artistId: number;
  albumId: number;
  path: string;
  size: number;
  quality: {
    quality: {
      id: number;
      name: string;
    };
  };
  mediaInfo?: {
    audioBitrate?: number;
    audioCodec?: string;
    audioChannels?: number;
    audioBits?: number;
    audioSampleRate?: number;
  };
}

export class LidarrService {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number = 3;
  private baseDelay: number = 1000; // 1 second

  constructor(config: LidarrConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.apiKey = config.apiKey;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(status: number): boolean {
    // Retry on 5xx errors (server issues) and 429 (rate limited)
    return status >= 500 || status === 429;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    await rateLimit('lidarr');
    
    const url = `${this.baseUrl}/api/v1${endpoint}`;
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        // Add delay between retries with exponential backoff
        if (attempt > 0) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1) + Math.random() * 500;
          log.debug(`Retry ${attempt}/${this.maxRetries} after ${Math.round(delay)}ms for ${endpoint}`);
          await this.sleep(delay);
          await rateLimit('lidarr'); // Re-acquire rate limit for retry
        }

        const response = await fetch(url, {
          ...options,
          headers: {
            'X-Api-Key': this.apiKey,
            'Content-Type': 'application/json',
            ...options.headers,
          },
        });

        if (!response.ok) {
          // Try to get detailed error message from response body
          let errorDetail = response.statusText || 'Unknown error';
          try {
            const errorBody = await response.text();
            if (errorBody) {
              // Try to parse as JSON first
              try {
                const jsonError = JSON.parse(errorBody);
                errorDetail = jsonError.message || jsonError.error || errorBody;
              } catch {
                errorDetail = errorBody.substring(0, 200); // Truncate long HTML errors
              }
            }
          } catch {
            // Ignore body read errors
          }
          
          // Check if we should retry
          if (this.isRetryableError(response.status) && attempt < this.maxRetries) {
            lastError = new Error(`Lidarr API error: ${response.status} - ${errorDetail}`);
            continue; // Try again
          }
          
          throw new Error(`Lidarr API error: ${response.status} - ${errorDetail}`);
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        // Check if it's a network error (fetch failed) - these are retryable
        const isNetworkError = lastError.message.includes('fetch failed') || 
                               lastError.message.includes('ECONNREFUSED') ||
                               lastError.message.includes('ETIMEDOUT');
        
        if (isNetworkError && attempt < this.maxRetries) {
          continue; // Try again
        }
        
        // If it's a non-retryable error or we've exhausted retries, throw
        if (attempt >= this.maxRetries) {
          throw lastError;
        }
        
        // For non-retryable errors in the middle of attempts, throw immediately
        if (!isNetworkError && !lastError.message.includes('503') && !lastError.message.includes('429')) {
          throw lastError;
        }
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  }

  async testConnection(): Promise<{ success: boolean; version?: string; error?: string }> {
    try {
      const status = await this.request<{ version: string }>('/system/status');
      return { success: true, version: status.version };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Connection failed' 
      };
    }
  }

  async getArtists(): Promise<LidarrArtist[]> {
    return this.request<LidarrArtist[]>('/artist');
  }

  async getArtist(id: number): Promise<LidarrArtist> {
    return this.request<LidarrArtist>(`/artist/${id}`);
  }

  async searchArtist(term: string): Promise<LidarrSearchResult[]> {
    return this.request<LidarrSearchResult[]>(`/artist/lookup?term=${encodeURIComponent(term)}`);
  }

  async searchAlbum(term: string): Promise<LidarrAlbumSearchResult[]> {
    return this.request<LidarrAlbumSearchResult[]>(`/album/lookup?term=${encodeURIComponent(term)}`);
  }

  async addArtist(
    foreignArtistId: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderPath: string,
    monitored: boolean = true,
    searchForMissingAlbums: boolean = true
  ): Promise<LidarrArtist> {
    // Use slower rate limit for add operations to avoid overwhelming Lidarr
    await rateLimit('lidarr_add');
    
    // Search by MBID using lidarr: prefix for exact match
    const searchTerm = `lidarr:${foreignArtistId}`;
    const searchResults = await this.searchArtist(searchTerm);
    let artist = searchResults.find(a => a.foreignArtistId === foreignArtistId);
    
    // If lidarr: prefix didn't work, try searching by the raw MBID
    if (!artist) {
      const rawResults = await this.searchArtist(foreignArtistId);
      artist = rawResults.find(a => a.foreignArtistId === foreignArtistId);
    }
    
    if (!artist) {
      throw new Error(`Artist not found in Lidarr for MBID: ${foreignArtistId}`);
    }

    // Build request body with explicit fields only (matching upstream Python implementation)
    // Don't spread ...artist as search results may contain conflicting/stale fields
    const requestBody = {
      artistName: artist.artistName,
      foreignArtistId: artist.foreignArtistId,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      monitored,
      addOptions: {
        monitor: 'all',
        searchForMissingAlbums: searchForMissingAlbums,
      },
    };
    
    log.info(`Adding artist ${artist.artistName} (MBID: ${foreignArtistId})`);
    log.debug('addOptions', requestBody.addOptions);

    return this.request<LidarrArtist>('/artist', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });
  }

  async getArtistByMbid(mbid: string): Promise<LidarrArtist | null> {
    const artists = await this.getArtists();
    return artists.find(a => a.foreignArtistId === mbid) || null;
  }

  async getAlbums(artistId: number): Promise<LidarrAlbum[]> {
    return this.request<LidarrAlbum[]>(`/album?artistId=${artistId}`);
  }

  async updateAlbum(album: LidarrAlbum): Promise<LidarrAlbum> {
    return this.request<LidarrAlbum>(`/album/${album.id}`, {
      method: 'PUT',
      body: JSON.stringify(album),
    });
  }

  /**
   * Update an artist's metadata in Lidarr.
   * Used by metadata enrichment to push enriched data back to Lidarr.
   * 
   * @param artist - Full artist object with updated fields
   * @returns Updated artist from Lidarr
   */
  async updateArtist(artist: LidarrArtist): Promise<LidarrArtist> {
    return this.request<LidarrArtist>(`/artist/${artist.id}`, {
      method: 'PUT',
      body: JSON.stringify(artist),
    });
  }

  /**
   * Partially update an artist's metadata (fetch current, merge, save).
   * Safer than updateArtist when you only have partial data.
   * 
   * @param artistId - Lidarr artist ID
   * @param updates - Partial metadata to merge
   * @returns Updated artist
   */
  async patchArtist(
    artistId: number,
    updates: Partial<Pick<LidarrArtist, 'overview' | 'genres' | 'images'>>
  ): Promise<LidarrArtist> {
    // Fetch current artist to preserve all fields
    const current = await this.getArtist(artistId);
    
    // Merge updates
    const merged: LidarrArtist = {
      ...current,
      ...updates,
    };

    log.debug(`patchArtist ${artistId}: Sending overview=${merged.overview ? 'YES' : 'NO'}, genres=${merged.genres?.length || 0}, images=${merged.images?.length || 0}`);
    const result = await this.updateArtist(merged);
    log.debug(`patchArtist ${artistId}: Response overview=${result.overview ? 'YES' : 'NO'}, genres=${result.genres?.length || 0}, images=${result.images?.length || 0}`);
    return result;
  }

  async searchAlbumCommand(albumIds: number[]): Promise<{ id: number }> {
    return this.request<{ id: number }>('/command', {
      method: 'POST',
      body: JSON.stringify({
        name: 'AlbumSearch',
        albumIds,
      }),
    });
  }

  /**
   * Trigger a metadata refresh for an artist.
   * This forces Lidarr to re-fetch artist and album data from MusicBrainz.
   * Useful after adding artists to ensure complete metadata is loaded.
   * 
   * Note: Uses artistIds array format to ensure only the specified artist
   * is refreshed (not the entire library).
   */
  async refreshArtist(artistId: number): Promise<LidarrCommand> {
    return this.request<LidarrCommand>('/command', {
      method: 'POST',
      body: JSON.stringify({
        name: 'RefreshArtist',
        artistIds: [artistId],
      }),
    });
  }

  /**
   * Get the status of a Lidarr command by ID.
   */
  async getCommand(commandId: number): Promise<LidarrCommand> {
    return this.request<LidarrCommand>(`/command/${commandId}`);
  }

  /**
   * Wait for a command to complete, polling at intervals.
   * @param commandId - The command ID to wait for
   * @param timeoutMs - Maximum time to wait (default: 30 seconds)
   * @param pollIntervalMs - How often to check status (default: 1 second)
   * @returns The final command status
   */
  async waitForCommand(
    commandId: number, 
    timeoutMs: number = 30000, 
    pollIntervalMs: number = 1000
  ): Promise<LidarrCommand> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const command = await this.getCommand(commandId);
      
      // Terminal states: completed, failed, aborted
      if (command.status === 'completed' || command.status === 'failed' || command.status === 'aborted') {
        return command;
      }
      
      await this.sleep(pollIntervalMs);
    }
    
    throw new Error(`Command ${commandId} did not complete within ${timeoutMs}ms`);
  }

  /**
   * Add an artist to Lidarr.
   * 
   * Note: We previously triggered a metadata refresh after adding, but this
   * caused full library scans due to Lidarr API issues. The addArtist call
   * already fetches metadata from MusicBrainz, so extra refresh is unnecessary.
   */
  async addArtistWithRefresh(
    foreignArtistId: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderPath: string,
    monitored: boolean = true,
    searchForMissingAlbums: boolean = true,
    _waitForRefresh: boolean = false  // Kept for API compatibility, no longer used
  ): Promise<{ artist: LidarrArtist; refreshCommand?: LidarrCommand }> {
    const artist = await this.addArtist(
      foreignArtistId,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath,
      monitored,
      searchForMissingAlbums
    );

    // No longer triggering refresh - Lidarr's addArtist already fetches metadata
    return { artist };
  }

  async addAlbum(
    artistMbid: string,
    albumMbid: string,
    qualityProfileId: number,
    metadataProfileId: number,
    rootFolderPath: string
  ): Promise<{ artist: LidarrArtist; album: LidarrAlbum; isNewArtist: boolean }> {
    // Use slower rate limit for add operations
    await rateLimit('lidarr_add');

    // Step 1: Check if artist exists in Lidarr
    let artist = await this.getArtistByMbid(artistMbid);
    let isNewArtist = false;

    if (!artist) {
      // Step 2: Add artist with monitor: none (don't monitor any albums by default)
      isNewArtist = true;
      
      // Search by MBID using lidarr: prefix for exact match
      const searchTerm = `lidarr:${artistMbid}`;
      let searchResults = await this.searchArtist(searchTerm);
      let artistData = searchResults.find(a => a.foreignArtistId === artistMbid);
      
      // If lidarr: prefix didn't work, try searching by the raw MBID
      if (!artistData) {
        const rawResults = await this.searchArtist(artistMbid);
        artistData = rawResults.find(a => a.foreignArtistId === artistMbid);
      }
      
      if (!artistData) {
        throw new Error(`Artist not found in Lidarr for MBID: ${artistMbid}`);
      }

      artist = await this.request<LidarrArtist>('/artist', {
        method: 'POST',
        body: JSON.stringify({
          ...artistData,
          qualityProfileId,
          metadataProfileId,
          rootFolderPath,
          monitored: true,
          addOptions: {
            monitor: 'none', // Don't monitor any albums by default
            searchForMissingAlbums: false,
          },
        }),
      });

      // Wait for Lidarr to fetch artist metadata (albums list)
      // Lidarr queues a RefreshArtist command when an artist is added
      log.debug('Waiting for artist metadata to be fetched...');
      await this.sleep(2000); // Give Lidarr time to start fetching
    }

    // Step 3: Get albums for the artist and find the target album
    // Retry a few times in case the album list isn't populated yet
    let targetAlbum: LidarrAlbum | undefined;
    const maxRetries = 5;
    const retryDelay = 2000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const albums = await this.getAlbums(artist.id);
      targetAlbum = albums.find(a => a.foreignAlbumId === albumMbid);
      
      if (targetAlbum) {
        break;
      }
      
      if (attempt < maxRetries) {
        log.debug(`Album not found yet, retry ${attempt}/${maxRetries}...`);
        await this.sleep(retryDelay);
      }
    }

    if (!targetAlbum) {
      throw new Error(`Album not found in artist discography for MBID: ${albumMbid}. The album may not exist in MusicBrainz or Lidarr may still be fetching metadata.`);
    }

    // Step 4: Set the album to monitored
    const updatedAlbum = await this.updateAlbum({
      ...targetAlbum,
      monitored: true,
    });

    // Step 5: Trigger search for that album only (if not already downloaded)
    const percentComplete = updatedAlbum.statistics?.percentOfTracks ?? 0;
    if (percentComplete >= 100) {
      log.debug(`Album "${updatedAlbum.title}" already fully downloaded (${percentComplete}%), skipping search`);
    } else {
      log.debug(`Album "${updatedAlbum.title}" at ${percentComplete}% - triggering search`);
      await this.searchAlbumCommand([updatedAlbum.id]);
    }

    return {
      artist,
      album: updatedAlbum,
      isNewArtist,
    };
  }

  async getQualityProfiles(): Promise<Array<{ id: number; name: string }>> {
    return this.request<Array<{ id: number; name: string }>>('/qualityprofile');
  }

  async getMetadataProfiles(): Promise<Array<{ id: number; name: string }>> {
    return this.request<Array<{ id: number; name: string }>>('/metadataprofile');
  }

  async getRootFolders(): Promise<Array<{ id: number; path: string; freeSpace: number }>> {
    return this.request<Array<{ id: number; path: string; freeSpace: number }>>('/rootfolder');
  }

  async artistExists(mbid: string): Promise<boolean> {
    const artists = await this.getArtists();
    return artists.some(a => a.foreignArtistId === mbid);
  }

  async getTrackFilesForArtist(artistId: number): Promise<LidarrTrackFile[]> {
    return this.request<LidarrTrackFile[]>(`/trackfile?artistId=${artistId}`);
  }
}

// Cache for Lidarr library to avoid repeated API calls
export class LidarrCache {
  private artists: Map<string, LidarrArtist> = new Map();
  private lastRefresh: number = 0;
  private refreshInterval: number = 5 * 60 * 1000; // 5 minutes
  private service: LidarrService;

  constructor(service: LidarrService) {
    this.service = service;
  }

  async refresh(): Promise<void> {
    const artists = await this.service.getArtists();
    this.artists.clear();
    
    for (const artist of artists) {
      this.artists.set(artist.foreignArtistId, artist);
      // Also index by normalized name
      this.artists.set(this.normalizeName(artist.artistName), artist);
    }
    
    this.lastRefresh = Date.now();
  }

  private normalizeName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  async exists(options: { mbid?: string; name?: string }): Promise<boolean> {
    if (Date.now() - this.lastRefresh > this.refreshInterval) {
      await this.refresh();
    }

    if (options.mbid) {
      return this.artists.has(options.mbid);
    }

    if (options.name) {
      return this.artists.has(this.normalizeName(options.name));
    }

    return false;
  }

  async get(options: { mbid?: string; name?: string }): Promise<LidarrArtist | undefined> {
    if (Date.now() - this.lastRefresh > this.refreshInterval) {
      await this.refresh();
    }

    if (options.mbid) {
      return this.artists.get(options.mbid);
    }

    if (options.name) {
      return this.artists.get(this.normalizeName(options.name));
    }

    return undefined;
  }

  clear(): void {
    this.artists.clear();
    this.lastRefresh = 0;
  }
}
