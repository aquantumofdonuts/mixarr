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
import { MusicBrainzService } from '../services/musicbrainz.js';

import { addLogEntry } from '../routes/logs.js';
import { deduplicateResults } from '../utils/deduplication.js';
import { isSlskdConfig, LidarrConnectionConfig, normalizeLidarrConfig } from '../types/connections.js';
import { findOrCreateReviewItem } from '../utils/review-queue.js';
import { notificationService } from '../services/notifications.js';
import { createLogger } from '../lib/logger.js';
import { SlskdService } from '../services/slskd.js';
import { SlskdSubscriptionProcessor } from '../services/slskd-subscription-processor.js';

// Strategy pattern — register strategies at import time
import './strategies/spotify.js';
import './strategies/lastfm.js';
import './strategies/deezer.js';
import './strategies/tidal.js';
import './strategies/listenbrainz.js';
import './strategies/musicbrainz.js';
import './strategies/discogs.js';
import './strategies/bandcamp.js';
import './strategies/ai.js';
import './strategies/tautulli.js';
import './strategies/jellyfin.js';
import { getStrategy } from './strategies/registry.js';
import type { StrategyContext, ArtistToAdd, AlbumToAdd } from './strategies/types.js';
import type { SubscriptionType } from '../schemas/subscription.js';

const logger = createLogger('SubscriptionWorker');

