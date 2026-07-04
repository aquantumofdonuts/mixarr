import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createSubscriptionSchema, updateSubscriptionSchema } from '../schemas/subscription.js';
import { parseIntParam } from '../utils/params.js';
import { subscriptionController } from '../controllers/subscriptions.controller.js';
import { getArtistImages } from '../services/artist-images.js';
import { LidarrService } from '../services/lidarr.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { notificationService } from '../services/notifications.js';
import { SUBSCRIPTION_PRESETS } from '../data/subscription-presets.js';
import { SUBSCRIPTION_TYPES } from '../data/subscription-types.js';
import type { Subscription } from '@prisma/client';
import type { Request } from 'express';
import { createLogger } from '../lib/logger.js';
import { LidarrConnectionConfig, normalizeLidarrConfig } from '../types/connections.js';

const logger = createLogger('SubscriptionsRoute');

export const subscriptionsRouter = Router();

subscriptionsRouter.use(requireAuth);

// Helper: Check if user can access a subscription
function canAccessSubscription(req: Request, subscription: Subscription): boolean {
  return req.user!.role === 'admin' || subscription.userId === req.user!.id;
}

// Static endpoints - must be defined BEFORE :id routes
subscriptionsRouter.get('/', subscriptionController.list);

/**
 * GET /api/subscriptions/types
 * Returns subscription type metadata for frontend consumption
 * SOC-003: Single source of truth for subscription type configuration
 */
subscriptionsRouter.get('/types', (_req, res) => {
  res.json(SUBSCRIPTION_TYPES);
});

// CRUD endpoints - delegated to controller
subscriptionsRouter.get('/:id', subscriptionController.getById);

subscriptionsRouter.post('/', validateBody(createSubscriptionSchema), subscriptionController.create);
subscriptionsRouter.put('/:id', validateBody(updateSubscriptionSchema), subscriptionController.update);
subscriptionsRouter.delete('/:id', subscriptionController.delete);
subscriptionsRouter.post('/:id/execute', subscriptionController.execute);

// Run history endpoints - delegated to controller
subscriptionsRouter.get('/:id/runs', subscriptionController.getRunHistory);
subscriptionsRouter.get('/:id/runs/:runId', subscriptionController.getRunDetails);

