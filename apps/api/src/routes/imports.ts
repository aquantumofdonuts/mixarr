import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  createImportSchema,
  updateImportSchema,
  importIdParamSchema,
  connectionIdParamSchema,
  reviewQueueQuerySchema,
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
import { MusicBrainzService } from '../services/musicbrainz.js';
import { AIService } from '../services/ai.js';
import { fetchDeezerArtistImages } from '../services/deezer.js';
import { addLogEntry } from './logs.js';
import { parseSpotifyPlaylistUrl, importPublicPlaylist } from '../services/public-playlist.js';
import { notificationService } from '../services/notifications.js';
import { createLogger } from '../lib/logger.js';
import { Prisma } from '@prisma/client';
import type { ImportSource, ReviewStatus } from '@prisma/client';
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
    const status = req.query.status as string;
    const itemType = req.query.itemType as string | undefined;
    const isAdmin = req.user!.role === 'admin';

    const where = {
      ...(isAdmin ? {} : { userId: req.user!.id }),
      status: status as ReviewStatus,
      ...(itemType ? { itemType } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.reviewItem.findMany({
        where,
        include: {
          user: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      prisma.reviewItem.count({ where }),
    ]);

    // Fetch artist images from Deezer
    const artistNames = items.map(item => item.artistName);
    const imageMap = await fetchDeezerArtistImages(artistNames);

    // Add images to items
    const itemsWithImages = items.map(item => ({
      ...item,
      imageUrl: imageMap.get(item.artistName),
    }));

    res.json({ items: itemsWithImages, total });
  } catch (error) {
    log.error('Failed to fetch review queue', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch review queue' });
  }
});

// Update review item status
importsRouter.put('/review/:id', validateParams(importIdParamSchema), validateBody(updateReviewItemSchema), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;

    const item = await prisma.reviewItem.findUnique({
      where: { id },
    });

    if (!item) {
      res.status(404).json({ error: 'Review item not found' });
      return;
    }

    // Users can only update their own, admins can update any
    if (req.user!.role !== 'admin' && item.userId !== req.user!.id) {
      res.status(404).json({ error: 'Review item not found' });
      return;
    }

    // If rejecting or setting to pending, just update status
    if (status !== 'approved') {
      await prisma.reviewItem.update({
        where: { id },
        data: { status },
      });
      res.json({ success: true });
      return;
    }

    // For approved, add to Lidarr
    const lidarrConn = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId: item.userId, type: 'lidarr', isActive: true },
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
    const cache = new LidarrCache(lidarr);
    await cache.refresh();

    // Skip if already in library
    if (await cache.exists({ name: item.artistName, mbid: item.mbid || undefined })) {
      await prisma.reviewItem.update({
        where: { id },
        data: { status: 'approved' },
      });
      await addLogEntry('info', 'review', `Artist "${item.artistName}" already in library`, {
        artistName: item.artistName,
        mbid: item.mbid,
      });
      res.json({ success: true, message: 'Artist already in library', alreadyInLibrary: true });
      return;
    }

    // Get MBID if not available
    let foreignArtistId = item.mbid;
    if (!foreignArtistId) {
      const searchResults = await lidarr.searchArtist(item.artistName);
      if (searchResults.length > 0) {
        foreignArtistId = searchResults[0].foreignArtistId;
      } else {
        const musicbrainz = new MusicBrainzService();
        foreignArtistId = await musicbrainz.getMbidFromSpotifyArtist(item.artistName);
      }
    }

    if (!foreignArtistId) {
      await addLogEntry('warn', 'review', `Artist "${item.artistName}" not found in Lidarr or MusicBrainz`, {
        artistName: item.artistName,
      });
      res.status(400).json({ error: 'Artist not found in Lidarr or MusicBrainz' });
      return;
    }

    // Get Lidarr defaults
    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      lidarr.getQualityProfiles(),
      lidarr.getMetadataProfiles(),
      lidarr.getRootFolders(),
    ]);

    // Add to Lidarr - check if this is an album or artist approval
    const isAlbumApproval = item.itemType === 'album' && item.albumMbid;
    
    if (isAlbumApproval) {
      // Album approval - warm cache, add specific album (and artist if needed)
      await lidarr.addAlbumWithCacheWarm(
        foreignArtistId,
        item.albumMbid!,
        qualityProfiles[0].id,
        metadataProfiles[0].id,
        rootFolders[0].path
      );
      
      await prisma.reviewItem.update({
        where: { id },
        data: { status: 'approved', mbid: foreignArtistId },
      });

      await addLogEntry('info', 'review', `Added album "${item.albumName}" by "${item.artistName}" to Lidarr`, {
        artistName: item.artistName,
        albumName: item.albumName,
        mbid: foreignArtistId,
        albumMbid: item.albumMbid,
      });

      // Send notification
      await notificationService.send(req.user!.id, 'artist.added', {
        artistName: `${item.albumName} by ${item.artistName}`,
      });

      res.json({ success: true, added: true, itemType: 'album' });
    } else {
      // Artist approval (default behavior) - warm SkyHook cache for reliable lookup
      // Use monitorOption from connection config (defaults to 'all' if not set)
      await lidarr.addArtistWithCacheWarm(
        foreignArtistId,
        qualityProfiles[0].id,
        metadataProfiles[0].id,
        rootFolders[0].path,
        true,  // monitored
        true,  // searchForMissingAlbums
        false, // waitForRefresh (deprecated)
        lidarrConfig.monitorOption || 'all',
        lidarrConfig.monitorNewItems || 'all'
      );

      await prisma.reviewItem.update({
        where: { id },
        data: { status: 'approved', mbid: foreignArtistId },
      });

      await addLogEntry('info', 'review', `Added artist "${item.artistName}" to Lidarr`, {
        artistName: item.artistName,
        mbid: foreignArtistId,
      });

      // Send notification
      await notificationService.send(req.user!.id, 'artist.added', {
        artistName: item.artistName,
      });

      res.json({ success: true, added: true, itemType: 'artist' });
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to update review item';
    log.error('PUT /review/:id error:', error);
    await addLogEntry('error', 'review', `Failed to add artist to Lidarr: ${errorMsg}`, {
      error: errorMsg,
    });

    // Send failure notification
    await notificationService.send(req.user!.id, 'artist.failed', {
      artistName: 'Unknown',
      error: errorMsg,
    });

    res.status(500).json({ error: errorMsg });
  }
});

