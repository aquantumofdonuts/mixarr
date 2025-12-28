/**
 * Import Worker
 * 
 * Processes Spotify import jobs - fetches from user's Spotify library.
 */

import { Worker, Job } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import prisma from '../lib/db.js';
import { QUEUE_NAMES, type ImportJobData } from './queue.js';
import { LidarrService, LidarrCache } from '../services/lidarr.js';
import { SpotifyService } from '../services/spotify.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { findOrCreateReviewItem } from '../utils/review-queue.js';

interface ImportItem {
  artistName: string;
  albumName?: string;
  releaseYear?: number;
  spotifyId?: string;
}

async function processImport(job: Job<ImportJobData>): Promise<void> {
  const { importSourceId, userId, mode } = job.data;

  try {
    // Get import source
    const importSource = await prisma.importSource.findUnique({
      where: { id: importSourceId },
    });

    if (!importSource) {
      throw new Error('Import source not found');
    }

    // Get user's connections (or fall back to global connections)
    const [spotifyConn, lidarrConn] = await Promise.all([
      prisma.connection.findFirst({
        where: {
          OR: [
            { userId, type: 'spotify', isActive: true },
            { userId: null, type: 'spotify', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' },
      }),
      prisma.connection.findFirst({
        where: {
          OR: [
            { userId, type: 'lidarr', isActive: true },
            { userId: null, type: 'lidarr', isActive: true },
          ],
        },
        orderBy: { userId: 'desc' },
      }),
    ]);

    if (!spotifyConn) {
      throw new Error('No active Spotify connection');
    }

    const spotifyConfig = spotifyConn.config as any;
    const spotify = new SpotifyService(spotifyConfig, async (tokens) => {
      // Update tokens in database
      await prisma.connection.update({
        where: { id: spotifyConn.id },
        data: {
          config: {
            ...spotifyConfig,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: new Date(tokens.expiresAt).toISOString(),
          },
        },
      });
    });

    let items: ImportItem[] = [];

    // Fetch items based on source type
    switch (importSource.type) {
      case 'liked_songs': {
        const tracks = await spotify.getAllLikedSongs();
        const artistMap = new Map<string, ImportItem>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, {
                artistName: artist.name,
                albumName: track.album.name,
                releaseYear: parseInt(track.album.release_date.split('-')[0], 10) || undefined,
                spotifyId: artist.id,
              });
            }
          }
        }
        items = Array.from(artistMap.values());
        break;
      }

      case 'saved_albums': {
        const albums = await spotify.getAllSavedAlbums();
        items = albums.map(album => ({
          artistName: album.artists[0]?.name || 'Unknown',
          albumName: album.name,
          releaseYear: parseInt(album.release_date.split('-')[0], 10) || undefined,
          spotifyId: album.artists[0]?.id,
        }));
        break;
      }

      case 'followed_artists': {
        const artists = await spotify.getAllFollowedArtists();
        items = artists.map(artist => ({
          artistName: artist.name,
          spotifyId: artist.id,
        }));
        break;
      }

      case 'playlist': {
        if (!importSource.externalId) {
          throw new Error('Playlist ID required');
        }
        const tracks = await spotify.getAllPlaylistTracks(importSource.externalId);
        const artistMap = new Map<string, ImportItem>();
        for (const track of tracks) {
          for (const artist of track.artists) {
            if (!artistMap.has(artist.id)) {
              artistMap.set(artist.id, {
                artistName: artist.name,
                albumName: track.album.name,
                releaseYear: parseInt(track.album.release_date.split('-')[0], 10) || undefined,
                spotifyId: artist.id,
              });
            }
          }
        }
        items = Array.from(artistMap.values());
        break;
      }
    }

    await job.updateProgress({ phase: 'fetched', itemCount: items.length });

    // Check which artists are already in Lidarr
    let enrichedItems = items;
    
    if (lidarrConn) {
      const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
      const lidarr = new LidarrService(lidarrConfig);
      const cache = new LidarrCache(lidarr);
      await cache.refresh();

      enrichedItems = await Promise.all(
        items.map(async (item) => ({
          ...item,
          inLibrary: await cache.exists({ name: item.artistName }),
        }))
      );
    }

    // Handle based on mode
    if (mode === 'preview') {
      // Just return the items - they'll be sent via WebSocket
      await job.updateProgress({
        phase: 'complete',
        items: enrichedItems,
      });
      return;
    }

    if (mode === 'queue') {
      // Add to review queue (with deduplication)
      let queued = 0;
      let deduplicated = 0;

      for (const item of enrichedItems) {
        const result = await findOrCreateReviewItem({
          userId,
          artistName: item.artistName,
          spotifyId: item.spotifyId,
          albumName: item.albumName,
          releaseYear: item.releaseYear,
          source: `import-${importSource.type}`,
        });

        if (result.created) {
          queued++;
        } else {
          deduplicated++;
        }
      }

      await job.updateProgress({
        phase: 'complete',
        queued,
        deduplicated,
      });
      return;
    }

    // Auto mode - add directly to Lidarr
    if (!lidarrConn) {
      throw new Error('No active Lidarr connection for auto mode');
    }

    const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
    const lidarr = new LidarrService(lidarrConfig);
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    const musicbrainz = new MusicBrainzService();

    let added = 0;
    let skipped = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (await cache.exists({ name: item.artistName })) {
        skipped++;
        continue;
      }

      const mbid = await musicbrainz.getMbidFromSpotifyArtist(item.artistName);
      if (!mbid) {
        skipped++;
        continue;
      }

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
      } catch {
        skipped++;
      }

      await job.updateProgress({
        phase: 'processing',
        current: i + 1,
        total: items.length,
        added,
        skipped,
      });
    }

    // Update import source last run
    await prisma.importSource.update({
      where: { id: importSourceId },
      data: { lastRun: new Date() },
    });

    await job.updateProgress({
      phase: 'complete',
      added,
      skipped,
    });

  } catch (error) {
    throw error;
  }
}

// Create worker
export const importWorker = new Worker<ImportJobData>(
  QUEUE_NAMES.IMPORT,
  processImport,
  {
    connection: createRedisConnection(),
    concurrency: 1, // Spotify rate limits
  }
);

importWorker.on('completed', (job) => {
  console.log(`Import job ${job.id} completed`);
});

importWorker.on('failed', (job, error) => {
  console.error(`Import job ${job?.id} failed:`, error);
});