async function processSubscription(job: Job<SubscriptionJobData>): Promise<void> {
  const { subscriptionId, userId } = job.data;
  
  // Declare slskdProcessor outside try block so it's accessible in finally block for cleanup
  let slskdProcessor: SlskdSubscriptionProcessor | null = null;
  
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
    const slskdConn = findConnection('slskd');

    // Lidarr is optional - only needed for library dedup and 'auto' mode
    let lidarr: LidarrService | null = null;
    let lidarrCache: LidarrCache | null = null;
    let lidarrConfig: LidarrConnectionConfig | null = null;

    if (lidarrConn) {
      const rawConfig = lidarrConn.config as unknown as LidarrConnectionConfig;
      // Normalize config to ensure profile IDs are numbers (handles string values from DB)
      lidarrConfig = normalizeLidarrConfig(rawConfig);
      lidarr = new LidarrService(lidarrConfig);
      lidarrCache = new LidarrCache(lidarr);
      await lidarrCache.refresh();
    }

    // slskd is optional - only needed for slskd_* result handling modes
    let slskdConnectionId: number | null = null;

    if (slskdConn && isSlskdConfig(slskdConn.config)) {
      const slskdService = new SlskdService({
        url: slskdConn.config.url,
        apiKey: slskdConn.config.apiKey,
      });
      slskdProcessor = new SlskdSubscriptionProcessor(prisma, slskdService);
      slskdConnectionId = slskdConn.id;
    }

    const musicbrainz = new MusicBrainzService();
    const config = subscription.config as Record<string, any>;
    
    let artists: ArtistToAdd[] = [];
    let albumsToAdd: AlbumToAdd[] = [];

    // Try strategy registry first (extracted subscription types)
    const strategyContext: StrategyContext = {
      config,
      connections: connectionMap as Map<string, { id: number; type: string; config: unknown }>,
    };

    const strategy = getStrategy(subscription.type as SubscriptionType);
    if (strategy) {
      const result = await strategy.execute(strategyContext);
      artists = result.artists;
      albumsToAdd = result.albums;
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
      
      // Check if already in library (skip if no Lidarr connection)
      if (lidarrCache && await lidarrCache.exists({ name: artist.name, mbid: artist.mbid })) {
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
      } else if (resultHandling === 'slskd_preview' || resultHandling === 'slskd_queue' || resultHandling === 'slskd_auto') {
        // slskd modes - search Soulseek and handle based on mode
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];

        if (!slskdProcessor || !slskdConnectionId) {
          // No slskd connection - degrade to queue mode
          const reviewResult = await findOrCreateReviewItem({
            userId,
            artistName: artist.name,
            mbid,
            source: `subscription:${subscription.name}`,
          });
          await prisma.subscriptionResult.create({
            data: {
              subscriptionId,
              runId: run.id,
              itemType: 'artist',
              name: artist.name,
              mbid,
              status: reviewResult.created ? 'queued' : 'deduplicated',
              skipReason: 'no_slskd_connection',
              sources: sourcesArray,
              matchCount: sourcesArray.length,
            },
          });
          if (reviewResult.created) {
            queued++;
          }
          continue;
        }

        // Process via slskd
        const slskdResult = await slskdProcessor.processArtist(
          { name: artist.name, mbid },
          {
            connectionId: slskdConnectionId,
            userId,
            preferences: { preferLossless: true },
          }
        );

        if (resultHandling === 'slskd_preview') {
          // Preview only - store search result count, don't download
          await prisma.subscriptionResult.create({
            data: {
              subscriptionId,
              runId: run.id,
              itemType: 'artist',
              name: artist.name,
              mbid,
              status: slskdResult.searchResultCount && slskdResult.searchResultCount > 0 ? 'pending' : 'skipped',
              skipReason: slskdResult.status === 'not_found' ? 'not_found_on_soulseek' : undefined,
              sources: sourcesArray,
              matchCount: slskdResult.searchResultCount || 0,
            },
          });
          queued++;
        } else if (resultHandling === 'slskd_queue') {
          // Add to review queue if found
          if (slskdResult.status === 'queued' || slskdResult.status === 'not_found') {
            const reviewResult = await findOrCreateReviewItem({
              userId,
              artistName: artist.name,
              mbid,
              source: `subscription:${subscription.name}`,
            });
            await prisma.subscriptionResult.create({
              data: {
                subscriptionId,
                runId: run.id,
                itemType: 'artist',
                name: artist.name,
                mbid,
                status: reviewResult.created ? 'queued' : 'deduplicated',
                skipReason: slskdResult.status === 'not_found' ? 'not_found_on_soulseek' : undefined,
                sources: sourcesArray,
                matchCount: slskdResult.searchResultCount || 0,
              },
            });
            if (reviewResult.created) {
              queued++;
            }
          }
        } else {
          // slskd_auto - auto-download best match
          if (slskdResult.status === 'queued') {
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
                matchCount: slskdResult.searchResultCount || 0,
              },
            });
          } else if (slskdResult.status === 'not_found') {
            skipped++;
            await prisma.subscriptionResult.create({
              data: {
                subscriptionId,
                runId: run.id,
                itemType: 'artist',
                name: artist.name,
                mbid,
                status: 'skipped',
                skipReason: 'not_found_on_soulseek',
                sources: sourcesArray,
                matchCount: 0,
              },
            });
          } else {
            skipped++;
            await prisma.subscriptionResult.create({
              data: {
                subscriptionId,
                runId: run.id,
                itemType: 'artist',
                name: artist.name,
                mbid,
                status: 'failed',
                skipReason: slskdResult.error,
                sources: sourcesArray,
                matchCount: 0,
              },
            });
          }
        }
      } else {
        // auto_add - Add directly to Lidarr
        const sourcesArray = artist.source.includes(',') ? artist.source.split(',') : [artist.source];

        // If no Lidarr connection, degrade to queue mode
        if (!lidarr) {
          const reviewResult = await findOrCreateReviewItem({
            userId,
            artistName: artist.name,
            mbid,
            source: `subscription:${subscription.name}`,
          });
          await prisma.subscriptionResult.create({
            data: {
              subscriptionId,
              runId: run.id,
              itemType: 'artist',
              name: artist.name,
              mbid,
              status: reviewResult.created ? 'queued' : 'deduplicated',
              skipReason: 'no_lidarr_connection',
              sources: sourcesArray,
              matchCount: sourcesArray.length,
            },
          });
          if (reviewResult.created) {
            queued++;
          }
          continue;
        }

        try {
          // Use connection config for profiles/folders, fall back to fetching first available
          let qpId = lidarrConfig?.qualityProfileId;
          let mpId = lidarrConfig?.metadataProfileId;
          let rfPath = lidarrConfig?.rootFolderPath;

          if (!qpId || !mpId || !rfPath) {
            const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
              !qpId ? lidarr.getQualityProfiles() : Promise.resolve([]),
              !mpId ? lidarr.getMetadataProfiles() : Promise.resolve([]),
              !rfPath ? lidarr.getRootFolders() : Promise.resolve([]),
            ]);
            if (!qpId) qpId = qualityProfiles[0]?.id;
            if (!mpId) mpId = metadataProfiles[0]?.id;
            if (!rfPath) rfPath = rootFolders[0]?.path;
          }

          if (!qpId || !mpId || !rfPath) {
            throw new Error('Missing Lidarr configuration (profiles/folders)');
          }

          // Use addArtistWithCacheWarm for reliable metadata - cache warming is critical
          await lidarr.addArtistWithCacheWarm(
            mbid,
            qpId,
            mpId,
            rfPath,
            true,  // monitored
            lidarrConfig?.searchOnAdd !== false,  // searchForMissingAlbums from config
            false, // waitForRefresh (not used but required for API)
            lidarrConfig?.monitorOption || 'all',
            lidarrConfig?.monitorNewItems || 'all'
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
            artistName: album.artistName,
            mbid: album.artistMbid,
            albumMbid: album.albumMbid,
            releaseDate: album.releaseDate,
            releaseType: album.releaseType,
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
          mbid: album.artistMbid,  // Pass artist MBID to avoid unreliable name search on approval
          albumName: album.albumName,
          albumMbid: album.albumMbid,
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
            artistName: album.artistName,
            mbid: album.artistMbid,      // Artist MBID for proper Lidarr matching
            albumMbid: album.albumMbid,  // Album MBID for targeted download
            releaseDate: album.releaseDate,
            releaseType: album.releaseType,
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
  } finally {
    // CRITICAL FIX #1: Clean up slskdProcessor resources
    if (slskdProcessor) {
      await slskdProcessor.close();
    }
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
  logger.info(`Subscription job ${job.id} completed`);
});

subscriptionWorker.on('failed', (job, error) => {
  logger.error(`Subscription job ${job?.id} failed`, { error });
});
