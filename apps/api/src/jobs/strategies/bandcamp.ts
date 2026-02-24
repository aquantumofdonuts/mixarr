/**
 * Bandcamp subscription strategies.
 *
 * Bandcamp is a public API — no connection/auth required.
 * Registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  albumResult,
  type SubscriptionStrategy,
  type StrategyContext,
  type SubscriptionStrategyResult,
  type ArtistToAdd,
  type AlbumToAdd,
} from './types.js';
import { BandcampService } from '../../services/bandcamp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * bandcamp_tag – Discover artists by Bandcamp tag (e.g. "electronic", "jazz").
 *
 * Extracts unique artists from tag releases.
 */
const bandcampTag: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const tag = context.config.tag;
    if (!tag) throw new Error('Tag is required for Bandcamp Tag subscription');

    const bandcamp = new BandcampService();
    const limit = context.config.limit || 50;
    const sort = context.config.sort || 'pop';

    const result = await bandcamp.getTagReleases(tag, sort, 0);

    // Extract unique artists from releases
    const artistMap = new Map<string, ArtistToAdd>();
    for (const release of result.releases.slice(0, limit)) {
      if (release.artistName && !artistMap.has(release.artistName)) {
        artistMap.set(release.artistName, {
          name: release.artistName,
          source: `bandcamp-tag-${tag}`,
        });
      }
    }

    return artistResult(Array.from(artistMap.values()));
  },
};

/**
 * bandcamp_new – Discover new album releases from Bandcamp by tag.
 *
 * Returns **albums**, not artists. Always sorts by date to get the newest.
 */
const bandcampNew: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const tag = context.config.tag || 'all';
    const limit = context.config.limit || 50;

    const bandcamp = new BandcampService();

    // Sort by date to get newest releases
    const result = await bandcamp.getTagReleases(tag, 'date', 0);

    const albums: AlbumToAdd[] = result.releases.slice(0, limit).map(release => ({
      albumName: release.title,
      artistName: release.artistName,
      releaseType: release.type === 'a' ? 'album' : 'single',
      source: `bandcamp-new-${tag}`,
    }));

    return albumResult(albums);
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('bandcamp_tag', bandcampTag);
registerStrategy('bandcamp_new', bandcampNew);
