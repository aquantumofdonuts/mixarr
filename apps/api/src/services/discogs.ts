/**
 * Discogs Service
 * 
 * Handles all interactions with the Discogs API.
 * Discogs is a music database with extensive label and release information,
 * useful for discovery features.
 */

import { rateLimit } from './rate-limiter.js';

interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

interface DiscogsLabel {
  id: number;
  title: string;
  resource_url: string;
  thumb?: string;
}

interface DiscogsRelease {
  id: number;
  title: string;
  artist: string;
  year?: number;
  format?: string;
  catno?: string;
  status?: string;
  thumb?: string;
  resource_url?: string;
}

interface DiscogsSearchResult {
  id: number;
  title: string;
  type: string;
  style?: string[];
  genre?: string[];
  year?: string;
  thumb?: string;
  resource_url?: string;
}

export interface ParsedDiscogsArtist {
  id: number;
  name: string;
  profile?: string;
  images: Array<{ type: string; uri: string; width?: number; height?: number }>;
  urls: string[];
  nameVariations: string[];
  members?: Array<{ id: number; name: string; active?: boolean }>;
}

interface DiscogsArtist {
  id: number;
  name: string;
  realname?: string;
  profile?: string;
  urls?: string[];
  images?: Array<{ type: string; uri: string; width?: number; height?: number }>;
  members?: Array<{ id: number; name: string; active?: boolean }>;
  namevariations?: string[];
  data_quality?: string;
}

interface RawDiscogsArtist {
  id: number;
  name: string;
  profile?: string;
  images?: Array<{ type: string; uri: string; width?: number; height?: number }>;
  urls?: string[];
  namevariations?: string[];
  members?: Array<{ id: number; name: string; active?: boolean }>;
}

interface DiscogsLabelSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsLabel[];
}

interface DiscogsLabelReleasesResponse {
  pagination: DiscogsPagination;
  releases: DiscogsRelease[];
}

interface DiscogsStyleSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsSearchResult[];
}

/**
 * Parse raw Discogs artist data into a structured format
 */
export function parseDiscogsArtist(raw: RawDiscogsArtist): ParsedDiscogsArtist {
  return {
    id: raw.id,
    name: raw.name,
    profile: raw.profile,
    images: raw.images || [],
    urls: raw.urls || [],
    nameVariations: raw.namevariations || [],
    members: raw.members,
  };
}

/**
 * Format Discogs image URL based on desired size
 */
export function formatDiscogsImageUrl(
  fullUrl: string,
  thumbnailUrl?: string,
  size?: 'small' | 'large'
): string {
  if (!size) return fullUrl;
  if (size === 'small' && thumbnailUrl) return thumbnailUrl;
  return fullUrl;
}

interface DiscogsLabelSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsLabel[];
}

interface DiscogsLabelReleasesResponse {
  pagination: DiscogsPagination;
  releases: DiscogsRelease[];
}

interface DiscogsStyleSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsSearchResult[];
}

export class DiscogsService {
  private token: string;
  private baseUrl = 'https://api.discogs.com';

  constructor(token: string) {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Authorization': `Discogs token=${this.token}`,
      'User-Agent': 'MixarrMusicDiscovery/1.0',
    };
  }

  private async request<T>(path: string): Promise<T> {
    await rateLimit('discogs');

    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Discogs API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test connection to Discogs API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.searchLabels('test', 1);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Search for labels by name
   * @param query - Search query string
   * @param page - Page number (default: 1)
   * @returns Paginated list of labels
   */
  async searchLabels(query: string, page: number = 1): Promise<DiscogsLabelSearchResponse> {
    const encodedQuery = encodeURIComponent(query);
    return this.request<DiscogsLabelSearchResponse>(
      `/database/search?type=label&q=${encodedQuery}&page=${page}&per_page=25`
    );
  }

  /**
   * Get releases from a specific label
   * @param labelId - Discogs label ID
   * @param page - Page number (default: 1)
   * @returns Paginated list of releases
   */
  async getLabelReleases(labelId: number, page: number = 1): Promise<DiscogsLabelReleasesResponse> {
    return this.request<DiscogsLabelReleasesResponse>(
      `/labels/${labelId}/releases?page=${page}&per_page=50`
    );
  }

  /**
   * Search for releases by style/genre
   * @param style - Style/genre to search for (e.g., "Ambient", "Progressive Rock")
   * @param page - Page number (default: 1)
   * @returns Paginated list of releases matching the style
   */
  async searchByStyle(style: string, page: number = 1): Promise<DiscogsStyleSearchResponse> {
    const encodedStyle = encodeURIComponent(style);
    return this.request<DiscogsStyleSearchResponse>(
      `/database/search?type=release&style=${encodedStyle}&page=${page}&per_page=50`
    );
  }

  /**
   * Get artist details by ID
   * @param artistId - Discogs artist ID
   * @returns Artist details including profile, images, and members
   */
  async getArtist(artistId: number): Promise<DiscogsArtist> {
    return this.request<DiscogsArtist>(`/artists/${artistId}`);
  }
}
