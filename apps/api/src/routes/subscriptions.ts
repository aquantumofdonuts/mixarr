import { addOptionsSchema, effectiveAddOptions } from '../lib/add-options.js';
import { Router } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createSubscriptionSchema, updateSubscriptionSchema } from '../schemas/subscription.js';
import { parseIntParam } from '../utils/params.js';
import { DecisionError, nextRevision } from '../lib/decision.js';
import { readBeforeDeadline } from '../lib/acquisition-deadline.js';
import { subscriptionController } from '../controllers/subscriptions.controller.js';
import { getArtistImages } from '../services/artist-images.js';
import { LidarrService, getSharedLidarrCache, invalidateLidarrCache } from '../services/lidarr.js';
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
    // Pagination: default 50 per page, hard cap 200; clamp both params to safe ranges
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const status = req.query.status as string;

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

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

    let inLibraryById: Map<number, boolean> | null = null;
    if (lidarrConn) {
      try {
        const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
        const lidarrCache = getSharedLidarrCache(lidarrConfig.url, new LidarrService(lidarrConfig));
        const entries = await Promise.all(
          results.map(async r =>
            [r.id, await lidarrCache.exists({ name: r.artistName ?? r.name, mbid: r.mbid ?? undefined })] as const
          )
        );
        inLibraryById = new Map(entries);
      } catch {
        // Lidarr might be unreachable - continue without library status
        inLibraryById = null;
      }
    }

    // Serve stored images; resolve (cached) only for legacy rows missing one
    const missingImage = results.filter(r => !r.imageUrl);
    const imageMap = missingImage.length > 0
      ? await getArtistImages(missingImage.map(r => r.artistName ?? r.name))
      : new Map<string, string>();

    // Persist backfilled URLs so this is a one-time cost per legacy row.
    // Fire-and-forget: don't block the response on writes.
    const backfills = missingImage
      .map(r => ({ id: r.id, url: imageMap.get(r.artistName ?? r.name) }))
      .filter((u): u is { id: number; url: string } => Boolean(u.url));
    if (backfills.length > 0) {
      void Promise.all(
        backfills.map(u =>
          prisma.subscriptionResult.update({ where: { id: u.id }, data: { imageUrl: u.url } })
        )
      ).catch(error => logger.warn('Failed to backfill result imageUrls', { error }));
    }

    // Add images and optionally inLibrary to results
    const resultsWithImages = results.map(r => ({
      ...r,
      imageUrl: r.imageUrl ?? imageMap.get(r.artistName ?? r.name),
      // Only include inLibrary if we have Lidarr data
      ...(inLibraryById && { inLibrary: inLibraryById.get(r.id) ?? false }),
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
    logger.error('Failed to fetch subscription results', {
      error: error instanceof Error ? error.message : String(error),
      subscriptionId: req.params.id,
      userId: req.user?.id,
    });
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

const mbidSchema = z.string().uuid().transform(value => value.toLowerCase());
const approvalBody = addOptionsSchema.extend({ mbid: mbidSchema.optional() }).strict();

// Acquisitions and competing decisions share the feed's status/revision lease.
subscriptionsRouter.post('/:id/results/:resultId/approve', async (req, res) => {
  const signal = AbortSignal.timeout(60_000);
  let hasClaim = false;
  try {
    const id = parseIntParam(req.params.id);
    const resultId = parseIntParam(req.params.resultId);
    const body = approvalBody.safeParse(req.body ?? {});
    if (id === null || resultId === null || !body.success) {
      res.status(400).json({ error: 'Invalid approval request', code: 'INVALID_REQUEST' });
      return;
    }
    const ownerId = req.user!.id;
    signal.throwIfAborted();
    const subscription = await readBeforeDeadline(prisma.subscription.findUnique({ where: { id } }), signal);
    signal.throwIfAborted();
    if (!subscription || subscription.userId !== ownerId) {
      throw new DecisionError(404, 'NOT_FOUND', 'Subscription not found');
    }
    const result = await readBeforeDeadline(prisma.subscriptionResult.findFirst({ where: { id: resultId, subscriptionId: id } }), signal);
    signal.throwIfAborted();
    if (!result) throw new DecisionError(404, 'NOT_FOUND', 'Result not found');
    const staleClaim = result.status === 'adding' &&
      result.processedAt !== null && result.processedAt.getTime() < Date.now() - 120_000;
    if (result.status === 'adding' && !staleClaim) {
      throw new DecisionError(409, 'IN_PROGRESS', 'Acquisition is in progress');
    }
    if (!['pending', 'queued', 'failed'].includes(result.status) && !staleClaim) {
      throw new DecisionError(409, 'DECISION_CONFLICT', 'Result already processed');
    }
    if (!['artist', 'album'].includes(result.itemType) || (result.itemType === 'album' && !mbidSchema.safeParse(result.albumMbid).success)) {
      throw new DecisionError(422, 'IDENTITY_REQUIRED', 'Choose a valid album identity before adding');
    }
    const identity = mbidSchema.safeParse(result.mbid || body.data.mbid);
    if (!identity.success) {
      throw new DecisionError(422, 'IDENTITY_REQUIRED', 'Choose a valid artist identity before adding');
    }
    const mbid = identity.data;
    if (result.mbid && body.data.mbid && mbid !== body.data.mbid) {
      throw new DecisionError(409, 'IDENTITY_CONFLICT', 'Result already has an artist identity');
    }
    const lidarrConn = await readBeforeDeadline(prisma.connection.findFirst({
      where: { OR: [
        { userId: ownerId, type: 'lidarr', isActive: true },
        { userId: null, type: 'lidarr', isActive: true },
      ] },
      orderBy: { userId: 'desc' },
    }), signal);
    signal.throwIfAborted();
    if (!lidarrConn) throw new DecisionError(409, 'CONNECTION_REQUIRED', 'No active Lidarr connection');
    const config = normalizeLidarrConfig(lidarrConn.config as unknown as LidarrConnectionConfig);
    const lidarr = new LidarrService(config);
    const isAlbum = result.itemType === 'album' && !!result.albumMbid;
    const membership = async (): Promise<boolean> => {
      signal.throwIfAborted();
      const artist = await lidarr.getArtistByMbid(mbid, signal);
      if (!artist) return false;
      if (!isAlbum) return true;
      const albums = await lidarr.getAlbums(artist.id, signal);
      return albums.some(album => album.foreignAlbumId === result.albumMbid && album.monitored === true);
    };
    // A stale lease does not prove that its external side effect never happened.
    let alreadyInLibrary = staleClaim ? await membership() : false;
    signal.throwIfAborted();
    const claimRevision = await prisma.$transaction(async tx => {
      signal.throwIfAborted();
      let expectedRevision = result.processedAt;
      if (!result.mbid) {
        const identityRevision = nextRevision([expectedRevision]);
        const identityWrite = await tx.subscriptionResult.updateMany({
          where: { id: resultId, subscriptionId: id, subscription: { userId: ownerId },
            status: result.status, processedAt: expectedRevision, mbid: null },
          data: { mbid, processedAt: identityRevision },
        });
        if (identityWrite.count !== 1) throw new DecisionError(409, 'DECISION_CONFLICT', 'Result changed');
        expectedRevision = identityRevision;
      }
      const revision = nextRevision([expectedRevision]);
      const claimed = await tx.subscriptionResult.updateMany({
        where: { id: resultId, subscriptionId: id, subscription: { userId: ownerId },
          status: result.status, processedAt: expectedRevision, mbid: result.mbid || mbid },
        data: { mbid, status: 'adding', processedAt: revision, skipReason: null, errorMessage: null },
      });
      if (claimed.count !== 1) throw new DecisionError(409, 'IN_PROGRESS', 'Result changed or is being acquired');
      signal.throwIfAborted();
      return revision;
    }, { timeout: 5_000 });
    hasClaim = true;
    let outcome: 'added' | 'already-in-library' | 'failed' | 'uncertain';
    try {
      if (!alreadyInLibrary) alreadyInLibrary = await membership();
      if (!alreadyInLibrary) {
        const options = await effectiveAddOptions(lidarr, config, body.data, signal);
        if (isAlbum) {
          await lidarr.addAlbumWithCacheWarm(mbid, result.albumMbid!, options.qualityProfileId, options.metadataProfileId, options.rootFolderPath, signal, options.searchOnAdd);
        } else {
          const acquisition = await lidarr.addArtistWithCacheWarm(mbid, options.qualityProfileId, options.metadataProfileId, options.rootFolderPath, true, options.searchOnAdd, false,
            options.monitorOption, options.monitorNewItems, signal);
          alreadyInLibrary = acquisition.alreadyInLibrary === true;
        }
      }
      outcome = alreadyInLibrary ? 'already-in-library' : 'added';
    } catch (error) {
      // Even a duplicate error must be confirmed against canonical provider identity.
      let confirmed = false;
      if (!signal.aborted) {
        try { confirmed = await membership(); } catch { /* Reconciliation can itself be unreachable. */ }
      }
      const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
      outcome = confirmed ? 'already-in-library' :
        typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429
          ? 'failed' : 'uncertain';
    }
    const confirmed = outcome === 'added' || outcome === 'already-in-library';
    const finalized = await prisma.$transaction(async tx => {
      const changed = await tx.subscriptionResult.updateMany({
        where: { id: resultId, subscriptionId: id, subscription: { userId: ownerId },
          status: 'adding', processedAt: claimRevision },
        data: { status: confirmed ? 'added' : 'failed', processedAt: nextRevision([claimRevision]),
          skipReason: null, errorMessage: confirmed ? null : outcome === 'uncertain'
            ? 'ACQUISITION_UNCERTAIN: Provider outcome could not be confirmed'
            : 'PROVIDER_REJECTED: Lidarr rejected the acquisition' },
      });
      return changed.count === 1;
    }, { timeout: 5_000 });
    if (confirmed) invalidateLidarrCache(config.url);
    if (!finalized) {
      let reconciled = confirmed;
      if (!signal.aborted) {
        try { reconciled = await membership(); } catch { /* Preserve the newer decision on uncertainty. */ }
      }
      if (reconciled && !confirmed) invalidateLidarrCache(config.url);
      res.status(409).json({ error: 'Result changed during acquisition', code: 'DECISION_CONFLICT',
        outcome: reconciled ? 'already-in-library' : 'uncertain' });
      return;
    }
    if (!confirmed) {
      res.status(outcome === 'uncertain' ? 503 : 502).json({ success: false, outcome,
        code: outcome === 'uncertain' ? 'ACQUISITION_UNCERTAIN' : 'PROVIDER_REJECTED',
        error: outcome === 'uncertain' ? 'Provider outcome could not be confirmed; retry to reconcile' : 'Lidarr rejected the acquisition' });
      return;
    }
    // Respond after confirmation; channel delivery must not extend the acquisition response deadline.
    res.json({ success: true, outcome, message: outcome === 'already-in-library' ? `"${result.name}" is already in Lidarr` : `Added "${result.name}" to Lidarr` });
    try {
      await prisma.logEntry.create({ data: { level: 'info', category: 'subscription',
        message: outcome === 'already-in-library' ? `"${result.name}" is already in Lidarr from subscription "${subscription.name}"` : `Added "${result.name}" to Lidarr from subscription "${subscription.name}"`,
        metadata: { mbid, albumMbid: result.albumMbid, subscriptionId: id, outcome } } });
      if (outcome === 'added') await notificationService.send(ownerId, 'artist.added', { artistName: result.name });
    } catch { logger.warn('Confirmed subscription acquisition notification or log failed', { resultId }); }
  } catch (error) {
    if (error instanceof DecisionError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else {
      logger.error('Subscription approval failed', { subscriptionId: req.params.id, resultId: req.params.resultId });
      res.status(signal.aborted || hasClaim ? 503 : 500).json({ error: 'Failed to approve result',
        code: signal.aborted || hasClaim ? 'ACQUISITION_UNCERTAIN' : 'ACQUISITION_FAILED',
        ...(signal.aborted || hasClaim ? { outcome: 'uncertain' } : {}) });
    }
  }
});

subscriptionsRouter.post('/:id/results/:resultId/reject', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    const resultId = parseIntParam(req.params.resultId);
    if (id === null || resultId === null) {
      res.status(400).json({ error: 'Invalid result or subscription ID' });
      return;
    }
    await prisma.$transaction(async tx => {
      const result = await tx.subscriptionResult.findFirst({
        where: { id: resultId, subscriptionId: id, subscription: { userId: req.user!.id } },
      });
      if (!result) throw new DecisionError(404, 'NOT_FOUND', 'Result not found');
      if (result.status === 'adding') throw new DecisionError(409, 'IN_PROGRESS', 'Acquisition is in progress');
      if (!['pending', 'queued', 'failed'].includes(result.status)) {
        throw new DecisionError(409, 'DECISION_CONFLICT', 'Result already processed');
      }
      const changed = await tx.subscriptionResult.updateMany({
        where: { id: resultId, subscriptionId: id, subscription: { userId: req.user!.id },
          status: result.status, processedAt: result.processedAt },
        data: { status: 'rejected', processedAt: nextRevision([result.processedAt]) },
      });
      if (changed.count !== 1) throw new DecisionError(409, 'DECISION_CONFLICT', 'Result changed');
    }, { timeout: 5_000 });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof DecisionError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else {
      logger.error('Failed to reject subscription result', { resultId: req.params.resultId, userId: req.user?.id });
      res.status(500).json({ error: 'Failed to reject result' });
    }
  }
});

// Get subscription presets - Complete preset library
subscriptionsRouter.get('/presets/list', (_req, res) => {
  res.json({ presets: SUBSCRIPTION_PRESETS });
});
