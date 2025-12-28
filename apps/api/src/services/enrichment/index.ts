// apps/api/src/services/enrichment/index.ts

/**
 * Barrel export for metadata enrichment module
 */

export { MetadataEnrichmentService } from '../metadata-enrichment.js';
export { MetadataMerger } from '../metadata-merger.js';
export { LastfmMetadataAdapter } from '../adapters/lastfm-adapter.js';
export { DeezerMetadataAdapter } from '../adapters/deezer-adapter.js';
export type {
  NormalizedArtistMetadata,
  MergedArtistMetadata,
  EnrichmentResult,
  EnrichmentOptions,
} from '../metadata-enrichment.types.js';
