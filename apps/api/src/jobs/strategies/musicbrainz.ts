/**
 * MusicBrainz subscription strategies.
 *
 * Registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import type {
  SubscriptionStrategy,
  StrategyContext,
  SubscriptionStrategyResult,
  AlbumToAdd,
} from './types.js';
import { MusicBrainzService } from '../../services/musicbrainz.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for a result with only albums. */
function albumResult(albums: AlbumToAdd[]): SubscriptionStrategyResult {
  return { artists: [], albums };
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * musicbrainz_new – Discover new album releases from MusicBrainz by year.
 *
 * Returns **albums**, not artists.
 */
const musicbrainzNew: SubscriptionStrategy = {
  async execute(context: StrategyContext): Promise<SubscriptionStrategyResult> {
    const musicbrainz = new MusicBrainzService();
    const year = new Date().getFullYear();
    const limit = context.config.limit || 50;

    const result = await musicbrainz.searchByYear(year, limit);

    const albums: AlbumToAdd[] = result.releaseGroups.map(rg => {
      const artistCredit = rg['artist-credit'];
      const artist = artistCredit?.[0]?.artist;
      return {
        albumName: rg.title,
        artistName: artist?.name || 'Unknown Artist',
        albumMbid: rg.id,
        artistMbid: artist?.id,
        releaseDate: rg['first-release-date'],
        releaseYear: rg['first-release-date']
          ? parseInt(rg['first-release-date'].split('-')[0])
          : year,
        releaseType: rg['primary-type'] || 'album',
        source: 'musicbrainz-new',
      };
    });

    return albumResult(albums);
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('musicbrainz_new', musicbrainzNew);
