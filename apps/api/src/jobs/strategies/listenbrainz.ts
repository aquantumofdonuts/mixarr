/**
 * ListenBrainz subscription strategies.
 *
 * Each ListenBrainz subscription type is implemented as a SubscriptionStrategy
 * and registered in the global strategy registry at module load time.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  albumResult,
  type SubscriptionStrategy,
  type StrategyContext,
  type ArtistToAdd,
} from './types.js';
import { ListenBrainzService, VALID_PERIODS, type ListenBrainzPeriod } from '../../services/listenbrainz.js';
import { MusicBrainzService } from '../../services/musicbrainz.js';
import { isListenBrainzConfig } from '../../types/connections.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('ListenBrainzStrategies');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve an authenticated ListenBrainzService + username from a required connection. */
function getListenBrainzService(context: StrategyContext): { service: ListenBrainzService; username: string } {
  const conn = context.connections.get('listenbrainz');
  if (!conn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
  if (!isListenBrainzConfig(conn.config)) throw new Error('Invalid ListenBrainz connection config');
  const username = context.config.username || conn.config.username;
  if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
  return { service: new ListenBrainzService(username, conn.config.token, undefined, conn.config.url), username };
}

function getListenBrainzBaseUrl(context: StrategyContext): string | undefined {
  const conn = context.connections.get('listenbrainz');
  return conn && isListenBrainzConfig(conn.config) ? conn.config.url : undefined;
}



/** Extract unique artists by lowercase name from tracks with artist_name/artist_mbid. */
function extractUniqueArtists(
  tracks: Array<{ artist_name: string; artist_mbid?: string }>,
  source: string,
  limit: number,
): ArtistToAdd[] {
  const artistMap = new Map<string, { name: string; mbid?: string }>();
  for (const track of tracks) {
    const key = track.artist_name.toLowerCase();
    if (!artistMap.has(key)) {
      artistMap.set(key, {
        name: track.artist_name,
        mbid: track.artist_mbid,
      });
    }
  }
  return Array.from(artistMap.values())
    .slice(0, limit)
    .map(a => ({ name: a.name, mbid: a.mbid, source }));
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** listenbrainz_top – user's top artists for a given time period. */
const listenbrainzTop: SubscriptionStrategy = {
  async execute(context) {
    const { service } = getListenBrainzService(context);
    const period: ListenBrainzPeriod = VALID_PERIODS.includes(context.config.period) ? context.config.period : 'all_time';
    const limit = context.config.limit || 50;

    const result = await service.getUserTopArtists(period, limit);

    return artistResult(
      result.artists.map(a => ({
        name: a.artist_name,
        mbid: a.artist_mbid,
        source: `listenbrainz-top-${period}`,
      })),
    );
  },
};

/** listenbrainz_similar – artists popular among similar users. */
const listenbrainzSimilar: SubscriptionStrategy = {
  async execute(context) {
    const { service, username } = getListenBrainzService(context);
    const baseUrl = getListenBrainzBaseUrl(context);
    const limit = context.config.limit || 50;
    const period: ListenBrainzPeriod = VALID_PERIODS.includes(context.config.period) ? context.config.period : 'all_time';

    const similarUsers = await service.getSimilarUsers();

    if (similarUsers.length === 0) {
      logger.warn(`No similar users found for ${username}. Listen to more music to get similar user recommendations.`);
    }

    // Collect top artists from similar users
    const artistMap = new Map<string, { name: string; mbid?: string; count: number }>();

    for (const similarUser of similarUsers.slice(0, 5)) {
      try {
        // Use NO token when querying other users' public data
        const similarUserService = new ListenBrainzService(similarUser.user_name, undefined, undefined, baseUrl);
        const topArtists = await similarUserService.getUserTopArtists(period, 25);

        for (const artist of topArtists.artists) {
          const key = artist.artist_name.toLowerCase();
          const existing = artistMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            artistMap.set(key, {
              name: artist.artist_name,
              mbid: artist.artist_mbid,
              count: 1,
            });
          }
        }
      } catch (error) {
        logger.warn(`Failed to fetch top artists for similar user ${similarUser.user_name}`, { error });
      }
    }

    // Sort by count (artists appearing in multiple similar users' top lists)
    const sortedArtists = Array.from(artistMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return artistResult(
      sortedArtists.map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: 'listenbrainz-similar',
      })),
    );
  },
};

