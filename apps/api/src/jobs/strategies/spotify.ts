/**
 * Spotify subscription strategies.
 *
 * Each Spotify subscription type is implemented as a SubscriptionStrategy and
 * registered in the global strategy registry at module load time.
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
import { SpotifyService } from '../../services/spotify.js';
import { isSpotifyConfig } from '../../types/connections.js';
import {
  fetchPublicPlaylist,
  parseSpotifyPlaylistUrl,
  extractArtistsFromPlaylist,
} from '../../services/public-playlist.js';
import { extractArtistsFromTracks } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a SpotifyService from the strategy context. */
function getSpotifyService(context: StrategyContext): SpotifyService {
  const conn = context.connections.get('spotify');
  if (!conn) throw new Error('No active Spotify connection');
  if (!isSpotifyConfig(conn.config)) throw new Error('Invalid Spotify connection config');
  return new SpotifyService(conn.config);
}



// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/** spotify_playlist – public playlist (no auth), extract unique artists. */
const spotifyPlaylist: SubscriptionStrategy = {
  async execute(context) {
    const playlistId = context.config.playlistId;
    if (!playlistId) throw new Error('Playlist ID is required');
    const playlist = await fetchPublicPlaylist(playlistId);
    return artistResult(
      extractArtistsFromTracks(playlist.tracks, `spotify-playlist-${playlistId}`),
    );
  },
};

/** spotify_followed – authenticated followed artists. */
const spotifyFollowed: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const followedArtists = await spotify.getAllFollowedArtists();
    return artistResult(
      followedArtists.map(a => ({ name: a.name, source: 'spotify-followed' })),
    );
  },
};

/** spotify_saved_albums – album discovery from user's saved albums. */
const spotifySavedAlbums: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const albums = await spotify.getAllSavedAlbums();
    return albumResult(
      albums.map(album => ({
        albumName: album.name,
        artistName: album.artists[0]?.name || 'Unknown Artist',
        releaseDate: album.release_date,
        releaseYear: album.release_date
          ? parseInt(album.release_date.split('-')[0])
          : undefined,
        releaseType: 'album',
        source: 'spotify-saved-albums',
      })),
    );
  },
};

/** spotify_liked_songs – unique artists from all liked tracks. */
const spotifyLikedSongs: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const tracks = await spotify.getAllLikedSongs();
    return artistResult(
      extractArtistsFromTracks(tracks, 'spotify-liked-songs'),
    );
  },
};

/** spotify_new_releases – albums or artists depending on config.discoverAlbums. */
const spotifyNewReleases: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const { config } = context;
    const albums = await spotify.getAllNewReleases(config.limit || 50, config.country);

    if (config.discoverAlbums) {
      return albumResult(
        albums.map(album => ({
          albumName: album.name,
          artistName: album.artists[0]?.name || 'Unknown Artist',
          releaseDate: album.release_date,
          releaseYear: album.release_date
            ? parseInt(album.release_date.split('-')[0])
            : undefined,
          releaseType: 'album',
          source: 'spotify-new-releases',
        })),
      );
    }

    // Artist discovery mode (default)
    const artistMap = new Map<string, ArtistToAdd>();
    for (const album of albums) {
      for (const artist of album.artists) {
        if (!artistMap.has(artist.name)) {
          artistMap.set(artist.name, { name: artist.name, source: 'spotify-new-releases' });
        }
      }
    }
    return artistResult(Array.from(artistMap.values()));
  },
};

/** spotify_discover_weekly – unique artists from Discover Weekly tracks. */
const spotifyDiscoverWeekly: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const tracks = await spotify.getDiscoverWeeklyTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'spotify-discover-weekly'),
    );
  },
};

/** spotify_release_radar – unique artists from Release Radar tracks. */
const spotifyReleaseRadar: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const tracks = await spotify.getReleaseRadarTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'spotify-release-radar'),
    );
  },
};

/** spotify_daily_mix – unique artists from Daily Mix tracks. */
const spotifyDailyMix: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const tracks = await spotify.getDailyMixTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'spotify-daily-mix'),
    );
  },
};

/** spotify_on_repeat – unique artists from On Repeat tracks. */
const spotifyOnRepeat: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const tracks = await spotify.getOnRepeatTracks();
    return artistResult(
      extractArtistsFromTracks(tracks, 'spotify-on-repeat'),
    );
  },
};

