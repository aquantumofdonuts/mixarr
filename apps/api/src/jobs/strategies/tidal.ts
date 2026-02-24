/**
 * TIDAL subscription strategies.
 *
 * Each TIDAL subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
 *
 * All strategies require an active TIDAL connection with
 * clientId, clientSecret, accessToken, and refreshToken.
 */

import { registerStrategy } from './registry.js';
import {
  artistResult,
  albumResult,
  type SubscriptionStrategy,
  type StrategyContext,
  type ArtistToAdd,
  type AlbumToAdd,
} from './types.js';
import { TidalService } from '../../services/tidal.js';
import { isTidalConfig } from '../../types/connections.js';
import { extractArtistsFromTracks } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a TidalService from the strategy context. */
function getTidalService(context: StrategyContext): TidalService {
  const conn = context.connections.get('tidal');
  if (!conn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
  if (!isTidalConfig(conn.config)) throw new Error('Invalid TIDAL connection config');
  return new TidalService({
    clientId: conn.config.clientId,
    clientSecret: conn.config.clientSecret,
    accessToken: conn.config.accessToken,
    refreshToken: conn.config.refreshToken,
  });
}



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** tidal_favorites – unique artists from user's favorite/collection tracks. */
const tidalFavorites: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const tracks = await tidal.getCollectionTracks(context.config.limit || 50);
    return artistResult(extractArtistsFromTracks(tracks, 'tidal-favorites'));
  },
};

/** tidal_followed_artists – artists the user follows on TIDAL. */
const tidalFollowedArtists: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const followedArtists = await tidal.getCollectionArtists(context.config.limit || 100);
    return artistResult(
      followedArtists.map(a => ({ name: a.name, source: 'tidal-followed' })),
    );
  },
};

/** tidal_playlist – unique artists from a single TIDAL playlist. */
const tidalPlaylist: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const tracks = await tidal.getPlaylistTracks(context.config.playlistId, context.config.limit || 50);
    return artistResult(
      extractArtistsFromTracks(tracks, `tidal-playlist-${context.config.playlistId}`),
    );
  },
};

/** tidal_playlists – unique artists across all user playlists (max 10 playlists). */
const tidalPlaylists: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const playlists = await tidal.getPlaylists(50);

    const artistMap = new Map<string, ArtistToAdd>();
    for (const playlist of playlists.slice(0, 10)) {
      const tracks = await tidal.getPlaylistTracks(playlist.id, 50);
      for (const track of tracks) {
        for (const artist of track.artists) {
          if (!artistMap.has(artist.name)) {
            artistMap.set(artist.name, {
              name: artist.name,
              source: 'tidal-playlists',
            });
          }
        }
      }
    }
    return artistResult(
      Array.from(artistMap.values()).slice(0, context.config.limit || 50),
    );
  },
};

/** tidal_discovery – unique artists from TIDAL discovery mix tracks. */
const tidalDiscovery: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const tracks = await tidal.getDiscoveryMixTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'tidal-discovery').slice(0, context.config.limit || 50),
    );
  },
};

/** tidal_new_arrivals – discover ALBUMS (not artists) from new arrival tracks. */
const tidalNewArrivals: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const tracks = await tidal.getNewArrivalTracks();

    const albumMap = new Map<string, AlbumToAdd>();
    for (const track of tracks) {
      if (track.album && !albumMap.has(track.album.id)) {
        albumMap.set(track.album.id, {
          albumName: track.album.title,
          artistName: track.artists[0]?.name || 'Unknown Artist',
          releaseType: 'album',
          source: 'tidal-new-arrivals',
        });
      }
    }
    return albumResult(
      Array.from(albumMap.values()).slice(0, context.config.limit || 50),
    );
  },
};

/** tidal_mix – unique artists from the user's My Mixes (first 3 mixes). */
const tidalMix: SubscriptionStrategy = {
  async execute(context) {
    const tidal = getTidalService(context);
    const mixes = await tidal.getMyMixes();

    const allTracks: Awaited<ReturnType<typeof tidal.getPlaylistTracks>> = [];
    for (const mix of mixes.slice(0, 3)) {
      const tracks = await tidal.getPlaylistTracks(mix.id, 50);
      allTracks.push(...tracks);
    }

    return artistResult(
      extractArtistsFromTracks(allTracks, 'tidal-mix').slice(0, context.config.limit || 50),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('tidal_favorites', tidalFavorites);
registerStrategy('tidal_followed_artists', tidalFollowedArtists);
registerStrategy('tidal_playlist', tidalPlaylist);
registerStrategy('tidal_playlists', tidalPlaylists);
registerStrategy('tidal_discovery', tidalDiscovery);
registerStrategy('tidal_new_arrivals', tidalNewArrivals);
registerStrategy('tidal_mix', tidalMix);
