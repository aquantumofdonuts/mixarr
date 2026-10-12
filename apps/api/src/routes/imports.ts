import { z } from 'zod';
import { effectiveAddOptions } from '../lib/add-options.js';
import { Router } from 'express';
import prisma from '../lib/db.js';
import { DecisionError, nextRevision } from '../lib/decision.js';
import { rejectReviews, restoreDecision, restoreDecisionSchema } from '../lib/decision-undo.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  createImportSchema,
  updateImportSchema,
  importIdParamSchema,
  connectionIdParamSchema,
  reviewQueueQuerySchema,
  decodeReviewCursor,
  updateReviewItemSchema,
  bulkReviewSchema,
  previewQuerySchema,
  previewImportSchema,
  publicPlaylistPreviewSchema,
  publicPlaylistImportSchema,
} from '../schemas/imports.js';
import { addImportScheduledJob, removeImportScheduledJob } from '../jobs/scheduler.js';
import { SpotifyService } from '../services/spotify.js';
import { LastfmService } from '../services/lastfm.js';
import { LidarrService, LidarrCache } from '../services/lidarr.js';
import { AIService } from '../services/ai.js';
import { getArtistImages } from '../services/artist-images.js';
import { addLogEntry } from './logs.js';
import { parseSpotifyPlaylistUrl, importPublicPlaylist } from '../services/public-playlist.js';
import { notificationService } from '../services/notifications.js';
import { createLogger } from '../lib/logger.js';
import { Prisma } from '@prisma/client';
import type { ImportSource, ReviewStatus, ReviewItem } from '@prisma/client';
import type { Request } from 'express';
import { LidarrConnectionConfig, normalizeLidarrConfig } from '../types/connections.js';

const log = createLogger('Imports');

export const importsRouter = Router();

importsRouter.use(requireAuth);

// Helper: Check if user can access an import source
function canAccessImportSource(req: Request, source: ImportSource): boolean {
  return req.user!.role === 'admin' || source.userId === req.user!.id;
}

// Get all import sources (admins see all, users see own)
importsRouter.get('/', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    
    const sources = await prisma.importSource.findMany({
      where: isAdmin ? {} : { userId: req.user!.id },
      include: {
        user: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ sources });
  } catch (error) {
    log.error('Failed to fetch import sources', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id },
    });
    res.status(500).json({ error: 'Failed to fetch import sources' });
  }
});

// Get import source by id
importsRouter.get('/:id', validateParams(importIdParamSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    
    const source = await prisma.importSource.findUnique({
      where: { id },
    });

    if (!source || !canAccessImportSource(req, source)) {
      res.status(404).json({ error: 'Import source not found' });
      return;
    }

    res.json({ source });
  } catch (error) {
    log.error('Failed to fetch import source', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, sourceId: req.params.id },
    });
    res.status(500).json({ error: 'Failed to fetch import source' });
  }
});

// Create import source
importsRouter.post('/', validateBody(createImportSchema), async (req, res) => {
  try {
    const { type, name, externalId, schedule, resultHandling, isActive } = req.body;

    const source = await prisma.importSource.create({
      data: {
        userId: req.user!.id,
        type,
        name,
        externalId,
        schedule,
        resultHandling: resultHandling || 'preview',
        isActive: isActive !== false,
      },
    });

    // Add to scheduler if has schedule
    if (source.schedule && source.isActive) {
      addImportScheduledJob(source.id, req.user!.id, source.schedule, source.resultHandling);
    }

    res.json({ success: true, source });
  } catch (error) {
    log.error('Failed to create import source', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, type: req.body?.type, name: req.body?.name },
    });
    res.status(500).json({ error: 'Failed to create import source' });
  }
});

// Update import source
importsRouter.put('/:id', validateParams(importIdParamSchema), validateBody(updateImportSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, externalId, schedule, resultHandling, isActive } = req.body;

    const existing = await prisma.importSource.findUnique({
      where: { id },
    });

    if (!existing || !canAccessImportSource(req, existing)) {
      res.status(404).json({ error: 'Import source not found' });
      return;
    }

    const source = await prisma.importSource.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(externalId !== undefined && { externalId }),
        ...(schedule !== undefined && { schedule }),
        ...(resultHandling && { resultHandling }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    // Update scheduler
    removeImportScheduledJob(id);
    if (source.schedule && source.isActive) {
      addImportScheduledJob(id, source.userId, source.schedule, source.resultHandling);
    }

    res.json({ success: true, source });
  } catch (error) {
    log.error('Failed to update import source', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, sourceId: req.params.id },
    });
    res.status(500).json({ error: 'Failed to update import source' });
  }
});