/** spotify_featured – artists from Spotify Featured Playlists. */
const spotifyFeatured: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const spotifyArtists = await spotify.getFeaturedPlaylistsArtists(
      context.config.limit || 50,
    );
    return artistResult(
      spotifyArtists.map(a => ({ name: a.name, source: 'spotify-featured' })),
    );
  },
};

/** spotify_category – artists from a Spotify Browse category. */
const spotifyCategory: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const { config } = context;
    if (!config.categoryId) throw new Error('Category ID is required');
    const spotifyArtists = await spotify.getCategoryArtists(
      config.categoryId,
      config.limit || 50,
    );
    return artistResult(
      spotifyArtists.map(a => ({
        name: a.name,
        source: `spotify-category-${config.categoryId}`,
      })),
    );
  },
};

/** spotify_library – combined followed + liked songs + saved albums (deduplicated). */
const spotifyLibrary: SubscriptionStrategy = {
  async execute(context) {
    const spotify = getSpotifyService(context);
    const artistMap = new Map<string, ArtistToAdd>();

    // Followed artists
    const followed = await spotify.getAllFollowedArtists();
    for (const artist of followed) {
      if (!artistMap.has(artist.name)) {
        artistMap.set(artist.name, { name: artist.name, source: 'spotify-library-followed' });
      }
    }

    // Artists from liked songs
    const likedSongs = await spotify.getAllLikedSongs();
    for (const track of likedSongs) {
      for (const artist of track.artists) {
        if (!artistMap.has(artist.name)) {
          artistMap.set(artist.name, { name: artist.name, source: 'spotify-library-liked' });
        }
      }
    }

    // Artists from saved albums
    const savedAlbums = await spotify.getAllSavedAlbums();
    for (const album of savedAlbums) {
      for (const artist of album.artists) {
        if (!artistMap.has(artist.name)) {
          artistMap.set(artist.name, { name: artist.name, source: 'spotify-library-albums' });
        }
      }
    }

    return artistResult(Array.from(artistMap.values()));
  },
};

/** spotify_public_playlist – public playlist URL import (no auth). */
const spotifyPublicPlaylist: SubscriptionStrategy = {
  async execute(context) {
    const { config } = context;
    const playlistUrl = config.playlistUrl;
    if (!playlistUrl) throw new Error('Playlist URL is required');

    const playlistId = parseSpotifyPlaylistUrl(playlistUrl);
    if (!playlistId) throw new Error('Invalid Spotify playlist URL');

    const playlist = await fetchPublicPlaylist(playlistId);
    const includeAllArtists = config.includeAllArtists || false;

    if (config.discoverAlbums) {
      // Album discovery mode
      const albumMap = new Map<string, AlbumToAdd>();
      for (const track of playlist.tracks) {
        const artistName = track.artists[0]?.name || 'Unknown Artist';
        const key = `${artistName}-${track.name}`.toLowerCase();
        if (!albumMap.has(key)) {
          albumMap.set(key, {
            albumName: track.name,
            artistName,
            source: `spotify-public-playlist-${playlistId}`,
          });
        }
      }
      return albumResult(
        Array.from(albumMap.values()).slice(0, config.limit || 100),
      );
    }

    // Artist discovery mode (default)
    const artistNames = extractArtistsFromPlaylist(playlist.tracks, { includeAllArtists });
    return artistResult(
      artistNames.slice(0, config.limit || 100).map(name => ({
        name,
        source: `spotify-public-playlist-${playlistId}`,
      })),
    );
  },
};

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

registerStrategy('spotify_playlist', spotifyPlaylist);
registerStrategy('spotify_followed', spotifyFollowed);
registerStrategy('spotify_saved_albums', spotifySavedAlbums);
registerStrategy('spotify_liked_songs', spotifyLikedSongs);
registerStrategy('spotify_new_releases', spotifyNewReleases);
registerStrategy('spotify_discover_weekly', spotifyDiscoverWeekly);
registerStrategy('spotify_release_radar', spotifyReleaseRadar);
registerStrategy('spotify_daily_mix', spotifyDailyMix);
registerStrategy('spotify_on_repeat', spotifyOnRepeat);
registerStrategy('spotify_featured', spotifyFeatured);
registerStrategy('spotify_category', spotifyCategory);
registerStrategy('spotify_library', spotifyLibrary);
registerStrategy('spotify_public_playlist', spotifyPublicPlaylist);