// Bulk update review items
importsRouter.post('/review/bulk', validateBody(bulkReviewSchema), async (req, res) => {
  try {
    const { ids, status } = req.body;

    // If rejecting, just update status
    if (status === 'rejected' || status === 'pending') {
      await prisma.reviewItem.updateMany({
        where: {
          id: { in: ids },
          userId: req.user!.id,
        },
        data: { status },
      });
      res.json({ success: true, added: 0, failed: 0 });
      return;
    }

    // For approved items, add to Lidarr
    const items = await prisma.reviewItem.findMany({
      where: {
        id: { in: ids },
        userId: req.user!.id,
        status: 'pending',
      },
    });

    if (items.length === 0) {
      res.json({ success: true, added: 0, failed: 0 });
      return;
    }

    // Get Lidarr connection (user's own or global)
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
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    const musicbrainz = new MusicBrainzService();

    // Get Lidarr defaults
    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      lidarr.getQualityProfiles(),
      lidarr.getMetadataProfiles(),
      lidarr.getRootFolders(),
    ]);

    if (!qualityProfiles.length || !metadataProfiles.length || !rootFolders.length) {
      res.status(400).json({ error: 'Lidarr missing profiles or root folders' });
      return;
    }

    let added = 0;
    let failed = 0;
    const failedItems: Array<{ name: string; error: string }> = [];

    log.debug(`Processing ${items.length} review items for approval`);

    for (const item of items) {
      try {
        const isAlbum = item.itemType === 'album';
        log.debug(`Processing review item: ${item.artistName}${isAlbum ? ` - ${item.albumName}` : ''} (mbid: ${item.mbid || 'none'}, type: ${item.itemType || 'artist'})`);
        
        // For artists: Skip if already in library
        if (!isAlbum && await cache.exists({ name: item.artistName, mbid: item.mbid || undefined })) {
          log.debug(`Artist ${item.artistName} already in library, marking approved`);
          await prisma.reviewItem.update({
            where: { id: item.id },
            data: { status: 'approved' },
          });
          await addLogEntry('info', 'review', `Artist "${item.artistName}" already in library`, {
            artistName: item.artistName,
            mbid: item.mbid,
          });
          continue;
        }

        // Get MBID if not available - try Lidarr search first
        let foreignArtistId = item.mbid;
        
        if (!foreignArtistId) {
          log.debug(`No MBID for ${item.artistName}, searching Lidarr...`);
          // Search Lidarr by artist name
          const searchResults = await lidarr.searchArtist(item.artistName);
          if (searchResults.length > 0) {
            foreignArtistId = searchResults[0].foreignArtistId;
            log.debug(`Found via Lidarr search: ${foreignArtistId}`);
          } else {
            // Fall back to MusicBrainz
            log.debug(`Not found in Lidarr, trying MusicBrainz...`);
            foreignArtistId = await musicbrainz.getMbidFromSpotifyArtist(item.artistName);
            if (foreignArtistId) {
              log.debug(`Found via MusicBrainz: ${foreignArtistId}`);
            }
          }
        }

        if (!foreignArtistId) {
          log.debug(`No MBID found for ${item.artistName}`);
          failedItems.push({ name: item.artistName, error: 'Artist not found' });
          await prisma.reviewItem.update({
            where: { id: item.id },
            data: { status: 'rejected' },
          });
          await addLogEntry('warn', 'review', `Artist "${item.artistName}" not found in Lidarr or MusicBrainz`, {
            artistName: item.artistName,
          });
          failed++;
          continue;
        }

        if (isAlbum) {
          // For album items: add artist as unmonitored and monitor specific album
          log.debug(`Adding album "${item.albumName}" by ${item.artistName} (${foreignArtistId}) to Lidarr...`);
          
          // Get album MBID if not available
          let albumMbid = item.albumMbid;
          if (!albumMbid && item.albumName) {
            // Search for the album in Lidarr
            const albumSearchResults = await lidarr.searchAlbum(`${item.albumName} ${item.artistName}`);
            if (albumSearchResults.length > 0) {
              albumMbid = albumSearchResults[0].foreignAlbumId;
              log.debug(`Found album via Lidarr search: ${albumMbid}`);
            }
          }
          
          if (!albumMbid) {
            log.debug(`No album MBID found for "${item.albumName}" by ${item.artistName}`);
            failedItems.push({ name: `${item.artistName} - ${item.albumName}`, error: 'Album not found' });
            await prisma.reviewItem.update({
              where: { id: item.id },
              data: { status: 'rejected' },
            });
            failed++;
            continue;
          }
          
          await lidarr.addAlbumWithCacheWarm(
            foreignArtistId,
            albumMbid,
            qualityProfiles[0].id,
            metadataProfiles[0].id,
            rootFolders[0].path
          );
          log.info(`Successfully added album "${item.albumName}" by ${item.artistName} to Lidarr`);
          
          await addLogEntry('info', 'review', `Added album "${item.albumName}" by "${item.artistName}" to Lidarr`, {
            artistName: item.artistName,
            albumName: item.albumName,
            mbid: foreignArtistId,
            albumMbid: albumMbid,
          });
        } else {
          // For artist items: warm SkyHook cache for reliable metadata lookup
          // Use monitorOption from connection config (defaults to 'all' if not set)
          log.debug(`Adding ${item.artistName} (${foreignArtistId}) to Lidarr...`);
          await lidarr.addArtistWithCacheWarm(
            foreignArtistId,
            qualityProfiles[0].id,
            metadataProfiles[0].id,
            rootFolders[0].path,
            true,  // monitored
            true,  // searchForMissingAlbums
            false, // waitForRefresh (deprecated)
            lidarrConfig.monitorOption || 'all',
            lidarrConfig.monitorNewItems || 'all'
          );
          log.info(`Successfully added ${item.artistName} to Lidarr`);
          
          // Log each successful add
          await addLogEntry('info', 'review', `Added artist "${item.artistName}" to Lidarr`, {
            artistName: item.artistName,
            mbid: foreignArtistId,
          });
        }

        await prisma.reviewItem.update({
          where: { id: item.id },
          data: { status: 'approved', mbid: foreignArtistId },
        });
        added++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        log.error(`Failed to add ${item.artistName}:`, errorMsg);
        failedItems.push({ name: item.artistName, error: errorMsg });
        await prisma.reviewItem.update({
          where: { id: item.id },
          data: { status: 'rejected' },
        });
        failed++;
      }
    }

    // Log bulk operation summary
    if (added > 0 || failed > 0) {
      await addLogEntry('info', 'review', `Bulk review: ${added} added, ${failed} failed`, {
        added,
        failed,
        failedItems,
      });
    }

    res.json({ success: true, added, failed, failedItems });
  } catch (error) {
    log.error('Failed to process review items', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to process review items' });
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
      const imageMap = await fetchDeezerArtistImages(artistsNeedingImages.map(a => a.name));
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
    const imageMap = await fetchDeezerArtistImages(artistNames);

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
          const similarImageMap = await fetchDeezerArtistImages(similarNames);
          
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