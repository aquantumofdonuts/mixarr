// apps/api/src/services/adapters/lastfm-adapter.ts

import type { LastfmService } from '../lastfm.js';
import type { NormalizedArtistMetadata } from '../metadata-enrichment.types.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('LastfmAdapter');

/**
 * Adapter to fetch and normalize artist metadata from Last.fm
 */
export class LastfmMetadataAdapter {
  constructor(private lastfmService: LastfmService) {}

  /**
   * Fetch artist metadata from Last.fm and normalize to common format
   */
  async fetchMetadata(artistName: string): Promise<NormalizedArtistMetadata> {
    try {
      const info = await this.lastfmService.getArtistInfo(artistName);

      // Prefer content (full bio) over summary (short teaser with "Read more on Last.fm")
      const rawBio = info.bio?.content || info.bio?.summary;
      const overview = this.cleanHtml(rawBio);
      const genres = info.tags?.tag?.map(t => t.name);

      return {
        source: 'lastfm',
        overview,
        overviewLength: overview?.length,
        genres,
        mbid: info.mbid || undefined,
        fetchedAt: new Date(),
      };
    } catch (error) {
      logger.error(`Error fetching metadata for "${artistName}"`, { error });
      return {
        source: 'lastfm',
        fetchedAt: new Date(),
      };
    }
  }

  /**
   * Remove HTML tags from Last.fm bio text
   */
  private cleanHtml(text?: string): string | undefined {
    if (!text) return undefined;
    return text
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }
}
