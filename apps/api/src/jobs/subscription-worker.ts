/**
 * Subscription Worker
 * 
 * Processes subscription jobs - fetches artists from Last.fm/Spotify/Deezer/TIDAL and adds to Lidarr.
 */

import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import prisma from '../lib/db.js';
import { QUEUE_NAMES, type SubscriptionJobData } from './queue.js';
import { LidarrService, LidarrCache } from '../services/lidarr.js';
import { SpotifyService } from '../services/spotify.js';
import { LastfmService } from '../services/lastfm.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { AIService } from '../services/ai.js';
import { DeezerOAuthService } from '../services/deezer-oauth.js';
import { getDeezerChartArtists, getDeezerGenreArtists, searchDeezerArtists } from '../services/deezer.js';
import { TidalService } from '../services/tidal.js';
import { ListenBrainzService, VALID_PERIODS, type ListenBrainzPeriod } from '../services/listenbrainz.js';
import { DiscogsService } from '../services/discogs.js';
import { BandcampService } from '../services/bandcamp.js';
import { addLogEntry } from '../routes/logs.js';
import { deduplicateResults } from '../utils/deduplication.js';
import { findOrCreateReviewItem } from '../utils/review-queue.js';
import { notificationService } from '../services/notifications.js';

interface ArtistToAdd {
  name: string;
  mbid?: string;
  source: string;
}

interface AlbumToAdd {
  albumName: string;
  artistName: string;
  albumMbid?: string;
  artistMbid?: string;
  releaseDate?: string;
  releaseYear?: number;
  releaseType?: string;
  source: string;
}