// Get all results for a subscription (paginated)
subscriptionsRouter.get('/:id/results', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid subscription ID' });
      return;
    }
    const offset = parseInt(req.query.offset as string) || 0;
    const status = req.query.status as string;

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    // Pagination limit — default to 500 (return all results unless client paginates)
    const limit = parseInt(req.query.limit as string) || 500;

    const whereClause: any = { subscriptionId: id };
    if (status) {
      whereClause.status = status;
    }

    const [results, total] = await Promise.all([
      prisma.subscriptionResult.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.subscriptionResult.count({ where: whereClause }),
    ]);

    // Get status counts
    const statusCounts = await prisma.subscriptionResult.groupBy({
      by: ['status'],
      where: { subscriptionId: id },
      _count: { status: true },
    });

    // Lidarr is optional for preview - just can't check library status
    const lidarrConn = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId: req.user!.id, type: 'lidarr', isActive: true },
          { userId: null, type: 'lidarr', isActive: true },
        ],
      },
      orderBy: { userId: 'desc' },
    });

    let existingArtists: Set<string> | null = null;
    if (lidarrConn) {
      try {
        const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
        const lidarr = new LidarrService(lidarrConfig);
        existingArtists = new Set(
          (await lidarr.getArtists()).map(a => a.artistName.toLowerCase())
        );
      } catch {
        // Lidarr might be unreachable - continue without library status
        existingArtists = null;
      }
    }

    // Fetch artist images from Deezer
    const artistNames = results.map(r => r.name);
    const imageMap = await getArtistImages(artistNames);

    // Add images and optionally inLibrary to results
    const resultsWithImages = results.map(r => ({
      ...r,
      imageUrl: imageMap.get(r.name),
      // Only include inLibrary if we have Lidarr data
      ...(existingArtists && { inLibrary: existingArtists.has(r.name.toLowerCase()) }),
    }));

    res.json({
      results: resultsWithImages,
      total,
      limit,
      offset,
      statusCounts: statusCounts.reduce((acc, s) => {
        acc[s.status] = s._count.status;
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// Approve a pending result (add to Lidarr)
subscriptionsRouter.post('/:id/results/:resultId/approve', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid subscription ID' });
      return;
    }
    const resultId = parseIntParam(req.params.resultId);
    if (resultId === null) {
      res.status(400).json({ error: 'Invalid result ID' });
      return;
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const result = await prisma.subscriptionResult.findFirst({
      where: { id: resultId, subscriptionId: id },
    });

    if (!result) {
      res.status(404).json({ error: 'Result not found' });
      return;
    }

    if (result.status !== 'pending' && result.status !== 'queued') {
      res.status(400).json({ error: 'Result already processed' });
      return;
    }

    // Get Lidarr connection
    const lidarrConn = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId: req.user!.id, type: 'lidarr', isActive: true },
          { userId: null, type: 'lidarr', isActive: true },
        ],
      },
      orderBy: { userId: 'desc' },
    });

    if (!lidarrConn) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const rawConfig = lidarrConn.config as unknown as LidarrConnectionConfig;
    // Normalize config to ensure profile IDs are numbers (handles string values from DB)
    const lidarrConfig = normalizeLidarrConfig(rawConfig);
    const lidarr = new LidarrService(lidarrConfig);

    // Get or find MBID
    let mbid = result.mbid;
    if (!mbid) {
      // For albums, search by artistName; for artists, search by name
      const searchName = result.itemType === 'album' && result.artistName 
        ? result.artistName 
        : result.name;
      logger.debug(`No MBID stored, searching MusicBrainz for: "${searchName}"`);
      const musicbrainz = new MusicBrainzService();
      mbid = await musicbrainz.getMbidFromSpotifyArtist(searchName) || null;
    }

    if (!mbid) {
      await prisma.subscriptionResult.update({
        where: { id: resultId },
        data: { status: 'skipped', skipReason: 'no_mbid_found', processedAt: new Date() },
      });
      res.status(400).json({ error: 'Could not find MusicBrainz ID for artist' });
      return;
    }

    // Add to Lidarr
    try {
      // Use connection config for profiles/folders, fall back to fetching first available
      let qpId = lidarrConfig.qualityProfileId;
      let mpId = lidarrConfig.metadataProfileId;
      let rfPath = lidarrConfig.rootFolderPath;

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
        throw new Error('Missing Lidarr configuration (profiles/folders). Please configure profiles in Lidarr connection settings.');
      }

      // Check if this is an album item - use addAlbumWithCacheWarm for targeted download
      const isAlbumItem = result.itemType === 'album' && result.albumMbid;
      
      if (isAlbumItem) {
        // Album approval - warm cache, add artist with monitor:none, then monitor only this album
        await lidarr.addAlbumWithCacheWarm(
          mbid,
          result.albumMbid!,
          qpId,
          mpId,
          rfPath
        );

        // Log success
        await prisma.logEntry.create({
          data: {
            level: 'info',
            category: 'subscription',
            message: `Added album "${result.name}" to Lidarr from subscription "${subscription.name}"`,
            metadata: { artistName: result.artistName, albumName: result.name, mbid, albumMbid: result.albumMbid, subscriptionId: id },
          },
        });
      } else {
        // Artist approval - warm SkyHook cache for reliable metadata lookup
        // Use monitorOption from connection config (defaults to 'all' if not set)
        await lidarr.addArtistWithCacheWarm(
          mbid,
          qpId,
          mpId,
          rfPath,
          true,  // monitored
          true,  // searchForMissingAlbums
          false, // waitForRefresh (deprecated)
          lidarrConfig.monitorOption || 'all',
          lidarrConfig.monitorNewItems || 'all'
        );

        // Log success
        await prisma.logEntry.create({
          data: {
            level: 'info',
            category: 'subscription',
            message: `Added artist "${result.name}" to Lidarr from subscription "${subscription.name}"`,
            metadata: { artistName: result.name, mbid, subscriptionId: id },
          },
        });
      }

      await prisma.subscriptionResult.update({
        where: { id: resultId },
        data: { status: 'added', processedAt: new Date() },
      });

      // Send notification
      await notificationService.send(req.user!.id, 'artist.added', {
        artistName: result.name,
      });

      res.json({ success: true, message: `Added "${result.name}" to Lidarr` });
    } catch (lidarrError) {
      const errorMessage = lidarrError instanceof Error ? lidarrError.message : 'Unknown error';
      
      // Check if artist already exists
      if (errorMessage.includes('already been added') || errorMessage.includes('already exists')) {
        await prisma.subscriptionResult.update({
          where: { id: resultId },
          data: { status: 'skipped', skipReason: 'already_in_lidarr', processedAt: new Date() },
        });
        res.json({ success: true, message: `"${result.name}" already in Lidarr` });
        return;
      }

      await prisma.subscriptionResult.update({
        where: { id: resultId },
        data: { status: 'failed', errorMessage, processedAt: new Date() },
      });
      res.status(500).json({ error: `Failed to add to Lidarr: ${errorMessage}` });
    }
  } catch (error) {
    logger.error('Approve error', { error });
    res.status(500).json({ error: 'Failed to approve result' });
  }
});

// Reject a pending result
subscriptionsRouter.post('/:id/results/:resultId/reject', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid subscription ID' });
      return;
    }
    const resultId = parseIntParam(req.params.resultId);
    if (resultId === null) {
      res.status(400).json({ error: 'Invalid result ID' });
      return;
    }

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    await prisma.subscriptionResult.update({
      where: { id: resultId },
      data: { status: 'rejected', processedAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject result' });
  }
});

// Get subscription presets - Complete preset library
subscriptionsRouter.get('/presets/list', (_req, res) => {
  res.json({ presets: SUBSCRIPTION_PRESETS });
});