/** listenbrainz_recommendations – artist discovery via recording recommendations. */
const listenbrainzRecommendations: SubscriptionStrategy = {
  async execute(context) {
    const { service, username } = getListenBrainzService(context);
    const validRecTypes = ['top_artist', 'similar_artist'];
    const recType = validRecTypes.includes(context.config.recommendationType)
      ? context.config.recommendationType
      : 'similar_artist';
    const limit = context.config.limit || 50;

    const result = await service.getRecommendations(recType, limit);

    if (result.mbids.length === 0) {
      logger.warn(`No recommendations available for ${username}. ListenBrainz needs more listening history to generate recommendations.`);
    }

    // Recommendations return recording MBIDs — look up artist info via MusicBrainz
    const musicbrainz = new MusicBrainzService();
    const artistMap = new Map<string, { name: string; mbid: string }>();

    const batchSize = 10;
    const mbids = result.mbids.slice(0, limit);

    for (let i = 0; i < mbids.length; i += batchSize) {
      const batch = mbids.slice(i, i + batchSize);

      await Promise.all(batch.map(async (rec) => {
        try {
          const recording = await musicbrainz.getRecording(rec.recording_mbid);
          if (recording && recording['artist-credit']?.[0]?.artist) {
            const artist = recording['artist-credit'][0].artist;
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, {
                name: artist.name,
                mbid: artist.id,
              });
            }
          }
        } catch {
          // Skip if lookup fails
        }
      }));
    }

    return artistResult(
      Array.from(artistMap.values()).map(a => ({
        name: a.name,
        mbid: a.mbid,
        source: `listenbrainz-recommendations-${recType}`,
      })),
    );
  },
};

/** listenbrainz_fresh_releases – new album releases (public endpoint, no auth required). */
const listenbrainzFreshReleases: SubscriptionStrategy = {
  async execute(context) {
    const conn = context.connections.get('listenbrainz');
    const lbConfig = conn?.config;
    const lbUsername = (lbConfig && isListenBrainzConfig(lbConfig)) ? lbConfig.username : 'anonymous';
    const listenbrainz = new ListenBrainzService(lbUsername, undefined, undefined, getListenBrainzBaseUrl(context));
    const limit = context.config.limit || 50;

    const result = await listenbrainz.getFreshReleases();

    return albumResult(
      result.releases.slice(0, limit).map(release => ({
        albumName: release.release_name,
        artistName: release.artist_credit_name,
        albumMbid: release.release_mbid,
        artistMbid: release.artist_mbids?.[0],
        releaseDate: release.release_date,
        releaseYear: release.release_date ? parseInt(release.release_date.split('-')[0]) : undefined,
        releaseType: 'album',
        source: 'listenbrainz-fresh-releases',
      })),
    );
  },
};

/** listenbrainz_weekly_jams – personalized playlist of familiar tracks. */
const listenbrainzWeeklyJams: SubscriptionStrategy = {
  async execute(context) {
    const { service, username } = getListenBrainzService(context);
    const limit = context.config.limit || 50;

    const result = await service.getLatestCreatedForYouPlaylist('weekly-jams');

    if (!result) {
      logger.warn(`No Weekly Jams playlist found for ${username}. Make sure you have enough listening history.`);
      return artistResult([]);
    }

    return artistResult(extractUniqueArtists(result.tracks, 'listenbrainz-weekly-jams', limit));
  },
};

