// apps/api/src/services/adapters/deezer-adapter.ts

import { searchDeezerArtists } from '../deezer.js';
import type { NormalizedArtistMetadata } from '../metadata-enrichment.types.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('DeezerAdapter');

/**
 * Adapter to fetch and normalize artist metadata from Deezer
 * 
 * Deezer provides:
 * - High quality artist images (up to 1000x1000)
 * - No bio/overview (only images)
 */
export class DeezerMetadataAdapter {
  /**
   * Fetch artist metadata from Deezer and normalize to common format
   */
  async fetchMetadata(artistName: string): Promise<NormalizedArtistMetadata> {
    try {
      const results = await searchDeezerArtists(artistName, 1);

      if (results.length === 0) {
        return {
          source: 'deezer',
          fetchedAt: new Date(),
        };
      }

      const artist = results[0];
      const imageUrl = this.getBestImage(artist);

      return {
        source: 'deezer',
        images: imageUrl ? [{
          url: imageUrl.url,
          width: imageUrl.width,
          height: imageUrl.width, // Deezer images are square
          type: 'poster' as const,
        }] : undefined,
        fetchedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Error fetching metadata for "${artistName}"`, { error });
      return {
        source: 'deezer',
        fetchedAt: new Date(),
      };
    }
  }

  /**
   * Get the highest resolution image available
   */
  private getBestImage(artist: {
    picture_xl?: string;
    picture_big?: string;
    picture_medium?: string;
    picture_small?: string;
    picture?: string;
  }): { url: string; width: number } | undefined {
    if (artist.picture_xl) {
      return { url: artist.picture_xl, width: 1000 };
    }
    if (artist.picture_big) {
      return { url: artist.picture_big, width: 500 };
    }
    if (artist.picture_medium) {
      return { url: artist.picture_medium, width: 250 };
    }
    if (artist.picture_small || artist.picture) {
      return { url: artist.picture_small || artist.picture!, width: 56 };
    }
    return undefined;
  }
}
