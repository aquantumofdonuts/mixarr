/**
 * Last.fm subscription strategies.
 *
 * Each Last.fm subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  type SubscriptionStrategy,
  type StrategyContext,
} from './types.js';
import { LastfmService } from '../../services/lastfm.js';
import { isLastFMConfig } from '../../types/connections.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a LastfmService from the strategy context. */
function getLastfmService(context: StrategyContext): LastfmService {
  const conn = context.connections.get('lastfm');
  if (!conn) throw new Error('No active Last.fm connection');
  if (!isLastFMConfig(conn.config)) throw new Error('Invalid Last.fm connection config');
  return new LastfmService({ apiKey: conn.config.apiKey });
}

/** Resolve the Last.fm username from the strategy context. */
function getLastfmUsername(context: StrategyContext): string {
  const conn = context.connections.get('lastfm');
  if (!conn) throw new Error('No active Last.fm connection');
  if (!isLastFMConfig(conn.config)) throw new Error('Invalid Last.fm connection config');
  if (!conn.config.username) {
    throw new Error('Last.fm connection is missing username. Please update your Last.fm connection with your username.');
  }
  return conn.config.username;
}



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** lastfm_chart – top artists from global Last.fm charts. */
const lastfmChart: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getTopArtists(context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: 'lastfm-chart',
      })),
    );
  },
};

/** lastfm_tag – top artists for a given tag/genre. */
const lastfmTag: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getTagTopArtists(context.config.tag, context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-tag-${context.config.tag}`,
      })),
    );
  },
};

/** lastfm_geo – top artists for a given country. */
const lastfmGeo: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const result = await lastfm.getGeoTopArtists(context.config.country, context.config.limit || 50);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-geo-${context.config.country}`,
      })),
    );
  },
};

/** lastfm_library – user's top artists from scrobble history. */
const lastfmLibrary: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);
    const period = context.config.period || 'overall'; // overall, 7day, 1month, 3month, 6month, 12month
    const limit = context.config.limit || 100;
    const result = await lastfm.getUserTopArtists(username, period, limit);
    return artistResult(
      result.artists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-library-${period}`,
      })),
    );
  },
};

/** lastfm_similar – artists similar to user's top scrobbled artists. */
const lastfmSimilar: SubscriptionStrategy = {
  async execute(context) {
    const lastfm = getLastfmService(context);
    const username = getLastfmUsername(context);

    // Config options
    const topArtistsLimit = context.config.topArtistsLimit || 20; // How many of user's top artists to use as seeds
    const similarPerArtist = context.config.similarPerArtist || 10; // How many similar artists per seed
    const period = context.config.period || 'overall';
    const totalLimit = context.config.limit || 100; // Max total results

    // Get user's top artists as seed artists
    const topResult = await lastfm.getUserTopArtists(username, period, topArtistsLimit);
    const seedArtists = topResult.artists;

    // Collect similar artists from each seed
    const similarMap = new Map<string, { name: string; mbid?: string; match: number; seedCount: number }>();

    for (const seed of seedArtists) {
      try {
        const similarArtists = await lastfm.getSimilarArtists(seed.name, similarPerArtist);
        for (const similar of similarArtists) {
          const key = similar.name.toLowerCase();
          const existing = similarMap.get(key);
          if (existing) {
            // Seen from multiple seeds - increase relevance
            existing.seedCount++;
            if (similar.match > existing.match) {
              existing.match = similar.match;
            }
          } else {
            similarMap.set(key, {
              name: similar.name,
              mbid: similar.mbid,
              match: similar.match,
              seedCount: 1,
            });
          }
        }
      } catch {
        // Skip this seed if API call fails
      }
    }

    // Sort by seedCount (appears similar to multiple top artists) then by match score
    const sortedSimilar = Array.from(similarMap.values())
      .sort((a, b) => {
        if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
        return b.match - a.match;
      })
      .slice(0, totalLimit);

    return artistResult(
      sortedSimilar.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `lastfm-similar-${period}`,
      })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('lastfm_chart', lastfmChart);
registerStrategy('lastfm_tag', lastfmTag);
registerStrategy('lastfm_geo', lastfmGeo);
registerStrategy('lastfm_library', lastfmLibrary);
registerStrategy('lastfm_similar', lastfmSimilar);
