// apps/api/src/services/adapters/discogs-adapter.ts

import type { NormalizedArtistMetadata } from '../metadata-enrichment.types.js';
import { rateLimit } from '../rate-limiter.js';

const DISCOGS_API_BASE = 'https://api.discogs.com';
const USER_AGENT = 'Mixarr/1.0 +https://github.com/mixarr';

interface DiscogsImage {
  type: string;
  uri: string;
  width: number;
  height: number;
}

interface DiscogsArtist {
  id: number;
  name: string;
  profile?: string;
  images?: DiscogsImage[];
  urls?: string[];
  namevariations?: string[];
}

interface DiscogsSearchResult {
  id: number;
  title: string;
  type: string;
  thumb?: string;
}

/**
 * Adapter to fetch and normalize artist metadata from Discogs
 * 
 * Discogs provides:
 * - Artist bios (profile field)
 * - High quality artist images
 * - Extensive metadata for vinyl/physical releases
 * 
 * Note: Discogs doesn't have artist-level genres, only release-level styles
 */
export class DiscogsMetadataAdapter {
  private token?: string;

  constructor(token?: string) {
    this.token = token;
  }

  /**
   * Fetch artist metadata from Discogs and normalize to common format
   */
  async fetchMetadata(artistName: string): Promise<NormalizedArtistMetadata> {
    try {
      // Apply rate limiting before making requests
      await rateLimit('discogs');

      // Search for artist
      const searchResults = await this.searchArtist(artistName);
      
      if (searchResults.length === 0) {
        return {
          source: 'discogs',
          fetchedAt: new Date(),
        };
      }

      // Get full artist details
      const artist = await this.getArtist(searchResults[0].id);

      return {
        source: 'discogs',
        overview: artist.profile?.trim() || undefined,
        overviewLength: artist.profile?.trim()?.length,
        images: this.normalizeImages(artist.images),
        fetchedAt: new Date(),
      };
    } catch (error) {
      console.error(`[DiscogsAdapter] Error fetching metadata for "${artistName}":`, error);
      return {
        source: 'discogs',
        fetchedAt: new Date(),
      };
    }
  }

  /**
   * Search for an artist by name
   */
  private async searchArtist(name: string): Promise<DiscogsSearchResult[]> {
    const encodedName = encodeURIComponent(name);
    const url = `${DISCOGS_API_BASE}/database/search?type=artist&q=${encodedName}`;
    
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Discogs search error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { results?: DiscogsSearchResult[] };
    return data.results || [];
  }

  /**
   * Get full artist details by ID
   */
  private async getArtist(artistId: number): Promise<DiscogsArtist> {
    await rateLimit('discogs');
    
    const url = `${DISCOGS_API_BASE}/artists/${artistId}`;
    
    const response = await fetch(url, {
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Discogs artist fetch error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as DiscogsArtist;
  }

  /**
   * Get headers for Discogs API requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
    };

    if (this.token) {
      headers['Authorization'] = `Discogs token=${this.token}`;
    }

    return headers;
  }

  /**
   * Normalize Discogs images to common format
   */
  private normalizeImages(
    images?: DiscogsImage[]
  ): NormalizedArtistMetadata['images'] {
    if (!images || images.length === 0) return undefined;

    // Sort images: primary first, then by size (larger first)
    const sortedImages = [...images].sort((a, b) => {
      if (a.type === 'primary' && b.type !== 'primary') return -1;
      if (a.type !== 'primary' && b.type === 'primary') return 1;
      return (b.width || 0) - (a.width || 0);
    });

    return sortedImages.map((img) => ({
      url: img.uri,
      width: img.width,
      height: img.height,
      type: img.type === 'primary' ? ('poster' as const) : ('fanart' as const),
    }));
  }
}
