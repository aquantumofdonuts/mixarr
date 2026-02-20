/**
 * Deezer subscription strategies.
 *
 * Each Deezer subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
 *
 * Deezer has two classes of strategy:
 * - **Authenticated** (favorites, history, flow, playlist, playlists) –
 *   require a Deezer OAuth connection with appId, appSecret, accessToken.
 * - **Public** (chart, genre, search) – call standalone public-API functions
 *   and need no connection at all.
 */

import { registerStrategy } from './registry.js';
import type {
  SubscriptionStrategy,
  StrategyContext,
  SubscriptionStrategyResult,
  ArtistToAdd,
} from './types.js';
import { DeezerOAuthService } from '../../services/deezer-oauth.js';
import {
  getDeezerChartArtists,
  getDeezerGenreArtists,
  searchDeezerArtists,
} from '../../services/deezer.js';
import { isDeezerConfig } from '../../types/connections.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a DeezerOAuthService from the strategy context. */
function getDeezerService(context: StrategyContext): DeezerOAuthService {
  const conn = context.connections.get('deezer');
  if (!conn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
  if (!isDeezerConfig(conn.config)) throw new Error('Invalid Deezer connection config');
  const cfg = conn.config as { appId: string; appSecret: string; accessToken: string };
  return new DeezerOAuthService({
    appId: cfg.appId,
    appSecret: cfg.appSecret,
    accessToken: cfg.accessToken,
  });
}

/** Extract unique artists from Deezer tracks (common pattern). */
function extractArtistsFromTracks(
  tracks: Array<{ artist?: { name: string } }>,
  source: string,
): ArtistToAdd[] {
  const artistMap = new Map<string, ArtistToAdd>();
  for (const track of tracks) {
    if (track.artist && !artistMap.has(track.artist.name)) {
      artistMap.set(track.artist.name, {
        name: track.artist.name,
        source,
      });
    }
  }
  return Array.from(artistMap.values());
}

/** Shorthand for a result with only artists. */
function artistResult(artists: ArtistToAdd[]): SubscriptionStrategyResult {
  return { artists, albums: [] };
}

// ---------------------------------------------------------------------------
// Authenticated strategies
// ---------------------------------------------------------------------------

/** deezer_favorites – unique artists from user's favorite tracks. */
const deezerFavorites: SubscriptionStrategy = {
  async execute(context) {
    const deezer = getDeezerService(context);
    const tracks = await deezer.getAllFavoriteTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'deezer-favorites').slice(0, context.config.limit || 50),
    );
  },
};

/** deezer_history – unique artists from user's listening history. */
const deezerHistory: SubscriptionStrategy = {
  async execute(context) {
    const deezer = getDeezerService(context);
    const tracks = await deezer.getAllListeningHistory();
    return artistResult(
      extractArtistsFromTracks(tracks, 'deezer-history').slice(0, context.config.limit || 50),
    );
  },
};

/** deezer_flow – unique artists from user's Flow (personalised radio). */
const deezerFlow: SubscriptionStrategy = {
  async execute(context) {
    const deezer = getDeezerService(context);
    const flow = await deezer.getFlow(context.config.limit || 50);
    return artistResult(
      extractArtistsFromTracks(flow.data, 'deezer-flow'),
    );
  },
};

/** deezer_playlist – unique artists from a single Deezer playlist. */
const deezerPlaylist: SubscriptionStrategy = {
  async execute(context) {
    const deezer = getDeezerService(context);
    const tracks = await deezer.getAllPlaylistTracks(context.config.playlistId);
    return artistResult(
      extractArtistsFromTracks(tracks, `deezer-playlist-${context.config.playlistId}`),
    );
  },
};

/** deezer_playlists – unique artists across all of a user's playlists (max 10). */
const deezerPlaylists: SubscriptionStrategy = {
  async execute(context) {
    const deezer = getDeezerService(context);
    const playlists = await deezer.getAllPlaylists();

    const artistMap = new Map<string, ArtistToAdd>();
    for (const playlist of playlists.slice(0, 10)) {
      const tracks = await deezer.getAllPlaylistTracks(playlist.id.toString());
      for (const track of tracks) {
        if (track.artist && !artistMap.has(track.artist.name)) {
          artistMap.set(track.artist.name, {
            name: track.artist.name,
            source: 'deezer-playlists',
          });
        }
      }
    }
    return artistResult(
      Array.from(artistMap.values()).slice(0, context.config.limit || 50),
    );
  },
};

// ---------------------------------------------------------------------------
// Public (no-auth) strategies
// ---------------------------------------------------------------------------

/** deezer_chart – top artists from public Deezer charts. */
const deezerChart: SubscriptionStrategy = {
  async execute(context) {
    const chartArtists = await getDeezerChartArtists(context.config.limit || 100);
    return artistResult(
      chartArtists.map(a => ({ name: a.name, source: 'deezer-chart' })),
    );
  },
};

/** deezer_genre – top artists for a given Deezer genre. */
const deezerGenre: SubscriptionStrategy = {
  async execute(context) {
    const genreId = context.config.genreId;
    if (!genreId) throw new Error('Genre ID is required for Deezer Genre subscription');
    const genreArtists = await getDeezerGenreArtists(genreId, context.config.limit || 100);
    return artistResult(
      genreArtists.map(a => ({ name: a.name, source: `deezer-genre-${genreId}` })),
    );
  },
};

/** deezer_search – artists matching a public Deezer search query. */
const deezerSearch: SubscriptionStrategy = {
  async execute(context) {
    const query = context.config.query;
    if (!query) throw new Error('Search query is required for Deezer Search subscription');
    const searchResults = await searchDeezerArtists(query, context.config.limit || 25);
    return artistResult(
      searchResults.map(a => ({ name: a.name, source: 'deezer-search' })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('deezer_favorites', deezerFavorites);
registerStrategy('deezer_history', deezerHistory);
registerStrategy('deezer_flow', deezerFlow);
registerStrategy('deezer_playlist', deezerPlaylist);
registerStrategy('deezer_playlists', deezerPlaylists);
registerStrategy('deezer_chart', deezerChart);
registerStrategy('deezer_genre', deezerGenre);
registerStrategy('deezer_search', deezerSearch);
