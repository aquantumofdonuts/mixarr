/**
 * Discogs subscription strategies.
 *
 * Each Discogs subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  type SubscriptionStrategy,
  type StrategyContext,
  type SubscriptionStrategyResult,
  type ArtistToAdd,
} from './types.js';
import { DiscogsService } from '../../services/discogs.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a DiscogsService from the strategy context. */
function getDiscogsService(context: StrategyContext): DiscogsService {
  const conn = context.connections.get('discogs');
  if (!conn) throw new Error('No active Discogs connection. Please add a Discogs connection first.');
  const discogsConfig = conn.config as { token?: string };
  if (!discogsConfig.token) throw new Error('Discogs token not configured');
  return new DiscogsService(discogsConfig.token);
}



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * discogs_label – Discover artists from a Discogs label's catalogue.
 *
 * Filters out "Various" artists and deduplicates by name.
 */
const discogsLabel: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const discogs = getDiscogsService(context);
    const labelId = context.config.labelId;
    if (!labelId) throw new Error('Label ID is required for Discogs Label subscription');

    const limit = context.config.limit || 50;
    const result = await discogs.getLabelReleases(labelId, 1);

    // Extract unique artists from releases, filtering out "Various"
    const artistMap = new Map<string, ArtistToAdd>();
    for (const release of result.releases.slice(0, limit)) {
      if (release.artist && release.artist.toLowerCase() !== 'various') {
        if (!artistMap.has(release.artist)) {
          artistMap.set(release.artist, {
            name: release.artist,
            source: `discogs-label-${labelId}`,
          });
        }
      }
    }

    return artistResult(Array.from(artistMap.values()));
  },
};

/**
 * discogs_style – Discover artists by searching Discogs for a musical style.
 *
 * Parses "Artist - Album" title format, filters "various" / "various artists".
 */
const discogsStyle: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const discogs = getDiscogsService(context);
    const style = context.config.style;
    if (!style) throw new Error('Style is required for Discogs Style subscription');

    const limit = context.config.limit || 50;
    const result = await discogs.searchByStyle(style, 1);

    // Extract unique artists from "Artist - Album" title format
    const artistMap = new Map<string, ArtistToAdd>();
    for (const item of result.results.slice(0, limit)) {
      const titleParts = item.title.split(' - ');
      if (titleParts.length > 0) {
        const artistName = titleParts[0].trim();
        if (
          artistName &&
          artistName.toLowerCase() !== 'various' &&
          artistName.toLowerCase() !== 'various artists'
        ) {
          if (!artistMap.has(artistName)) {
            artistMap.set(artistName, {
              name: artistName,
              source: `discogs-style-${style}`,
            });
          }
        }
      }
    }

    return artistResult(Array.from(artistMap.values()));
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('discogs_label', discogsLabel);
registerStrategy('discogs_style', discogsStyle);