/** listenbrainz_weekly_exploration – personalized playlist of new discoveries. */
const listenbrainzWeeklyExploration: SubscriptionStrategy = {
  async execute(context) {
    const { service, username } = getListenBrainzService(context);
    const limit = context.config.limit || 50;

    const result = await service.getLatestCreatedForYouPlaylist('weekly-exploration');

    if (!result) {
      logger.warn(`No Weekly Exploration playlist found for ${username}. Make sure you have enough listening history.`);
      return artistResult([]);
    }

    return artistResult(extractUniqueArtists(result.tracks, 'listenbrainz-weekly-exploration', limit));
  },
};

/** listenbrainz_year – top artists from a Year in Music report. */
const listenbrainzYear: SubscriptionStrategy = {
  async execute(context) {
    const { service } = getListenBrainzService(context);
    const year = context.config.year || new Date().getFullYear();
    const limit = context.config.limit || 50;

    const result = await service.getYearInMusic(year);

    return artistResult(
      result.topArtists.slice(0, limit).map(a => ({
        name: a.artist_name,
        mbid: a.artist_mbid,
        source: `listenbrainz-year-${year}`,
      })),
    );
  },
};

/** listenbrainz_playlist – artists from a specific ListenBrainz playlist. */
const listenbrainzPlaylist: SubscriptionStrategy = {
  async execute(context) {
    const { service } = getListenBrainzService(context);
    if (!context.config.playlistId) throw new Error('Playlist ID is required for ListenBrainz playlist subscription.');
    const limit = context.config.limit || 50;

    const result = await service.getPlaylist(context.config.playlistId);

    return artistResult(extractUniqueArtists(result.tracks, 'listenbrainz-playlist', limit));
  },
};

/** listenbrainz_radio – artist radio (public endpoint, no auth required). */
const listenbrainzRadio: SubscriptionStrategy = {
  async execute(context) {
    if (!context.config.seedMbid) throw new Error('Seed artist MBID is required for ListenBrainz radio subscription.');

    const conn = context.connections.get('listenbrainz');
    const lbConfig = conn?.config;
    const lbUsername = (lbConfig && isListenBrainzConfig(lbConfig)) ? lbConfig.username : 'anonymous';
    const listenbrainz = new ListenBrainzService(lbUsername, undefined, undefined, getListenBrainzBaseUrl(context));
    const mode = context.config.mode || 'medium';
    const limit = context.config.limit || 50;

    const result = await listenbrainz.getArtistRadio(context.config.seedMbid, mode);

    return artistResult(extractUniqueArtists(result.tracks, 'listenbrainz-radio', limit));
  },
};

/** listenbrainz_loved – artists from user's loved/favorite tracks. */
const listenbrainzLoved: SubscriptionStrategy = {
  async execute(context) {
    const { service } = getListenBrainzService(context);
    const limit = context.config.limit || 50;

    const result = await service.getLovedTracks();

    // Extract unique artists from loved tracks (only those with artist_name)
    const artistMap = new Map<string, { name: string; mbid?: string }>();
    for (const feedback of result.feedback) {
      if (feedback.artist_name) {
        const key = feedback.artist_name.toLowerCase();
        if (!artistMap.has(key)) {
          artistMap.set(key, {
            name: feedback.artist_name,
            mbid: feedback.artist_mbid,
          });
        }
      }
    }

    return artistResult(
      Array.from(artistMap.values())
        .slice(0, limit)
        .map(a => ({ name: a.name, mbid: a.mbid, source: 'listenbrainz-loved' })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('listenbrainz_top', listenbrainzTop);
registerStrategy('listenbrainz_similar', listenbrainzSimilar);
registerStrategy('listenbrainz_recommendations', listenbrainzRecommendations);
registerStrategy('listenbrainz_fresh_releases', listenbrainzFreshReleases);
registerStrategy('listenbrainz_weekly_jams', listenbrainzWeeklyJams);
registerStrategy('listenbrainz_weekly_exploration', listenbrainzWeeklyExploration);
registerStrategy('listenbrainz_year', listenbrainzYear);
registerStrategy('listenbrainz_playlist', listenbrainzPlaylist);
registerStrategy('listenbrainz_radio', listenbrainzRadio);
registerStrategy('listenbrainz_loved', listenbrainzLoved);
