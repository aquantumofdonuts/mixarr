/**
 * Last.fm Service
 * 
 * Handles all interactions with the Last.fm API.
 */

import { rateLimit } from './rate-limiter.js';

interface LastfmConfig {
  apiKey: string;
}

interface LastfmArtist {
  name: string;
  mbid?: string;
  url: string;
  playcount?: string;
  listeners?: string;
  image?: Array<{ '#text': string; size: string }>;
}

interface LastfmTrack {
  name: string;
  artist: { name: string; mbid?: string };
  mbid?: string;
  url: string;
  playcount?: string;
  listeners?: string;
}

export class LastfmService {
  private apiKey: string;
  private baseUrl = 'https://ws.audioscrobbler.com/2.0/';

  constructor(config: LastfmConfig) {
    this.apiKey = config.apiKey;
  }

  private async request<T>(method: string, params: Record<string, string> = {}): Promise<T> {
    await rateLimit('lastfm');

    const searchParams = new URLSearchParams({
      method,
      api_key: this.apiKey,
      format: 'json',
      ...params,
    });

    const response = await fetch(`${this.baseUrl}?${searchParams}`);

    if (!response.ok) {
      throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as T & { error?: number; message?: string };
    
    if (data.error) {
      throw new Error(`Last.fm API error: ${data.message}`);
    }

    return data as T;
  }

  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.request('chart.gettopartists', { limit: '1' });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  async getTopArtists(limit: number = 50, page: number = 1): Promise<{
    artists: LastfmArtist[];
    total: number;
  }> {
    const response = await this.request<{
      artists: { artist: LastfmArtist[]; '@attr': { total: string } };
    }>('chart.gettopartists', {
      limit: limit.toString(),
      page: page.toString(),
    });

    return {
      artists: response.artists.artist,
      total: parseInt(response.artists['@attr'].total, 10),
    };
  }

  async getTopTracks(limit: number = 50, page: number = 1): Promise<{
    tracks: LastfmTrack[];
    total: number;
  }> {
    const response = await this.request<{
      tracks: { track: LastfmTrack[]; '@attr': { total: string } };
    }>('chart.gettoptracks', {
      limit: limit.toString(),
      page: page.toString(),
    });

    return {
      tracks: response.tracks.track,
      total: parseInt(response.tracks['@attr'].total, 10),
    };
  }

  async getTagTopArtists(tag: string, limit: number = 50, page: number = 1): Promise<{
    artists: LastfmArtist[];
    total: number;
  }> {
    const response = await this.request<{
      topartists: { artist: LastfmArtist[]; '@attr': { total: string } };
    }>('tag.gettopartists', {
      tag,
      limit: limit.toString(),
      page: page.toString(),
    });

    return {
      artists: response.topartists.artist,
      total: parseInt(response.topartists['@attr'].total, 10),
    };
  }

  async getGeoTopArtists(country: string, limit: number = 50, page: number = 1): Promise<{
    artists: LastfmArtist[];
    total: number;
  }> {
    const response = await this.request<{
      topartists: { artist: LastfmArtist[]; '@attr': { total: string } };
    }>('geo.gettopartists', {
      country,
      limit: limit.toString(),
      page: page.toString(),
    });

    return {
      artists: response.topartists.artist,
      total: parseInt(response.topartists['@attr'].total, 10),
    };
  }

  async getGeoTopTracks(country: string, limit: number = 50, page: number = 1): Promise<{
    tracks: LastfmTrack[];
    total: number;
  }> {
    const response = await this.request<{
      tracks: { track: LastfmTrack[]; '@attr': { total: string } };
    }>('geo.gettoptracks', {
      country,
      limit: limit.toString(),
      page: page.toString(),
    });

    return {
      tracks: response.tracks.track,
      total: parseInt(response.tracks['@attr'].total, 10),
    };
  }

  async searchArtist(artist: string, limit: number = 10): Promise<LastfmArtist[]> {
    const response = await this.request<{
      results: { artistmatches: { artist: LastfmArtist[] } };
    }>('artist.search', {
      artist,
      limit: limit.toString(),
    });

    return response.results.artistmatches.artist;
  }

  async getArtistInfo(artist: string): Promise<{
    name: string;
    mbid?: string;
    url: string;
    listeners?: string;
    playcount?: string;
    bio?: { summary: string; content?: string };
    similar?: { artist: LastfmArtist[] };
    tags?: { tag: Array<{ name: string }> };
    stats?: { listeners: string; playcount: string };
  }> {
    const response = await this.request<{ artist: any }>('artist.getinfo', { artist });
    return response.artist;
  }

  /**
   * Get similar artists using the dedicated endpoint (returns up to 100 artists)
   * This returns many more results than getArtistInfo's similar field
   */
  async getSimilarArtists(artist: string, limit: number = 100): Promise<Array<{
    name: string;
    mbid?: string;
    url: string;
    match: number; // Similarity score 0-1
    image?: Array<{ '#text': string; size: string }>;
  }>> {
    try {
      const response = await this.request<{
        similarartists: { 
          artist: Array<{
            name: string;
            mbid?: string;
            url: string;
            match: string;
            image?: Array<{ '#text': string; size: string }>;
          }>;
        };
      }>('artist.getsimilar', { 
        artist,
        limit: limit.toString(),
      });

      return (response.similarartists?.artist || []).map(a => ({
        name: a.name,
        mbid: a.mbid || undefined,
        url: a.url,
        match: parseFloat(a.match) || 0,
        image: a.image,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get artist stats (listeners, playcount) for enriching search results
   */
  async getArtistStats(artistName: string): Promise<{
    listeners: number;
    playcount: number;
    tags: string[];
  } | null> {
    try {
      const info = await this.getArtistInfo(artistName);
      return {
        listeners: parseInt(info.stats?.listeners || info.listeners || '0', 10),
        playcount: parseInt(info.stats?.playcount || info.playcount || '0', 10),
        tags: info.tags?.tag?.map(t => t.name) || []
      };
    } catch {
      return null;
    }
  }

  /**
   * Batch enrich artists with Last.fm stats
   */
  async enrichArtists<T extends { name: string }>(artists: T[]): Promise<Array<T & {
    lastfm?: {
      listeners: number;
      playcount: number;
      tags: string[];
    };
  }>> {
    const enriched = await Promise.all(
      artists.map(async (artist) => {
        const stats = await this.getArtistStats(artist.name);
        return {
          ...artist,
          lastfm: stats || undefined
        };
      })
    );
    return enriched;
  }

  /**
   * Get a user's top artists from scrobble history
   * @param username Last.fm username
   * @param period Time period: overall, 7day, 1month, 3month, 6month, 12month
   * @param limit Number of artists to fetch
   */
  async getUserTopArtists(username: string, period: string = 'overall', limit: number = 100): Promise<{
    artists: LastfmArtist[];
    total: number;
  }> {
    const response = await this.request<{
      topartists: { artist: LastfmArtist[]; '@attr': { total: string } };
    }>('user.gettopartists', {
      user: username,
      period,
      limit: limit.toString(),
    });

    return {
      artists: response.topartists.artist,
      total: parseInt(response.topartists['@attr'].total, 10),
    };
  }
}