// Delete import source
importsRouter.delete('/:id', validateParams(importIdParamSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.importSource.findUnique({
      where: { id },
    });

    if (!existing || !canAccessImportSource(req, existing)) {
      res.status(404).json({ error: 'Import source not found' });
      return;
    }

    removeImportScheduledJob(id);
    await prisma.importSource.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete import source', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, sourceId: req.params.id },
    });
    res.status(500).json({ error: 'Failed to delete import source' });
  }
});

// Get review queue (admins see all, users see own)
importsRouter.get('/review/queue', validateQuery(reviewQueueQuerySchema), async (req, res) => {
  try {
    const limit = req.query.limit as unknown as number;
    const status = req.query.status as ReviewStatus;
    const itemType = req.query.itemType as string | undefined;
    const q = req.query.q as string;
    const isAdmin = req.user!.role === 'admin';
    const cursor = req.query.cursor ? decodeReviewCursor(req.query.cursor as string) : null;
    if (cursor && (cursor.actor !== req.user!.id || cursor.admin !== isAdmin || cursor.status !== status ||
      cursor.itemType !== (itemType ?? null) || cursor.q !== q)) {
      res.status(400).json({ error: 'Review cursor belongs to another queue scope', code: 'INVALID_CURSOR' });
      return;
    }
    // Prisma binds LIKE values; escape its wildcard syntax so catalog searches are literal.
    const search = q.replace(/[\\%_]/g, value => `\\${value}`);
    const where: Prisma.ReviewItemWhereInput = {
      ...(isAdmin ? {} : { userId: req.user!.id }), status,
      ...(itemType ? { itemType } : {}),
      ...(q ? { OR: [{ artistName: { contains: search } }, { albumName: { contains: search } }] } : {}),
    };
    const [page, total] = await Promise.all([
      prisma.reviewItem.findMany({
        where: cursor ? { AND: [where, { OR: [
          { createdAt: { lt: new Date(cursor.createdAt) } },
          { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
        ] }] } : where,
        include: { user: { select: { username: true, displayName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
      }),
      prisma.reviewItem.count({ where }),
    ]);
    const items = page.slice(0, limit);
    const last = items.at(-1);
    const nextCursor = page.length > limit && last ? Buffer.from(JSON.stringify({
      v: 1, id: last.id, createdAt: last.createdAt.toISOString(), actor: req.user!.id, admin: isAdmin,
      status, itemType: itemType ?? null, q,
    })).toString('base64url') : null;

    // Fetch artist images from Deezer
    const artistNames = items.map(item => item.artistName);
    const imageMap = await getArtistImages(artistNames);

    // Add images to items
    const itemsWithImages = items.map(item => ({
      ...item,
      imageUrl: imageMap.get(item.artistName),
    }));

    res.json({ items: itemsWithImages, total, nextCursor });
  } catch (error) {
    log.error('Failed to fetch review queue', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch review queue' });
  }
});

// A provider response can race a reject/restore; never overwrite its revision.
async function updateReviewDecision(item: ReviewItem, data: Prisma.ReviewItemUpdateManyMutationInput): Promise<Date> {
  const updatedAt = nextRevision([item.updatedAt]);
  await prisma.$transaction(async tx => {
    const changed = await tx.reviewItem.updateMany({
      where: { id: item.id, userId: item.userId, status: item.status, mbid: item.mbid, updatedAt: item.updatedAt },
      data: { ...data, updatedAt },
    });
    if (changed.count !== 1) throw new DecisionError(409, 'DECISION_CONFLICT', 'Review item changed');
  }, { timeout: 5_000 });
  return updatedAt;
}

// Static restoration route precedes dynamic review IDs.
importsRouter.post('/review/restore', validateBody(restoreDecisionSchema), async (req, res) => {
  try {
    res.json(await restoreDecision(prisma, req.body.undoToken, req.user!.id, 'review-reject'));
  } catch (error) {
    if (error instanceof DecisionError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else {
      log.error('Failed to restore review decision', { userId: req.user!.id });
      res.status(500).json({ error: 'Failed to restore review decision' });
    }
  }
});

type ReviewOutcome = { id: number; state: 'added' | 'already-in-library' | 'failed' | 'uncertain' | 'identity-required'; message: string };
function reviewSummary(outcomes: ReviewOutcome[]) {
  const addedIds = outcomes.filter(o => o.state === 'added' || o.state === 'already-in-library').map(o => o.id);
  const failedIds = outcomes.filter(o => o.state !== 'added' && o.state !== 'already-in-library').map(o => o.id);
  return { outcomes, added: outcomes.filter(o => o.state === 'added').length,
    alreadyInLibrary: outcomes.filter(o => o.state === 'already-in-library').length,
    failed: failedIds.length, addedIds, failedIds, success: failedIds.length === 0 };
}
function reviewFailure(id: number, error: unknown, possibleEffect = false): ReviewOutcome {
  if (error instanceof DecisionError && error.code === 'IDENTITY_REQUIRED') {
    return { id, state: 'identity-required', message: error.message };
  }
  const status = (error as { status?: unknown } | null)?.status;
  const definite = !possibleEffect && (error instanceof DecisionError ? error.code !== 'DECISION_CONFLICT' :
    typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429);
  return { id, state: definite ? 'failed' : 'uncertain', message: definite
    ? 'Lidarr did not accept this review item. It remains available for retry.'
    : 'Lidarr confirmation is unavailable. Check the library before retrying this review item.' };
}

async function approveReview(item: ReviewItem, lidarr: LidarrService, cache: LidarrCache,
  options: Awaited<ReturnType<typeof effectiveAddOptions>>, selectedMbid?: string): Promise<ReviewOutcome> {
  const mbid = (item.mbid || selectedMbid)?.toLowerCase();
  if (!mbid || !z.string().uuid().safeParse(mbid).success) throw new DecisionError(422, 'IDENTITY_REQUIRED', 'Choose a MusicBrainz artist before adding');
  if (item.mbid && selectedMbid && item.mbid.toLowerCase() !== selectedMbid.toLowerCase()) throw new DecisionError(409, 'IDENTITY_CONFLICT', 'Review already has an artist identity');
  if (item.itemType === 'album' && !z.string().uuid().safeParse(item.albumMbid).success) throw new DecisionError(422, 'IDENTITY_REQUIRED', 'Choose a valid album identity before adding');
  if (!item.mbid) {
    const updatedAt = await updateReviewDecision(item, { mbid });
    item = { ...item, mbid, updatedAt };
  }
  if (item.itemType !== 'album' && await cache.exists({ mbid })) {
    await updateReviewDecision(item, { status: 'approved', mbid });
    return { id: item.id, state: 'already-in-library', message: 'Artist is already in the library.' };
  }
  let alreadyInLibrary = false;
  if (item.itemType === 'album') {
    try {
      await lidarr.addAlbumWithCacheWarm(mbid, item.albumMbid!, options.qualityProfileId,
        options.metadataProfileId, options.rootFolderPath, undefined, options.searchOnAdd);
    } catch (error) {
      // Album monitoring can succeed before its subsequent search command rejects.
      log.warn('Album acquisition was not confirmed', { reviewId: item.id });
      return reviewFailure(item.id, error, true);
    }
  } else {
    const result = await lidarr.addArtistWithCacheWarm(mbid, options.qualityProfileId, options.metadataProfileId,
      options.rootFolderPath, true, options.searchOnAdd, false, options.monitorOption, options.monitorNewItems);
    alreadyInLibrary = result?.alreadyInLibrary === true;
  }
  await updateReviewDecision(item, { status: 'approved', mbid });
  // An ancillary log failure cannot undo a confirmed provider response and persisted decision.
  await addLogEntry('info', 'review', alreadyInLibrary ? `Artist "${item.artistName}" is already in Lidarr` : `Added ${item.itemType} "${item.albumName || item.artistName}" to Lidarr`,
    { reviewId: item.id, artistName: item.artistName, mbid }).catch(() => log.warn('Review log failed', { reviewId: item.id }));
  return { id: item.id, state: alreadyInLibrary ? 'already-in-library' : 'added',
    message: alreadyInLibrary ? 'Artist is already in the library.' : item.itemType === 'album' ? 'Album added to the library.' : 'Artist added to the library.' };
}

// Ownership is enforced for every mutation, including administrator decisions.
importsRouter.put('/review/:id', validateParams(importIdParamSchema), validateBody(updateReviewItemSchema), async (req, res) => {
  const id = Number(req.params.id);
  try {
    const item = await prisma.reviewItem.findFirst({ where: { id, userId: req.user!.id } });
    if (!item || item.userId !== req.user!.id) { res.status(404).json({ error: 'Review item not found' }); return; }
    if (item.status !== 'pending') throw new DecisionError(409, 'DECISION_CONFLICT', 'Review item already processed');
    if (req.body.status === 'rejected') {
      res.json({ success: true, ...await rejectReviews(prisma, [id], req.user!.id) }); return;
    }
    const connection = await prisma.connection.findFirst({ where: { OR: [
      { userId: req.user!.id, type: 'lidarr', isActive: true }, { userId: null, type: 'lidarr', isActive: true },
    ] }, orderBy: { userId: 'desc' } });
    if (!connection) throw new DecisionError(400, 'CONNECTION_REQUIRED', 'No active Lidarr connection');
    const config = normalizeLidarrConfig(connection.config as unknown as LidarrConnectionConfig);
    const lidarr = new LidarrService(config);
    const options = await effectiveAddOptions(lidarr, config, req.body);
    const outcome = await approveReview(item, lidarr, new LidarrCache(lidarr), options, req.body.mbid);
    if (outcome.state === 'added') {
      await notificationService.send(req.user!.id, 'artist.added', { artistName: item.artistName })
        .catch(() => log.warn('Review notification failed', { userId: req.user!.id }));
    }
    res.json({ ...reviewSummary([outcome]), itemType: item.itemType });
  } catch (error) {
    const summary = reviewSummary([reviewFailure(id, error)]);
    if (error instanceof DecisionError) {
      res.status(error.status).json({ error: error.message, code: error.code, ...summary, details: summary }); return;
    }
    log.error('Review acquisition was not confirmed', { reviewId: id });
    res.json(summary);
  }
});

importsRouter.post('/review/bulk', validateBody(bulkReviewSchema), async (req, res) => {
  try {
    const ids = [...new Set<number>(req.body.ids)];
    if (req.body.status === 'rejected') {
      res.json({ success: true, added: 0, alreadyInLibrary: 0, failed: 0, ...await rejectReviews(prisma, ids, req.user!.id) }); return;
    }
    const items = await prisma.reviewItem.findMany({ where: { id: { in: ids }, userId: req.user!.id } });
    if (items.length !== ids.length || items.some(item => item.status !== 'pending' || item.userId !== req.user!.id)) {
      throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected review is unavailable or already processed');
    }
    const connection = await prisma.connection.findFirst({ where: { OR: [
      { userId: req.user!.id, type: 'lidarr', isActive: true }, { userId: null, type: 'lidarr', isActive: true },
    ] }, orderBy: { userId: 'desc' } });
    if (!connection) throw new DecisionError(400, 'CONNECTION_REQUIRED', 'No active Lidarr connection');
    const config = normalizeLidarrConfig(connection.config as unknown as LidarrConnectionConfig);
    const lidarr = new LidarrService(config);
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    const options = await effectiveAddOptions(lidarr, config, req.body);
    const outcomes: ReviewOutcome[] = [];
    for (const id of ids) {
      const item = items.find(item => item.id === id)!;
      try { outcomes.push(await approveReview(item, lidarr, cache, options)); }
      catch (error) { outcomes.push(reviewFailure(id, error)); }
    }
    res.json(reviewSummary(outcomes));
  } catch (error) {
    const summary = reviewSummary([...new Set<number>(req.body.ids)].map(id => reviewFailure(id, error)));
    if (error instanceof DecisionError) {
      res.status(error.status).json({ error: error.message, code: error.code, ...summary, details: summary }); return;
    }
    log.error('Bulk review acquisition was not confirmed', { userId: req.user!.id });
    res.json(summary);
  }
});

// Helper to get Spotify service for user
async function getSpotifyService(userId: number): Promise<SpotifyService | null> {
  const connection = await prisma.connection.findFirst({
    where: { userId, type: 'spotify', isActive: true },
  });
  
  if (!connection) return null;
  
  const config = connection.config as {
    clientId: string;
    clientSecret: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: string;
  };
  
  return new SpotifyService(config, async (tokens) => {
    // Save refreshed tokens
    await prisma.connection.update({
      where: { id: connection.id },
      data: {
        config: {
          ...config,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(tokens.expiresAt).toISOString(),
        }
      }
    });
  });
}

// Refresh import sources from Spotify
importsRouter.post('/refresh', async (req, res) => {
  try {
    const spotify = await getSpotifyService(req.user!.id);
    
    if (!spotify) {
      res.status(400).json({ error: 'No active Spotify connection' });
      return;
    }

    const sourceCounts: Record<string, number> = {};

    // Get followed artists
    try {
      const artists = await spotify.getAllFollowedArtists();
      sourceCounts['followed_artists'] = artists.length;
    } catch (error) {
      log.warn('Failed to fetch followed artists', {
        error: error instanceof Error ? error.message : String(error),
      });
      sourceCounts['followed_artists'] = 0;
    }

    // Get saved albums
    try {
      const albums = await spotify.getAllSavedAlbums();
      sourceCounts['saved_albums'] = albums.length;
    } catch (error) {
      log.warn('Failed to fetch saved albums', {
        error: error instanceof Error ? error.message : String(error),
      });
      sourceCounts['saved_albums'] = 0;
    }

    // Get liked songs
    try {
      const songs = await spotify.getAllLikedSongs();
      sourceCounts['liked_songs'] = songs.length;
    } catch (error) {
      log.warn('Failed to fetch liked songs', {
        error: error instanceof Error ? error.message : String(error),
      });
      sourceCounts['liked_songs'] = 0;
    }

    // Get user playlists
    try {
      const response = await spotify.getUserPlaylists(50, 0);
      sourceCounts['playlists'] = response.total;
    } catch (error) {
      log.warn('Failed to fetch user playlists', {
        error: error instanceof Error ? error.message : String(error),
      });
      sourceCounts['playlists'] = 0;
    }

    res.json({ 
      success: true, 
      sources: sourceCounts,
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    log.error('Failed to refresh import sources', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to refresh sources' 
    });
  }
});

// Get available Spotify sources with counts
importsRouter.get('/sources/available', async (req, res) => {
  try {
    const spotify = await getSpotifyService(req.user!.id);
    
    if (!spotify) {
      res.status(400).json({ error: 'No active Spotify connection' });
      return;
    }

    // Get counts for each source type
    const [, playlists] = await Promise.all([
      spotify.getFollowedArtists(1).catch(() => ({ artists: { items: [] } })),
      spotify.getUserPlaylists(50, 0).catch(() => ({ items: [], total: 0 })),
    ]);

    const sources = [
      {
        type: 'followed_artists',
        name: 'Followed Artists',
        description: 'Import all artists you follow on Spotify',
        available: true,
      },
      {
        type: 'saved_albums',
        name: 'Saved Albums',
        description: 'Import artists from your saved albums',
        available: true,
      },
      {
        type: 'liked_songs',
        name: 'Liked Songs',
        description: 'Import artists from your liked songs',
        available: true,
      },
      ...playlists.items.map((pl: any) => ({
        type: 'playlist',
        externalId: pl.id,
        name: pl.name,
        description: `${pl.tracks.total} tracks`,
        available: true,
      })),
    ];

    res.json({ sources });
  } catch (error) {
    log.error('Failed to fetch available sources', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get sources' 
    });
  }
});

// Toggle import source active status
importsRouter.patch('/:id/toggle', validateParams(importIdParamSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);

    const existing = await prisma.importSource.findFirst({
      where: { id, userId: req.user!.id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Import source not found' });
      return;
    }

    const newIsActive = !existing.isActive;

    const source = await prisma.importSource.update({
      where: { id },
      data: { isActive: newIsActive },
    });

    // Update scheduler
    if (source.schedule) {
      if (newIsActive) {
        addImportScheduledJob(id, req.user!.id, source.schedule, source.resultHandling);
      } else {
        removeImportScheduledJob(id);
      }
    }

    res.json({ success: true, source });
  } catch (error) {
    log.error('Failed to toggle import source', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to toggle import source' });
  }
});

// PREVIEW ROUTES - V1 Feature Parity

// Helper to get Lidarr artist names for filtering
async function getLidarrArtistNames(userId: number): Promise<Set<string>> {
  const lidarrConnection = await prisma.connection.findFirst({
    where: {
      type: 'lidarr',
      isActive: true,
      OR: [{ userId }, { userId: null }], // User's own or global
    },
  });

  if (!lidarrConnection) return new Set();

  const config = lidarrConnection.config as { url: string; apiKey: string };
  const lidarr = new LidarrService(config);
  
  try {
    const artists = await lidarr.getArtists();
    return new Set(artists.map((a: { artistName: string }) => a.artistName.toLowerCase()));
  } catch (error) {
    log.warn('Failed to fetch Lidarr artist names for filtering', {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Set();
  }
}

// Helper to normalize artist name for comparison
function normalizeArtistName(name: string): string {
  return name.toLowerCase().trim();
}

// Get Spotify preview data for a connection
importsRouter.get('/preview/spotify/:connectionId', validateParams(connectionIdParamSchema), validateQuery(previewQuerySchema), async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const includeAI = req.query.ai === 'true';
    
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || connection.type !== 'spotify') {
      res.status(404).json({ error: 'Spotify connection not found' });
      return;
    }

    // Check access
    const isOwner = connection.userId === req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const config = connection.config as {
      clientId: string;
      clientSecret: string;
      accessToken?: string;
      refreshToken?: string;
      tokenExpiresAt?: number;
    };

    if (!config.accessToken || !config.refreshToken) {
      res.status(400).json({ error: 'Spotify not authorized. Please authorize first.' });
      return;
    }

    const spotify = new SpotifyService(config, async (tokens) => {
      // Update tokens on refresh
      await prisma.connection.update({
        where: { id: connectionId },
        data: {
          config: { ...config, ...tokens } as Prisma.InputJsonValue,
        },
      });
    });

    // Fetch followed artists and liked songs in parallel
    const [followedArtists, likedSongs] = await Promise.all([
      spotify.getAllFollowedArtists(),
      spotify.getLikedSongs(50, 0),
    ]);

    // Extract artists from liked songs
    const savedArtists = likedSongs.items.flatMap((item: any) => 
      item.track.artists.map((a: any) => ({
        id: a.id,
        name: a.name,
        images: [],
        genres: [],
        external_urls: a.external_urls,
      }))
    );

    // Deduplicate by artist ID
    const artistMap = new Map<string, any>();
    for (const artist of [...followedArtists, ...savedArtists]) {
      if (!artistMap.has(artist.id)) {
        artistMap.set(artist.id, artist);
      }
    }

    // Filter against Lidarr library
    const lidarrArtists = await getLidarrArtistNames(req.user!.id);
    let artists = Array.from(artistMap.values())
      .filter(a => !lidarrArtists.has(normalizeArtistName(a.name)))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Fetch Deezer images for artists without images
    const artistsNeedingImages = artists.filter(a => !a.images || a.images.length === 0);
    if (artistsNeedingImages.length > 0) {
      const imageMap = await getArtistImages(artistsNeedingImages.map(a => a.name));
      artists = artists.map(a => {
        if (!a.images || a.images.length === 0) {
          const imageUrl = imageMap.get(a.name);
          return imageUrl ? { ...a, images: [{ url: imageUrl }] } : a;
        }
        return a;
      });
    }

    // Get AI recommendations if requested
    let aiRecommendations: any[] = [];
    if (includeAI && artists.length > 0) {
      const artistNames = artists.slice(0, 20).map(a => a.name);
      const aiService = new AIService();
      aiRecommendations = await aiService.getRecommendations(artistNames, 20);
    }

    res.json({
      connection: { id: connection.id, name: connection.name },
      artists,
      aiRecommendations,
      total: artists.length,
      filtered: artistMap.size - artists.length,
    });
  } catch (error) {
    log.error('Spotify preview error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Spotify preview' 
    });
  }
});

// Get Last.fm preview data for a connection
importsRouter.get('/preview/lastfm/:connectionId', validateParams(connectionIdParamSchema), validateQuery(previewQuerySchema), async (req, res) => {
  try {
    const connectionId = Number(req.params.connectionId);
    const includeAI = req.query.ai === 'true';
    const includeSimilar = req.query.similar === 'true';
    
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || connection.type !== 'lastfm') {
      res.status(404).json({ error: 'Last.fm connection not found' });
      return;
    }

    // Check access
    const isOwner = connection.userId === req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    if (!isOwner && !isAdmin) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const config = connection.config as { apiKey: string; username?: string };
    const lastfm = new LastfmService({ apiKey: config.apiKey });

    // Fetch top artists from global charts
    const topArtists = await lastfm.getTopArtists(50);

    // Filter against Lidarr library
    const lidarrArtists = await getLidarrArtistNames(req.user!.id);
    const filteredArtists = topArtists.artists
      .filter(a => !lidarrArtists.has(normalizeArtistName(a.name)));

    // Fetch Deezer images for artists
    const artistNames = filteredArtists.map(a => a.name);
    const imageMap = await getArtistImages(artistNames);

    const artists = filteredArtists.map(a => ({
      name: a.name,
      playcount: a.playcount,
      listeners: a.listeners,
      mbid: a.mbid,
      url: a.url,
      images: imageMap.get(a.name) ? [{ url: imageMap.get(a.name) }] : [],
    }));

    // Get similar artists if requested
    let similarArtists: any[] = [];
    if (includeSimilar && artists.length > 0) {
      const topArtist = artists[0];
      try {
        const artistInfo = await lastfm.getArtistInfo(topArtist.name);
        if (artistInfo.similar?.artist) {
          const similarFiltered = artistInfo.similar.artist
            .filter(a => !lidarrArtists.has(normalizeArtistName(a.name)))
            .slice(0, 10);
          
          // Fetch images for similar artists too
          const similarNames = similarFiltered.map(a => a.name);
          const similarImageMap = await getArtistImages(similarNames);
          
          similarArtists = similarFiltered.map(a => ({
            name: a.name,
            url: a.url,
            images: similarImageMap.get(a.name) ? [{ url: similarImageMap.get(a.name) }] : [],
          }));
        }
      } catch (error) {
        log.warn('Failed to fetch similar artists from Last.fm', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Get AI recommendations if requested
    let aiRecommendations: any[] = [];
    if (includeAI && artists.length > 0) {
      const artistNames = artists.slice(0, 20).map(a => a.name);
      const aiService = new AIService();
      aiRecommendations = await aiService.getRecommendations(artistNames, 20);
    }

    res.json({
      connection: { id: connection.id, name: connection.name },
      artists,
      similarArtists,
      aiRecommendations,
      total: artists.length,
      filtered: topArtists.artists.length - artists.length,
    });
  } catch (error) {
    log.error('Last.fm preview error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Last.fm preview' 
    });
  }
});

// Import selected artists from preview
// Modes: 'auto' (default) - add to Lidarr, 'queue' - add to review queue, 'preview' - just return artists
importsRouter.post('/preview/import', validateBody(previewImportSchema), async (req, res) => {
  try {
    const { artistNames, mode } = req.body;

    // Get Lidarr connection (only required for auto mode)
    const lidarrConnection = await prisma.connection.findFirst({
      where: {
        type: 'lidarr',
        isActive: true,
        OR: [{ userId: req.user!.id }, { userId: null }],
      },
    });

    // Only require Lidarr for auto mode
    if (mode === 'auto' && !lidarrConnection) {
      res.status(400).json({ 
        error: 'Auto mode requires a Lidarr connection',
        code: 'LIDARR_REQUIRED'
      });
      return;
    }

    // Handle preview mode - just return the artists without any action
    if (mode === 'preview') {
      res.json({
        success: true,
        mode: 'preview',
        message: `Preview of ${artistNames.length} artist(s)`,
        artists: artistNames.map((name: string) => ({ name, status: 'preview' })),
      });
      return;
    }

    // Handle queue mode - add to review queue without Lidarr
    if (mode === 'queue') {
      const addedArtists: string[] = [];
      const skippedArtists: string[] = [];

      // Check which artists are already in review queue
      const existingReviewItems = await prisma.reviewItem.findMany({
        where: {
          userId: req.user!.id,
          artistName: { in: artistNames },
          status: 'pending',
        },
        select: { artistName: true },
      });
      const existingInQueue = new Set(existingReviewItems.map(r => r.artistName.toLowerCase()));

      // Add to review queue
      for (const artistName of artistNames) {
        if (existingInQueue.has(artistName.toLowerCase())) {
          skippedArtists.push(artistName);
          continue;
        }

        await prisma.reviewItem.create({
          data: {
            userId: req.user!.id,
            artistName,
            source: 'manual-import',
            status: 'pending',
          },
        });
        addedArtists.push(artistName);
      }

      await addLogEntry(
        'info',
        'import',
        `Added ${addedArtists.length} artist(s) to review queue`,
        { addedCount: addedArtists.length, skippedCount: skippedArtists.length, userId: req.user!.id }
      );

      res.json({
        success: true,
        mode: 'queue',
        message: `Added ${addedArtists.length} artist(s) to review queue${skippedArtists.length > 0 ? `, ${skippedArtists.length} already queued` : ''}`,
        added: addedArtists.length,
        skipped: skippedArtists.length,
        results: [
          ...addedArtists.map(name => ({ name, success: true, message: 'Added to review queue' })),
          ...skippedArtists.map(name => ({ name, success: false, message: 'Already in review queue' })),
        ],
      });
      return;
    }

    // Auto mode - add directly to Lidarr (lidarrConnection is guaranteed at this point)
    const config = lidarrConnection!.config as {
      url: string;
      apiKey: string;
      qualityProfileId?: number;
      metadataProfileId?: number;
      rootFolderPath?: string;
      monitorOption?: string;
      monitorNewItems?: string;
    };

    const lidarr = new LidarrService(config);
    const results: Array<{ name: string; success: boolean; message: string }> = [];

    for (const artistName of artistNames) {
      try {
        // Search MusicBrainz for the artist
        const searchResults = await lidarr.searchArtist(artistName);
        
        if (searchResults.length === 0) {
          results.push({ name: artistName, success: false, message: 'Artist not found in MusicBrainz' });
          continue;
        }

        // Add the first matching artist with SkyHook cache warming
        // Use monitorOption from connection config (defaults to 'all' if not set)
        const artist = searchResults[0];
        await lidarr.addArtistWithCacheWarm(
          artist.foreignArtistId,
          config.qualityProfileId || 1,
          config.metadataProfileId || 1,
          config.rootFolderPath || '/music',
          true,  // monitored
          true,  // searchForMissingAlbums
          false, // waitForRefresh (deprecated)
          config.monitorOption || 'all',
          config.monitorNewItems || 'all'
        );

        results.push({ name: artistName, success: true, message: 'Added to Lidarr' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to add artist';
        results.push({ name: artistName, success: false, message });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      success: successCount > 0,
      mode: 'auto',
      message: `Added ${successCount} artist(s), ${failCount} failed`,
      results,
    });
  } catch (error) {
    log.error('Preview import error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to import artists' 
    });
  }
});

// ============================================================================
// PUBLIC PLAYLIST IMPORT (No OAuth required)
// ============================================================================

// Preview public playlist - extracts artists without adding to queue
importsRouter.post('/public-playlist/preview', validateBody(publicPlaylistPreviewSchema), async (req, res) => {
  try {
    const { url, includeAllArtists } = req.body;
    
    const playlistId = parseSpotifyPlaylistUrl(url);
    if (!playlistId) {
      return res.status(400).json({ error: 'Invalid Spotify playlist URL' });
    }
    
    const result = await importPublicPlaylist(url, { includeAllArtists });
    
    // Check which artists are already in library
    let existingArtists: string[] = [];
    try {
      // Get Lidarr config
      const lidarrConnection = await prisma.connection.findFirst({
        where: {
          type: 'lidarr',
          isActive: true,
          OR: [{ userId: req.user!.id }, { userId: null }],
        },
      });
      
      if (lidarrConnection) {
        const config = lidarrConnection.config as { url: string; apiKey: string };
        const lidarrService = new LidarrService(config);
        const artists = await lidarrService.getArtists();
        existingArtists = artists.map(a => a.artistName.toLowerCase());
      }
    } catch (error) {
      log.warn('Failed to check Lidarr library for existing artists', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    
    const artistsWithStatus = result.artistNames.map(name => ({
      name,
      inLibrary: existingArtists.includes(name.toLowerCase()),
    }));
    
    res.json({
      playlistName: result.playlistName,
      totalTracks: result.totalTracks,
      artistCount: result.artistNames.length,
      artists: artistsWithStatus,
    });
  } catch (error) {
    log.error('Public playlist preview error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch playlist' 
    });
  }
});

// Import artists from public playlist to review queue
importsRouter.post('/public-playlist/import', validateBody(publicPlaylistImportSchema), async (req, res) => {
  try {
    const { url, selectedArtists, includeAllArtists } = req.body;
    
    const result = await importPublicPlaylist(url, { includeAllArtists });
    
    // Use selected artists if provided, otherwise use all
    const artistsToImport = selectedArtists && Array.isArray(selectedArtists)
      ? selectedArtists
      : result.artistNames;
    
    // Check which artists are already in review queue
    const existingReviewItems = await prisma.reviewItem.findMany({
      where: {
        userId: req.user!.id,
        artistName: { in: artistsToImport },
        status: 'pending',
      },
      select: { artistName: true },
    });
    const existingInQueue = new Set(existingReviewItems.map(r => r.artistName.toLowerCase()));
    
    // Add to review queue
    const addedArtists: string[] = [];
    const skippedArtists: string[] = [];
    
    for (const artistName of artistsToImport) {
      if (existingInQueue.has(artistName.toLowerCase())) {
        skippedArtists.push(artistName);
        continue;
      }
      
      await prisma.reviewItem.create({
        data: {
          userId: req.user!.id,
          artistName,
          source: `playlist:${result.playlistName}`,
          status: 'pending',
        },
      });
      addedArtists.push(artistName);
    }
    
    await addLogEntry(
      'info',
      'playlist-import',
      `Imported ${addedArtists.length} artists from playlist "${result.playlistName}"`,
      { playlistName: result.playlistName, addedCount: addedArtists.length, userId: req.user!.id }
    );
    
    res.json({
      success: true,
      playlistName: result.playlistName,
      added: addedArtists.length,
      skipped: skippedArtists.length,
      message: `Added ${addedArtists.length} artist(s) to review queue${skippedArtists.length > 0 ? `, ${skippedArtists.length} already queued` : ''}`,
    });
  } catch (error) {
    log.error('Public playlist import error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to import playlist' 
    });
  }
});