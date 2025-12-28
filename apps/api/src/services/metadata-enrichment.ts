// apps/api/src/services/metadata-enrichment.ts

import type { LidarrService, LidarrArtist } from './lidarr.js';
import type { LastfmService } from './lastfm.js';
import { LastfmMetadataAdapter } from './adapters/lastfm-adapter.js';
import { DeezerMetadataAdapter } from './adapters/deezer-adapter.js';
import { MetadataMerger } from './metadata-merger.js';
import type {
  NormalizedArtistMetadata,
  EnrichmentResult,
  EnrichmentOptions,
} from './metadata-enrichment.types.js';

/**
 * Service to enrich Lidarr artist metadata from multiple sources
 */
export class MetadataEnrichmentService {
  private lastfmAdapter: LastfmMetadataAdapter;
  private deezerAdapter: DeezerMetadataAdapter;
  private merger: MetadataMerger;

  constructor(
    private lidarrService: LidarrService,
    lastfmService: LastfmService
  ) {
    this.lastfmAdapter = new LastfmMetadataAdapter(lastfmService);
    this.deezerAdapter = new DeezerMetadataAdapter();
    this.merger = new MetadataMerger();
  }

  /**
   * Enrich a single artist's metadata from connected sources
   */
  async enrichArtist(
    artistId: number,
    options: EnrichmentOptions = {}
  ): Promise<EnrichmentResult> {
    const { updateLidarr = true, forceUpdate = false } = options;

    try {
      // Get current artist from Lidarr
      const artist = await this.lidarrService.getArtist(artistId);
      console.log(`[MetadataEnrichment] Enriching artist: ${artist.artistName} (ID: ${artistId})`);
      console.log(`[MetadataEnrichment] Current state - overview: ${artist.overview ? 'YES' : 'NO'}, genres: ${artist.genres?.length || 0}, images: ${artist.images?.length || 0}`);

      // Fetch metadata from all sources in parallel
      const metadataSources = await this.fetchFromAllSources(artist.artistName);
      console.log(`[MetadataEnrichment] Fetched ${metadataSources.length} sources with data`);
      for (const source of metadataSources) {
        console.log(`[MetadataEnrichment] Source ${source.source}: overview=${source.overview ? 'YES' : 'NO'}, genres=${source.genres?.length || 0}, images=${source.images?.length || 0}`);
      }

      // Merge using Best Quality heuristics
      const merged = this.merger.merge(metadataSources);
      console.log(`[MetadataEnrichment] Merged result: overview=${merged.overview ? 'YES' : 'NO'}, genres=${merged.genres.length}, images=${merged.images.length}`);

      // Determine what fields would be updated
      const fieldsToUpdate = this.getFieldsToUpdate(artist, merged, forceUpdate);
      console.log(`[MetadataEnrichment] Fields to update: ${fieldsToUpdate.join(', ') || 'NONE'}`);

      if (fieldsToUpdate.length === 0) {
        return {
          artistId,
          artistName: artist.artistName,
          success: true,
          updated: false,
          fieldsUpdated: [],
          errors: [],
          metadata: merged,
        };
      }

      // Update Lidarr if requested
      if (updateLidarr) {
        const updates: Partial<Pick<LidarrArtist, 'overview' | 'genres' | 'images'>> = {};

        if (fieldsToUpdate.includes('overview') && merged.overview) {
          updates.overview = merged.overview;
        }
        if (fieldsToUpdate.includes('genres') && merged.genres.length > 0) {
          updates.genres = merged.genres;
        }
        if (fieldsToUpdate.includes('images') && merged.images.length > 0) {
          updates.images = merged.images.map(img => ({
            coverType: img.type,
            url: img.url,
            remoteUrl: img.url,
          }));
        }

        console.log(`[MetadataEnrichment] Updating Lidarr with:`, JSON.stringify(updates, null, 2));
        await this.lidarrService.patchArtist(artistId, updates);
        console.log(`[MetadataEnrichment] Lidarr update complete`);
      }

      return {
        artistId,
        artistName: artist.artistName,
        success: true,
        updated: updateLidarr && fieldsToUpdate.length > 0,
        fieldsUpdated: fieldsToUpdate,
        errors: [],
        metadata: merged,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[MetadataEnrichment] Error enriching artist ${artistId}:`, error);

      return {
        artistId,
        artistName: '',
        success: false,
        updated: false,
        fieldsUpdated: [],
        errors: [errorMessage],
      };
    }
  }

  /**
   * Enrich multiple artists (e.g., all incomplete artists)
   */
  async enrichArtists(
    artistIds: number[],
    options: EnrichmentOptions = {},
    onProgress?: (result: EnrichmentResult, index: number, total: number) => void
  ): Promise<EnrichmentResult[]> {
    const results: EnrichmentResult[] = [];

    for (let i = 0; i < artistIds.length; i++) {
      const result = await this.enrichArtist(artistIds[i], options);
      results.push(result);

      if (onProgress) {
        onProgress(result, i, artistIds.length);
      }

      // Small delay between requests to avoid rate limiting
      if (i < artistIds.length - 1) {
        await this.delay(500);
      }
    }

    return results;
  }

  /**
   * Fetch metadata from all connected sources
   */
  private async fetchFromAllSources(artistName: string): Promise<NormalizedArtistMetadata[]> {
    const [lastfmData, deezerData] = await Promise.all([
      this.lastfmAdapter.fetchMetadata(artistName),
      this.deezerAdapter.fetchMetadata(artistName),
    ]);

    return [lastfmData, deezerData].filter(
      (data) => data.overview || data.genres?.length || data.images?.length
    );
  }

  /**
   * Determine which fields should be updated based on current artist state
   */
  private getFieldsToUpdate(
    artist: LidarrArtist,
    merged: ReturnType<MetadataMerger['merge']>,
    forceUpdate: boolean
  ): string[] {
    const fields: string[] = [];

    // Overview: update if missing or force
    if (merged.overview && (forceUpdate || !artist.overview?.trim())) {
      fields.push('overview');
    }

    // Genres: update if missing or force
    if (merged.genres.length > 0 && (forceUpdate || !artist.genres?.length)) {
      fields.push('genres');
    }

    // Images (poster): update if missing or force
    const hasPoster = artist.images?.some(
      (img: { coverType: string; url: string }) => img.coverType?.toLowerCase() === 'poster' && img.url
    );
    if (merged.images.length > 0 && (forceUpdate || !hasPoster)) {
      fields.push('images');
    }

    return fields;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