async function processSubscription(job: Job<SubscriptionJobData>): Promise<void> {
  const { subscriptionId, userId } = job.data;
  
  // Create run record
  const run = await prisma.subscriptionRun.create({
    data: {
      subscriptionId,
      status: 'running',
      startedAt: new Date(),
    },
  });

  try {
    // Get subscription details with its linked connection
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { connection: true },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    // Use subscription owner's userId for connection lookup
    const subUserId = subscription.userId;

    // Batch fetch all connections for user and global in one query
    // This avoids N+1 queries when looking up individual connection types
    const allConnections = await prisma.connection.findMany({
      where: {
        OR: [
          { userId: subUserId, isActive: true },
          { userId: null, isActive: true },
        ],
      },
    });

    // Build a map for quick lookup: type -> connection (prefer user's over global)
    const connectionMap = new Map<string, typeof allConnections[0]>();
    // First add global connections
    for (const conn of allConnections) {
      if (conn.userId === null) {
        connectionMap.set(conn.type, conn);
      }
    }
    // Then override with user connections (higher priority)
    for (const conn of allConnections) {
      if (conn.userId === subUserId) {
        connectionMap.set(conn.type, conn);
      }
    }
    // Finally, if subscription has a linked connection, use that
    if (subscription.connection?.isActive) {
      connectionMap.set(subscription.connection.type, subscription.connection);
    }

    // Helper to find connection by type (now O(1) lookup)
    function findConnection(type: string) {
      return connectionMap.get(type) || null;
    }

    // Get all connections from the pre-built map
    const lidarrConn = findConnection('lidarr');
    const spotifyConn = findConnection('spotify');
    const lastfmConn = findConnection('lastfm');
    const tautulliConn = findConnection('tautulli');
    const deezerConn = findConnection('deezer');
    const tidalConn = findConnection('tidal');
    const listenbrainzConn = findConnection('listenbrainz');
    const discogsConn = findConnection('discogs');

    if (!lidarrConn) {
      throw new Error('No active Lidarr connection');
    }

    const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
    const lidarr = new LidarrService(lidarrConfig);
    const lidarrCache = new LidarrCache(lidarr);
    await lidarrCache.refresh();

    const musicbrainz = new MusicBrainzService();
    const config = subscription.config as Record<string, any>;
    
    let artists: ArtistToAdd[] = [];
    let albumsToAdd: AlbumToAdd[] = [];

    // Fetch artists based on subscription type
    switch (subscription.type) {
      case 'lastfm_chart': {
        if (!lastfmConn) throw new Error('No active Last.fm connection');
        const lastfm = new LastfmService({ apiKey: (lastfmConn.config as any).apiKey });
        const result = await lastfm.getTopArtists(config.limit || 50);
        artists = result.artists.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: 'lastfm-chart',
        }));
        break;
      }

      case 'lastfm_tag': {
        if (!lastfmConn) throw new Error('No active Last.fm connection');
        const lastfm = new LastfmService({ apiKey: (lastfmConn.config as any).apiKey });
        const result = await lastfm.getTagTopArtists(config.tag, config.limit || 50);
        artists = result.artists.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `lastfm-tag-${config.tag}`,
        }));
        break;
      }

      case 'lastfm_geo': {
        if (!lastfmConn) throw new Error('No active Last.fm connection');
        const lastfm = new LastfmService({ apiKey: (lastfmConn.config as any).apiKey });
        const result = await lastfm.getGeoTopArtists(config.country, config.limit || 50);
        artists = result.artists.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `lastfm-geo-${config.country}`,
        }));
        break;
      }

      case 'spotify_playlist': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        console.log('Subscription config:', JSON.stringify(config));
        console.log('Playlist ID:', config.playlistId);
        console.log('Spotify connection config keys:', Object.keys(spotifyConfig));
        console.log('Has access token:', !!spotifyConfig.accessToken);
        console.log('Has refresh token:', !!spotifyConfig.refreshToken);
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getAllPlaylistTracks(config.playlistId);
        
        // Extract unique artists
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: `spotify-playlist-${config.playlistId}`,
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'spotify_followed': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const followedArtists = await spotify.getAllFollowedArtists();
        artists = followedArtists.map(a => ({
          name: a.name,
          source: 'spotify-followed',
        }));
        break;
      }

      case 'spotify_saved_albums': {
        // User's saved albums - discover albums, not artists
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const albums = await spotify.getAllSavedAlbums();
        
        // Saved albums = album discovery (user explicitly saved these albums)
        albumsToAdd = albums.map(album => ({
          albumName: album.name,
          artistName: album.artists[0]?.name || 'Unknown Artist',
          releaseDate: album.release_date,
          releaseYear: album.release_date ? parseInt(album.release_date.split('-')[0]) : undefined,
          releaseType: 'album',
          source: 'spotify-saved-albums',
        }));
        break;
      }

      case 'spotify_liked_songs': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getAllLikedSongs();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-liked-songs',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'musicbrainz_new': {
        // New releases from MusicBrainz - discover albums, not artists
        const year = new Date().getFullYear();
        const result = await musicbrainz.searchByYear(year, config.limit || 50);
        
        // Release groups = album discovery
        albumsToAdd = result.releaseGroups.map(rg => {
          const artistCredit = rg['artist-credit'];
          const artist = artistCredit?.[0]?.artist;
          return {
            albumName: rg.title,
            artistName: artist?.name || 'Unknown Artist',
            albumMbid: rg.id,
            artistMbid: artist?.id,
            releaseDate: rg['first-release-date'],
            releaseYear: rg['first-release-date'] ? parseInt(rg['first-release-date'].split('-')[0]) : year,
            releaseType: rg['primary-type'] || 'album',
            source: 'musicbrainz-new',
          };
        });
        break;
      }

      case 'spotify_new_releases': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const albums = await spotify.getAllNewReleases(config.limit || 50, config.country);
        
        if (config.discoverAlbums) {
          // Album discovery mode - add albums to review queue
          albumsToAdd = albums.map(album => ({
            albumName: album.name,
            artistName: album.artists[0]?.name || 'Unknown Artist',
            releaseDate: album.release_date,
            releaseYear: album.release_date ? parseInt(album.release_date.split('-')[0]) : undefined,
            releaseType: 'album',
            source: 'spotify-new-releases',
          }));
        } else {
          // Artist discovery mode (default) - extract artists from albums
          const artistMap = new Map<string, ArtistToAdd>();
          for (const album of albums) {
            for (const artist of album.artists) {
              if (!artistMap.has(artist.name)) {
                artistMap.set(artist.name, {
                  name: artist.name,
                  source: 'spotify-new-releases',
                });
              }
            }
          }
          artists = Array.from(artistMap.values());
        }
        break;
      }

      case 'spotify_discover_weekly': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getDiscoverWeeklyTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-discover-weekly',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'spotify_release_radar': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getReleaseRadarTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-release-radar',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'spotify_daily_mix': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getDailyMixTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-daily-mix',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'spotify_on_repeat': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const tracks = await spotify.getOnRepeatTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-on-repeat',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'spotify_featured': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const spotifyArtists = await spotify.getFeaturedPlaylistsArtists(config.limit || 50);
        
        artists = spotifyArtists.map(a => ({
          name: a.name,
          source: 'spotify-featured',
        }));
        break;
      }

      case 'spotify_category': {
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        const spotifyArtists = await spotify.getCategoryArtists(config.categoryId, config.limit || 50);
        
        artists = spotifyArtists.map(a => ({
          name: a.name,
          source: `spotify-category-${config.categoryId}`,
        }));
        break;
      }

      case 'ai_recommendation': {
        // AI recommendations based on source library (Spotify or Last.fm)
        const source = config.source as 'spotify' | 'lastfm';
        const strategy = config.strategy || 'similar';
        const limit = config.limit || 20;
        
        // Get source artists to analyze
        let sourceArtists: string[] = [];
        
        if (source === 'spotify') {
          if (!spotifyConn) throw new Error('No active Spotify connection');
          const spotifyConfig = spotifyConn.config as any;
          const spotify = new SpotifyService(spotifyConfig);
          const followed = await spotify.getAllFollowedArtists();
          sourceArtists = followed.slice(0, 20).map(a => a.name);
        } else if (source === 'lastfm') {
          if (!lastfmConn) throw new Error('No active Last.fm connection');
          const lastfm = new LastfmService({ apiKey: (lastfmConn.config as any).apiKey });
          const top = await lastfm.getTopArtists(20);
          sourceArtists = top.artists.map(a => a.name);
        }
        
        if (sourceArtists.length === 0) {
          throw new Error(`No artists found in ${source} library to analyze`);
        }
        
        // Get AI recommendations
        const aiService = new AIService();
        await aiService.loadSettings();
        
        // Override strategy from subscription config
        const recs = await aiService.getRecommendationsWithStrategy(
          sourceArtists,
          strategy,
          limit
        );
        
        artists = recs.map(r => ({
          name: r.name,
          source: `ai-${source}-${strategy}`,
        }));
        break;
      }

      case 'spotify_library': {
        // Sync entire Spotify library (followed + liked songs + saved albums)
        if (!spotifyConn) throw new Error('No active Spotify connection');
        const spotifyConfig = spotifyConn.config as any;
        const spotify = new SpotifyService(spotifyConfig);
        
        const artistMap = new Map<string, ArtistToAdd>();
        
        // Get followed artists
        const followed = await spotify.getAllFollowedArtists();
        for (const artist of followed) {
          if (!artistMap.has(artist.name)) {
            artistMap.set(artist.name, {
              name: artist.name,
              source: 'spotify-library-followed',
            });
          }
        }
        
        // Get artists from liked songs
        const likedSongs = await spotify.getAllLikedSongs();
        for (const track of likedSongs) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-library-liked',
              });
            }
          }
        }
        
        // Get artists from saved albums
        const savedAlbums = await spotify.getAllSavedAlbums();
        for (const album of savedAlbums) {
          for (const artist of album.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'spotify-library-albums',
              });
            }
          }
        }
        
        artists = Array.from(artistMap.values());
        break;
      }

      case 'lastfm_library': {
        // Sync user's Last.fm top artists from scrobble history
        if (!lastfmConn) throw new Error('No active Last.fm connection');
        const lastfmConfig = lastfmConn.config as any;
        if (!lastfmConfig.username) {
          throw new Error('Last.fm connection is missing username. Please update your Last.fm connection with your username.');
        }
        const lastfm = new LastfmService({ apiKey: lastfmConfig.apiKey });
        const period = config.period || 'overall'; // overall, 7day, 1month, 3month, 6month, 12month
        const limit = config.limit || 100;
        const result = await lastfm.getUserTopArtists(lastfmConfig.username, period, limit);
        artists = result.artists.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `lastfm-library-${period}`,
        }));
        break;
      }

      case 'lastfm_similar': {
        // Get artists similar to user's top scrobbled artists
        if (!lastfmConn) throw new Error('No active Last.fm connection');
        const lastfmConfigSim = lastfmConn.config as any;
        if (!lastfmConfigSim.username) {
          throw new Error('Last.fm connection is missing username. Please update your Last.fm connection with your username.');
        }
        const lastfmSim = new LastfmService({ apiKey: lastfmConfigSim.apiKey });
        
        // Config options
        const topArtistsLimit = config.topArtistsLimit || 20; // How many of user's top artists to use as seeds
        const similarPerArtist = config.similarPerArtist || 10; // How many similar artists per seed
        const period = config.period || 'overall';
        const totalLimit = config.limit || 100; // Max total results
        
        // Get user's top artists as seed artists
        const topResult = await lastfmSim.getUserTopArtists(lastfmConfigSim.username, period, topArtistsLimit);
        const seedArtists = topResult.artists;
        
        // Collect similar artists from each seed
        const similarMap = new Map<string, { name: string; mbid?: string; match: number; seedCount: number }>();
        
        for (const seed of seedArtists) {
          try {
            const similarArtists = await lastfmSim.getSimilarArtists(seed.name, similarPerArtist);
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
        
        artists = sortedSimilar.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `lastfm-similar-${period}`,
        }));
        break;
      }

      case 'tautulli_similar': {
        // Get artists similar to user's top Plex listening history
        if (!tautulliConn) throw new Error('No active Tautulli connection. Please add a Tautulli connection first.');
        if (!lastfmConn) throw new Error('No active Last.fm connection. Required for similar artist lookup.');
        
        const tautulliConfig = tautulliConn.config as any;
        const lastfmConfigSim = lastfmConn.config as any;
        
        // Import TautulliService dynamically to avoid circular dependencies
        const { TautulliService } = await import('../services/tautulli.js');
        const tautulli = new TautulliService();
        const lastfmSim = new LastfmService({ apiKey: lastfmConfigSim.apiKey });
        
        // Config options
        const period = config.period || 'month';
        const seedLimit = config.seedLimit || 10;
        const similarPerSeed = config.similarPerSeed || 5;
        const totalLimit = config.limit || 50;
        const minMatchCount = config.minMatchCount || 1;
        
        // Get top artists from Plex listening history
        const topArtists = await tautulli.getTopArtists(
          {
            tautulliUrl: tautulliConfig.tautulliUrl,
            tautulliApiKey: tautulliConfig.tautulliApiKey,
            plexUserId: tautulliConfig.plexUserId,
            plexLibraryId: tautulliConfig.plexLibraryId,
          },
          { period: period as 'week' | 'month' | 'year' | 'all', limit: seedLimit }
        );
        
        if (topArtists.length === 0) {
          throw new Error(`No listening history found for Plex user (period: ${period})`);
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
        
        artists = sortedSimilar.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `tautulli-similar-${period}`,
        }));
        break;
      }

      // DEEZER SUBSCRIPTION TYPES

      case 'deezer_favorites': {
        if (!deezerConn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
        const deezerConfig = deezerConn.config as any;
        const deezer = new DeezerOAuthService({
          appId: deezerConfig.appId,
          appSecret: deezerConfig.appSecret,
          accessToken: deezerConfig.accessToken,
        });
        const tracks = await deezer.getAllFavoriteTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          if (track.artist && !artistMap.has(track.artist.name)) {
            artistMap.set(track.artist.name, {
              name: track.artist.name,
              source: 'deezer-favorites',
            });
          }
        }
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'deezer_history': {
        if (!deezerConn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
        const deezerConfig = deezerConn.config as any;
        const deezer = new DeezerOAuthService({
          appId: deezerConfig.appId,
          appSecret: deezerConfig.appSecret,
          accessToken: deezerConfig.accessToken,
        });
        const tracks = await deezer.getAllListeningHistory();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          if (track.artist && !artistMap.has(track.artist.name)) {
            artistMap.set(track.artist.name, {
              name: track.artist.name,
              source: 'deezer-history',
            });
          }
        }
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'deezer_flow': {
        if (!deezerConn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
        const deezerConfig = deezerConn.config as any;
        const deezer = new DeezerOAuthService({
          appId: deezerConfig.appId,
          appSecret: deezerConfig.appSecret,
          accessToken: deezerConfig.accessToken,
        });
        const flow = await deezer.getFlow(config.limit || 50);
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of flow.data) {
          if (track.artist && !artistMap.has(track.artist.name)) {
            artistMap.set(track.artist.name, {
              name: track.artist.name,
              source: 'deezer-flow',
            });
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'deezer_playlist': {
        if (!deezerConn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
        const deezerConfig = deezerConn.config as any;
        const deezer = new DeezerOAuthService({
          appId: deezerConfig.appId,
          appSecret: deezerConfig.appSecret,
          accessToken: deezerConfig.accessToken,
        });
        const tracks = await deezer.getAllPlaylistTracks(config.playlistId);
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          if (track.artist && !artistMap.has(track.artist.name)) {
            artistMap.set(track.artist.name, {
              name: track.artist.name,
              source: `deezer-playlist-${config.playlistId}`,
            });
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'deezer_playlists': {
        // All artists from all user's playlists
        if (!deezerConn) throw new Error('No active Deezer connection. Please add a Deezer connection first.');
        const deezerConfig = deezerConn.config as any;
        const deezer = new DeezerOAuthService({
          appId: deezerConfig.appId,
          appSecret: deezerConfig.appSecret,
          accessToken: deezerConfig.accessToken,
        });
        const playlists = await deezer.getAllPlaylists();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const playlist of playlists.slice(0, 10)) { // Limit to first 10 playlists
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
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'deezer_chart': {
        // Public API - no authentication required
        const chartArtists = await getDeezerChartArtists(config.limit || 100);
        
        artists = chartArtists.map(a => ({
          name: a.name,
          source: 'deezer-chart',
        }));
        break;
      }

      case 'deezer_genre': {
        // Public API - no authentication required
        const genreId = config.genreId;
        if (!genreId) throw new Error('Genre ID is required for Deezer Genre subscription');
        
        const genreArtists = await getDeezerGenreArtists(genreId, config.limit || 100);
        
        artists = genreArtists.map(a => ({
          name: a.name,
          source: `deezer-genre-${genreId}`,
        }));
        break;
      }

      case 'deezer_search': {
        // Public API - no authentication required
        const query = config.query;
        if (!query) throw new Error('Search query is required for Deezer Search subscription');
        
        const searchResults = await searchDeezerArtists(query, config.limit || 25);
        
        artists = searchResults.map(a => ({
          name: a.name,
          source: 'deezer-search',
        }));
        break;
      }

      // TIDAL SUBSCRIPTION TYPES

      case 'tidal_favorites': {
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const tracks = await tidal.getCollectionTracks(config.limit || 50);
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'tidal-favorites',
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'tidal_followed_artists': {
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const followedArtists = await tidal.getCollectionArtists(config.limit || 100);
        
        artists = followedArtists.map(a => ({
          name: a.name,
          source: 'tidal-followed',
        }));
        break;
      }

      case 'tidal_playlist': {
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const tracks = await tidal.getPlaylistTracks(config.playlistId, config.limit || 50);
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: `tidal-playlist-${config.playlistId}`,
              });
            }
          }
        }
        artists = Array.from(artistMap.values());
        break;
      }

      case 'tidal_playlists': {
        // All artists from all user's playlists
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const playlists = await tidal.getPlaylists(50);
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const playlist of playlists.slice(0, 10)) { // Limit to first 10 playlists
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
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'tidal_discovery': {
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const tracks = await tidal.getDiscoveryMixTracks();
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'tidal-discovery',
              });
            }
          }
        }
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'tidal_new_arrivals': {
        // New arrivals - discover albums, not artists
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        const tracks = await tidal.getNewArrivalTracks();
        
        // New arrivals = album discovery - extract unique albums from tracks
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
        albumsToAdd = Array.from(albumMap.values()).slice(0, config.limit || 50);
        break;
      }

      case 'tidal_mix': {
        if (!tidalConn) throw new Error('No active TIDAL connection. Please add a TIDAL connection first.');
        const tidalConfig = tidalConn.config as any;
        const tidal = new TidalService({
          clientId: tidalConfig.clientId,
          clientSecret: tidalConfig.clientSecret,
          accessToken: tidalConfig.accessToken,
          refreshToken: tidalConfig.refreshToken,
        });
        
        // Get My Mixes
        const mixes = await tidal.getMyMixes();
        const allTracks: Awaited<ReturnType<typeof tidal.getPlaylistTracks>> = [];
        
        for (const mix of mixes.slice(0, 3)) {
          const tracks = await tidal.getPlaylistTracks(mix.id, 50);
          allTracks.push(...tracks);
        }
        
        const artistMap = new Map<string, ArtistToAdd>();
        for (const track of allTracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.name)) {
              artistMap.set(artist.name, {
                name: artist.name,
                source: 'tidal-mix',
              });
            }
          }
        }
        artists = Array.from(artistMap.values()).slice(0, config.limit || 50);
        break;
      }

      // LISTENBRAINZ SUBSCRIPTION TYPES

      case 'listenbrainz_top': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        // Validate period against allowed values
        const period: ListenBrainzPeriod = VALID_PERIODS.includes(config.period) ? config.period : 'all_time';
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getUserTopArtists(period, limit);
        
        artists = result.artists.map(a => ({
          name: a.artist_name,
          mbid: a.artist_mbid,
          source: `listenbrainz-top-${period}`,
        }));
        break;
      }

      case 'listenbrainz_similar': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        const limit = config.limit || 50;
        // Validate period against allowed values
        const period: ListenBrainzPeriod = VALID_PERIODS.includes(config.period) ? config.period : 'all_time';
        
        // Get similar users
        const similarUsers = await listenbrainz.getSimilarUsers();
        
        if (similarUsers.length === 0) {
          console.warn(`No similar users found for ${username}. Listen to more music to get similar user recommendations.`);
        }
        
        // Collect top artists from similar users
        const artistMap = new Map<string, { name: string; mbid?: string; count: number }>();
        
        for (const similarUser of similarUsers.slice(0, 5)) {
          try {
            // Use NO token when querying other users' public data
            const similarUserService = new ListenBrainzService(similarUser.user_name);
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
            console.warn(`Failed to fetch top artists for similar user ${similarUser.user_name}:`, error);
          }
        }
        
        // Sort by count (artists appearing in multiple similar users' top lists)
        const sortedArtists = Array.from(artistMap.values())
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);
        
        artists = sortedArtists.map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: 'listenbrainz-similar',
        }));
        break;
      }

      case 'listenbrainz_recommendations': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        // Validate recommendation type
        const validRecTypes = ['top_artist', 'similar_artist'];
        const recType = validRecTypes.includes(config.recommendationType) 
          ? config.recommendationType 
          : 'similar_artist';
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getRecommendations(recType, limit);
        
        if (result.mbids.length === 0) {
          console.warn(`No recommendations available for ${username}. ListenBrainz needs more listening history to generate recommendations.`);
        }
        
        // Recommendations return recording MBIDs, we need to look up artist info
        // Batch lookups to avoid N+1 problem - collect unique MBIDs first
        const artistMap = new Map<string, { name: string; mbid: string }>();
        
        // Process in batches to be more efficient
        const batchSize = 10;
        const mbids = result.mbids.slice(0, limit);
        
        for (let i = 0; i < mbids.length; i += batchSize) {
          const batch = mbids.slice(i, i + batchSize);
          
          // Process batch in parallel for better performance
          await Promise.all(batch.map(async (rec) => {
            try {
              // Look up recording to get artist info
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
        
        artists = Array.from(artistMap.values()).map(a => ({
          name: a.name,
          mbid: a.mbid,
          source: `listenbrainz-recommendations-${recType}`,
        }));
        break;
      }

      case 'listenbrainz_explore': {
        // Fresh releases - discover albums, not artists
        const lbConfig = listenbrainzConn?.config as any;
        const listenbrainz = new ListenBrainzService(lbConfig?.username || 'anonymous');
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getFreshReleases();
        
        // Fresh releases = album discovery
        albumsToAdd = result.releases.slice(0, limit).map(release => ({
          albumName: release.release_name,
          artistName: release.artist_credit_name,
          albumMbid: release.release_mbid,
          artistMbid: release.artist_mbids?.[0],
          releaseDate: release.release_date,
          releaseYear: release.release_date ? parseInt(release.release_date.split('-')[0]) : undefined,
          releaseType: 'album',
          source: 'listenbrainz-explore',
        }));
        break;
      }

      case 'listenbrainz_year': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        const year = config.year || new Date().getFullYear();
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getYearInMusic(year);
        
        artists = result.topArtists.slice(0, limit).map(a => ({
          name: a.artist_name,
          mbid: a.artist_mbid,
          source: `listenbrainz-year-${year}`,
        }));
        break;
      }

      case 'listenbrainz_playlist': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        if (!config.playlistId) throw new Error('Playlist ID is required for ListenBrainz playlist subscription.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getPlaylist(config.playlistId);
        
        // Extract unique artists from playlist tracks
        const artistMap = new Map<string, { name: string; mbid?: string }>();
        for (const track of result.tracks) {
          const key = track.artist_name.toLowerCase();
          if (!artistMap.has(key)) {
            artistMap.set(key, {
              name: track.artist_name,
              mbid: track.artist_mbid,
            });
          }
        }
        
        artists = Array.from(artistMap.values())
          .slice(0, limit)
          .map(a => ({
            name: a.name,
            mbid: a.mbid,
            source: 'listenbrainz-playlist',
          }));
        break;
      }

      case 'listenbrainz_radio': {
        if (!config.seedMbid) throw new Error('Seed artist MBID is required for ListenBrainz radio subscription.');
        
        // Radio endpoint doesn't require auth, but use connection for consistency
        const lbConfig = listenbrainzConn?.config as any;
        const listenbrainz = new ListenBrainzService(lbConfig?.username || 'anonymous');
        const mode = config.mode || 'medium';
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getArtistRadio(config.seedMbid, mode);
        
        // Extract unique artists from radio tracks
        const artistMap = new Map<string, { name: string; mbid?: string }>();
        for (const track of result.tracks) {
          const key = track.artist_name.toLowerCase();
          if (!artistMap.has(key)) {
            artistMap.set(key, {
              name: track.artist_name,
              mbid: track.artist_mbid,
            });
          }
        }
        
        artists = Array.from(artistMap.values())
          .slice(0, limit)
          .map(a => ({
            name: a.name,
            mbid: a.mbid,
            source: 'listenbrainz-radio',
          }));
        break;
      }

      case 'listenbrainz_loved': {
        if (!listenbrainzConn) throw new Error('No active ListenBrainz connection. Please add a ListenBrainz connection first.');
        const lbConfig = listenbrainzConn.config as any;
        const username = config.username || lbConfig.username;
        if (!username) throw new Error('ListenBrainz username not found. Check your ListenBrainz connection settings.');
        
        const listenbrainz = new ListenBrainzService(username, lbConfig.token);
        const limit = config.limit || 50;
        
        const result = await listenbrainz.getLovedTracks();
        
        // Extract unique artists from loved tracks
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
        
        artists = Array.from(artistMap.values())
          .slice(0, limit)
          .map(a => ({
            name: a.name,
            mbid: a.mbid,
            source: 'listenbrainz-loved',
          }));
        break;
      }

      // DISCOGS SUBSCRIPTION TYPES

      case 'discogs_label': {
        if (!discogsConn) throw new Error('No active Discogs connection. Please add a Discogs connection first.');
        const discogsConfig = discogsConn.config as any;
        const labelId = config.labelId;
        if (!labelId) throw new Error('Label ID is required for Discogs Label subscription');
        
        const discogs = new DiscogsService(discogsConfig.token);
        const limit = config.limit || 50;
        
        // Fetch releases from the label
        const result = await discogs.getLabelReleases(labelId, 1);
        
        // Extract unique artists from releases
        const artistMap = new Map<string, ArtistToAdd>();
        for (const release of result.releases.slice(0, limit)) {
          // The artist field may contain "Various" or actual artist name
          if (release.artist && release.artist.toLowerCase() !== 'various') {
            if (!artistMap.has(release.artist)) {
              artistMap.set(release.artist, {
                name: release.artist,
                source: `discogs-label-${labelId}`,
              });
            }
          }
        }
        
        artists = Array.from(artistMap.values());
        break;
      }

      case 'discogs_style': {
        if (!discogsConn) throw new Error('No active Discogs connection. Please add a Discogs connection first.');
        const discogsConfig = discogsConn.config as any;
        const style = config.style;
        if (!style) throw new Error('Style is required for Discogs Style subscription');
        
        const discogs = new DiscogsService(discogsConfig.token);
        const limit = config.limit || 50;
        
        // Search for releases by style
        const result = await discogs.searchByStyle(style, 1);
        
        // Extract unique artists from search results
        const artistMap = new Map<string, ArtistToAdd>();
        for (const item of result.results.slice(0, limit)) {
          // The title often contains "Artist - Album" format
          const titleParts = item.title.split(' - ');
          if (titleParts.length > 0) {
            const artistName = titleParts[0].trim();
            if (artistName && artistName.toLowerCase() !== 'various' && artistName.toLowerCase() !== 'various artists') {
              if (!artistMap.has(artistName)) {
                artistMap.set(artistName, {
                  name: artistName,
                  source: `discogs-style-${style}`,
                });
              }
            }
          }
        }
        
        artists = Array.from(artistMap.values());
        break;
      }

      // BANDCAMP SUBSCRIPTION TYPES

      case 'bandcamp_tag': {
        // Bandcamp is public - no connection required
        const tag = config.tag;
        if (!tag) throw new Error('Tag is required for Bandcamp Tag subscription');
        
        const bandcamp = new BandcampService();
        const limit = config.limit || 50;
        const sort = config.sort || 'pop';
        
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
        
        artists = Array.from(artistMap.values());
        break;
      }

      case 'bandcamp_new': {
        // New releases by tag - discover albums, not artists
        const tag = config.tag || 'all';
        const limit = config.limit || 50;
        
        const bandcamp = new BandcampService();
        
        // Sort by date to get newest releases
        const result = await bandcamp.getTagReleases(tag, 'date', 0);
        
        // New releases = album discovery
        albumsToAdd = result.releases.slice(0, limit).map(release => ({
          albumName: release.title,
          artistName: release.artistName,
          releaseType: release.type === 'a' ? 'album' : 'single',
          source: `bandcamp-new-${tag}`,
        }));
        break;
      }
    }

    await job.updateProgress({ phase: 'fetched', artistCount: artists.length });

    // Deduplicate artists from multiple sources
    const artistsForDedup = artists.map((a, idx) => ({
      id: idx,
      name: a.name,
      mbid: a.mbid,
      sources: [a.source],
      matchCount: 1,
    }));

    const dedupedArtists = deduplicateResults(artistsForDedup);

    // Convert back to ArtistToAdd format for processing
    artists = dedupedArtists.map(d => ({
      name: d.name,
      mbid: d.mbid,
      source: d.sources.join(','), // Keep track of all sources
    }));

    await addLogEntry('info', 'subscription', `Deduplicated ${artistsForDedup.length} artists down to ${artists.length}`, {
      subscriptionId,
      originalCount: artistsForDedup.length,
      dedupedCount: artists.length,
    });

    // Process artists based on resultHandling mode
    const resultHandling = subscription.resultHandling || 'preview';
    let added = 0;
    let skipped = 0;
    let queued = 0;

    for (let i = 0; i < artists.length; i++) {
      const artist = artists[i];
      
      // Check if already in library
      if (await lidarrCache.exists({ name: artist.name, mbid: artist.mbid })) {
        skipped++;
        // Parse sources from comma-separated string
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];
        // Store result for tracking
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'artist',
            name: artist.name,
            mbid: artist.mbid,
            status: 'skipped',
            skipReason: 'already_in_library',
            sources: sourcesArray,
            matchCount: sourcesArray.length,
          },
        });
        continue;
      }

      // Get MBID if not present
      let mbid = artist.mbid;
      if (!mbid) {
        mbid = await musicbrainz.getMbidFromSpotifyArtist(artist.name) || undefined;
      }

      if (!mbid) {
        skipped++;
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'artist',
            name: artist.name,
            status: 'skipped',
            skipReason: 'no_mbid_found',
            sources: sourcesArray,
            matchCount: sourcesArray.length,
          },
        });
        continue;
      }

      // Handle based on resultHandling setting
      if (resultHandling === 'preview') {
        // Preview only - store result but don't add
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'artist',
            name: artist.name,
            mbid,
            status: 'pending',
            sources: sourcesArray,
            matchCount: sourcesArray.length,
          },
        });
        queued++;
      } else if (resultHandling === 'queue') {
        // Add to review queue for manual approval (with deduplication)
        const reviewResult = await findOrCreateReviewItem({
          userId,
          artistName: artist.name,
          mbid,
          source: `subscription:${subscription.name}`,
        });
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'artist',
            name: artist.name,
            mbid,
            status: reviewResult.created ? 'queued' : 'deduplicated',
            sources: sourcesArray,
            matchCount: sourcesArray.length,
          },
        });
        if (reviewResult.created) {
          queued++;
        }
      } else {
        // auto_add - Add directly to Lidarr
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];
        try {
          const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
            lidarr.getQualityProfiles(),
            lidarr.getMetadataProfiles(),
            lidarr.getRootFolders(),
          ]);

          await lidarr.addArtist(
            mbid,
            qualityProfiles[0].id,
            metadataProfiles[0].id,
            rootFolders[0].path
          );
          added++;
          await prisma.subscriptionResult.create({
            data: {
              subscriptionId,
              runId: run.id,
              itemType: 'artist',
              name: artist.name,
              mbid,
              status: 'added',
              sources: sourcesArray,
              matchCount: sourcesArray.length,
            },
          });
        } catch {
          skipped++;
          await prisma.subscriptionResult.create({
            data: {
              subscriptionId,
              runId: run.id,
              itemType: 'artist',
              name: artist.name,
              mbid,
              status: 'failed',
              sources: sourcesArray,
              matchCount: sourcesArray.length,
            },
          });
        }
      }

      await job.updateProgress({
        phase: 'processing',
        current: i + 1,
        total: artists.length,
        added,
        skipped,
        queued,
      });
    }

    // Process albums (from album discovery subscriptions)
    for (let i = 0; i < albumsToAdd.length; i++) {
      const album = albumsToAdd[i];
      
      // For albums, we add to review queue or directly to Lidarr
      const sourcesArray = [album.source];
      
      if (resultHandling === 'preview') {
        // Just record without adding to queue
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'album',
            name: `${album.albumName} - ${album.artistName}`,
            status: 'pending',
            sources: sourcesArray,
            matchCount: 1,
          },
        });
        queued++;
      } else if (resultHandling === 'queue') {
        // Add to review queue as album type
        const reviewResult = await findOrCreateReviewItem({
          userId,
          artistName: album.artistName,
          albumName: album.albumName,
          releaseYear: album.releaseYear,
          releaseDate: album.releaseDate,
          releaseType: album.releaseType,
          source: `subscription:${subscription.name}`,
          itemType: 'album',
        });
        
        await prisma.subscriptionResult.create({
          data: {
            subscriptionId,
            runId: run.id,
            itemType: 'album',
            name: `${album.albumName} - ${album.artistName}`,
            status: reviewResult.created ? 'queued' : 'deduplicated',
            sources: sourcesArray,
            matchCount: 1,
          },
        });
        
        if (reviewResult.created) {
          queued++;
        }
      }
      // Note: auto_add for albums would require MBID lookup, deferred for now
      
      await job.updateProgress({
        phase: 'processing-albums',
        current: i + 1,
        total: albumsToAdd.length,
        added,
        skipped,
        queued,
      });
    }

    // Update run record
    const totalResults = artists.length + albumsToAdd.length;
    await prisma.subscriptionRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        resultsCount: totalResults,
        addedCount: added,
        skippedCount: skipped,
        completedAt: new Date(),
      },
    });

    // Update subscription last run
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { 
        lastRun: new Date(),
        lastRunStatus: 'completed',
        lastRunCount: added + queued,
      },
    });

    // Log the result
    await addLogEntry('info', 'subscription', `Subscription "${subscription.name}" completed`, {
      subscriptionId,
      subscriptionName: subscription.name,
      type: subscription.type,
      artistsFound: artists.length,
      albumsFound: albumsToAdd.length,
      added,
      skipped,
      queued,
    });

    // Send notification for completed subscription
    await notificationService.send(userId, 'subscription.completed', {
      subscriptionName: subscription.name,
      artistCount: artists.length + albumsToAdd.length,
      queuedCount: queued,
      addedCount: added,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await prisma.subscriptionRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      },
    });

    // Update subscription last run status to failed
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { 
        lastRun: new Date(),
        lastRunStatus: 'failed',
        lastRunCount: 0,
      },
    });

    // Log the error
    await addLogEntry('error', 'subscription', `Subscription run failed: ${errorMessage}`, {
      subscriptionId,
      error: errorMessage,
    });

    // Send notification for failed subscription
    const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
    await notificationService.send(userId, 'subscription.failed', {
      subscriptionName: subscription?.name || 'Unknown',
      error: errorMessage,
    });

    throw error;
  }
}

// Create worker
export const subscriptionWorker = new Worker<SubscriptionJobData>(
  QUEUE_NAMES.SUBSCRIPTION,
  processSubscription,
  {
    connection: createRedisConnection(),
    concurrency: 2,
  }
);

subscriptionWorker.on('completed', (job) => {
  console.log(`Subscription job ${job.id} completed`);
});

subscriptionWorker.on('failed', (job, error) => {
  console.error(`Subscription job ${job?.id} failed:`, error);
});
