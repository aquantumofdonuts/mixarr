/**
 * Jellyfin subscription strategy.
 *
 * Discovers artists similar to the user's top Jellyfin listening history
 * using Last.fm for similar-artist lookups.
 *
 * Registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  type SubscriptionStrategy,
  type ArtistToAdd,
} from './types.js';
import { LastfmService } from '../../services/lastfm.js';
import { isLastFMConfig, isJellyfinConfig } from '../../types/connections.js';

// ---------------------------------------------------------------------------
// Strategy
// ---------------------------------------------------------------------------

/** jellyfin_similar – artists similar to top Jellyfin listening history. */
const jellyfinSimilar: SubscriptionStrategy = {
  async execute(context) {
    const { config, connections } = context;

    // Validate connections
    const jellyfinConn = connections.get('jellyfin');
    if (!jellyfinConn) throw new Error('No active Jellyfin connection. Please add a Jellyfin connection first.');
    const lastfmConn = connections.get('lastfm');
    if (!lastfmConn) throw new Error('No active Last.fm connection. Required for similar artist lookup.');
    if (!isLastFMConfig(lastfmConn.config)) {
      throw new Error('Invalid Last.fm connection config');
    }
    if (!isJellyfinConfig(jellyfinConn.config)) {
      throw new Error('Invalid Jellyfin connection config');
    }

    const jellyfinConfig = jellyfinConn.config;
    const lastfmConfigSim = lastfmConn.config;

    // Import JellyfinService dynamically to avoid circular dependencies
    const { JellyfinService } = await import('../../services/jellyfin.js');
    const jellyfin = new JellyfinService();
    const lastfmSim = new LastfmService({ apiKey: lastfmConfigSim.apiKey });

    // Config options (same as tautulli_similar)
    const period = config.period || 'month';
    const seedLimit = config.seedLimit || 10;
    const similarPerSeed = config.similarPerSeed || 5;
    const totalLimit = config.limit || 50;
    const minMatchCount = config.minMatchCount || 1;

    // Get top artists from Jellyfin listening history
    const topArtists = await jellyfin.getTopArtists(
      {
        jellyfinUrl: jellyfinConfig.jellyfinUrl,
        jellyfinApiKey: jellyfinConfig.jellyfinApiKey,
        jellyfinUserId: jellyfinConfig.jellyfinUserId,
        jellyfinLibraryId: jellyfinConfig.jellyfinLibraryId,
      },
      { period: period as 'week' | 'month' | 'year' | 'all', limit: seedLimit }
    );

    if (topArtists.length === 0) {
      throw new Error(`No listening history found for Jellyfin user (period: ${period})`);
    }

    // Collect similar artists from each seed using Last.fm
    const similarMap = new Map<string, { name: string; mbid?: string; match: number; seedCount: number; sources: string[] }>();

    for (const seed of topArtists) {
      try {
        const similarArtists = await lastfmSim.getSimilarArtists(seed.name, similarPerSeed);
        for (const similar of similarArtists) {
          const key = similar.name.toLowerCase();
          const existing = similarMap.get(key);
          if (existing) {
            // Seen from multiple seeds - increase relevance
            existing.seedCount++;
            existing.sources.push(seed.name);
            if (similar.match > existing.match) {
              existing.match = similar.match;
            }
          } else {
            similarMap.set(key, {
              name: similar.name,
              mbid: similar.mbid,
              match: similar.match,
              seedCount: 1,
              sources: [seed.name],
            });
          }
        }
      } catch {
        // Skip this seed if API call fails
      }
    }

    // Filter by minMatchCount, sort by seedCount then match score
    const sortedSimilar = Array.from(similarMap.values())
      .filter(a => a.seedCount >= minMatchCount)
      .sort((a, b) => {
        if (b.seedCount !== a.seedCount) return b.seedCount - a.seedCount;
        return b.match - a.match;
      })
      .slice(0, totalLimit);

    const artists: ArtistToAdd[] = sortedSimilar.map(a => ({
      name: a.name,
      mbid: a.mbid,
      source: `jellyfin-similar-${period}`,
    }));

    return artistResult(artists);
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('jellyfin_similar', jellyfinSimilar);
