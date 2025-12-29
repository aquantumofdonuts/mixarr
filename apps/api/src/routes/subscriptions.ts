import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { addScheduledJob, removeScheduledJob } from '../jobs/scheduler.js';
import { fetchDeezerArtistImages } from '../services/deezer.js';
import { LidarrService } from '../services/lidarr.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { notificationService } from '../services/notifications.js';
import type { Subscription, ConnectionType } from '@prisma/client';
import type { Request } from 'express';

export const subscriptionsRouter = Router();

subscriptionsRouter.use(requireAuth);

// Helper: Check if user can access a subscription
function canAccessSubscription(req: Request, subscription: Subscription): boolean {
  return req.user!.role === 'admin' || subscription.userId === req.user!.id;
}

// Get all subscriptions (admins see all, users see own)
subscriptionsRouter.get('/', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    
    const subscriptions = await prisma.subscription.findMany({
      where: isAdmin ? {} : { userId: req.user!.id },
      include: {
        user: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ subscriptions });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// Get subscription by id
subscriptionsRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    res.json({ subscription });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// Create subscription
subscriptionsRouter.post('/', async (req, res) => {
  try {
    const { name, type, config, schedule, resultHandling, isActive } = req.body;

    if (!name || !type) {
      res.status(400).json({ error: 'Name and type required' });
      return;
    }

    // Auto-link the appropriate connection based on subscription type
    let connectionId: number | null = null;
    
    // Determine required connection type from subscription type
    let requiredConnType: ConnectionType | null = null;
    if (type.startsWith('spotify_')) requiredConnType = 'spotify';
    else if (type.startsWith('lastfm_')) requiredConnType = 'lastfm';
    else if (type.startsWith('deezer_')) requiredConnType = 'deezer';
    else if (type.startsWith('tidal_')) requiredConnType = 'tidal';
    else if (type === 'tautulli') requiredConnType = 'tautulli';
    
    if (requiredConnType) {
      // Find user's connection of that type (or global fallback)
      const conn = await prisma.connection.findFirst({
        where: {
          OR: [
            { userId: req.user!.id, type: requiredConnType, isActive: true },
            { userId: null, type: requiredConnType, isActive: true },
          ],
        },
        orderBy: { userId: 'desc' }, // Prefer user's own
      });
      connectionId = conn?.id || null;
    }

    const subscription = await prisma.subscription.create({
      data: {
        userId: req.user!.id,
        connectionId,
        name,
        type,
        config: config || {},
        schedule,
        resultHandling: resultHandling || 'preview',
        isActive: isActive !== false,
      },
    });

    // Add to scheduler if has schedule
    if (subscription.schedule && subscription.isActive) {
      addScheduledJob(subscription.id, req.user!.id, subscription.schedule);
    }

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('POST /subscriptions error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to create subscription' 
    });
  }
});

// Update subscription
subscriptionsRouter.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, config, schedule, resultHandling, isActive } = req.body;

    const existing = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!existing || !canAccessSubscription(req, existing)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(config && { config }),
        ...(schedule !== undefined && { schedule }),
        ...(resultHandling && { resultHandling }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    // Update scheduler
    removeScheduledJob(id);
    if (subscription.schedule && subscription.isActive) {
      addScheduledJob(id, subscription.userId, subscription.schedule);
    }

    res.json({ success: true, subscription });
  } catch (error) {
    console.error('PUT /subscriptions/:id error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to update subscription' 
    });
  }
});

// Delete subscription
subscriptionsRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);

    const existing = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!existing || !canAccessSubscription(req, existing)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    removeScheduledJob(id);
    await prisma.subscription.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete subscription' });
  }
});

// Get subscription run history
subscriptionsRouter.get('/:id/runs', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const [runs, total] = await Promise.all([
      prisma.subscriptionRun.findMany({
        where: { subscriptionId: id },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.subscriptionRun.count({ where: { subscriptionId: id } }),
    ]);

    res.json({ runs, total, limit, offset });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch run history' });
  }
});

// Get run details with results
subscriptionsRouter.get('/:id/runs/:runId', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const runId = parseInt(req.params.runId, 10);

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || !canAccessSubscription(req, subscription)) {
      res.status(404).json({ error: 'Subscription not found' });
      return;
    }

    const run = await prisma.subscriptionRun.findFirst({
      where: { id: runId, subscriptionId: id },
    });

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const results = await prisma.subscriptionResult.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch artist images from Deezer
    const artistNames = results.map(r => r.name);
    const imageMap = await fetchDeezerArtistImages(artistNames);

    // Add images to results
    const resultsWithImages = results.map(r => ({
      ...r,
      imageUrl: imageMap.get(r.name),
    }));

    res.json({ run, results: resultsWithImages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch run details' });
  }
});

// Get all results for a subscription (paginated)
subscriptionsRouter.get('/:id/results', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
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

    // Fetch artist images from Deezer
    const artistNames = results.map(r => r.name);
    const imageMap = await fetchDeezerArtistImages(artistNames);

    // Add images to results
    const resultsWithImages = results.map(r => ({
      ...r,
      imageUrl: imageMap.get(r.name),
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
    const id = parseInt(req.params.id, 10);
    const resultId = parseInt(req.params.resultId, 10);

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

    const lidarrConfig = lidarrConn.config as { url: string; apiKey: string };
    const lidarr = new LidarrService(lidarrConfig);

    // Get or find MBID
    let mbid = result.mbid;
    if (!mbid) {
      const musicbrainz = new MusicBrainzService();
      mbid = await musicbrainz.getMbidFromSpotifyArtist(result.name) || null;
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
      const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
        lidarr.getQualityProfiles(),
        lidarr.getMetadataProfiles(),
        lidarr.getRootFolders(),
      ]);

      // Add to Lidarr with metadata refresh for complete MusicBrainz data
      await lidarr.addArtistWithRefresh(
        mbid,
        qualityProfiles[0].id,
        metadataProfiles[0].id,
        rootFolders[0].path
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
    console.error('Approve error:', error);
    res.status(500).json({ error: 'Failed to approve result' });
  }
});

// Reject a pending result
subscriptionsRouter.post('/:id/results/:resultId/reject', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const resultId = parseInt(req.params.resultId, 10);

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
subscriptionsRouter.get('/presets/list', async (_req, res) => {
  const presets = [
    // GLOBAL CHARTS
    {
      id: 'global-top-50',
      name: 'Global Top 50 Artists',
      description: 'Global top 50 artists from Last.fm charts',
      type: 'lastfm_chart',
      category: 'charts',
      config: { limit: 50 },
    },
    {
      id: 'global-top-100',
      name: 'Global Top 100 Artists',
      description: 'Global top 100 artists from Last.fm charts',
      type: 'lastfm_chart',
      category: 'charts',
      config: { limit: 100 },
    },

    // GENRE TAGS
    {
      id: 'top-rock',
      name: 'Top Rock Artists',
      description: 'Top rock artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'rock', limit: 50 },
    },
    {
      id: 'top-alternative',
      name: 'Top Alternative Artists',
      description: 'Top alternative artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'alternative', limit: 50 },
    },
    {
      id: 'top-indie',
      name: 'Top Indie Artists',
      description: 'Top indie artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'indie', limit: 50 },
    },
    {
      id: 'top-pop',
      name: 'Top Pop Artists',
      description: 'Top pop artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'pop', limit: 50 },
    },
    {
      id: 'top-hiphop',
      name: 'Top Hip-Hop Artists',
      description: 'Top hip-hop artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'hip-hop', limit: 50 },
    },
    {
      id: 'top-rap',
      name: 'Top Rap Artists',
      description: 'Top rap artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'rap', limit: 50 },
    },
    {
      id: 'top-electronic',
      name: 'Top Electronic Artists',
      description: 'Top electronic artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'electronic', limit: 50 },
    },
    {
      id: 'top-dance',
      name: 'Top Dance Artists',
      description: 'Top dance artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'dance', limit: 50 },
    },
    {
      id: 'top-house',
      name: 'Top House Artists',
      description: 'Top house music artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'house', limit: 50 },
    },
    {
      id: 'top-techno',
      name: 'Top Techno Artists',
      description: 'Top techno artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'techno', limit: 50 },
    },
    {
      id: 'top-metal',
      name: 'Top Metal Artists',
      description: 'Top metal artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'metal', limit: 50 },
    },
    {
      id: 'top-punk',
      name: 'Top Punk Artists',
      description: 'Top punk artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'punk', limit: 50 },
    },
    {
      id: 'top-jazz',
      name: 'Top Jazz Artists',
      description: 'Top jazz artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'jazz', limit: 50 },
    },
    {
      id: 'top-blues',
      name: 'Top Blues Artists',
      description: 'Top blues artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'blues', limit: 50 },
    },
    {
      id: 'top-soul',
      name: 'Top Soul Artists',
      description: 'Top soul artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'soul', limit: 50 },
    },
    {
      id: 'top-rnb',
      name: 'Top R&B Artists',
      description: 'Top R&B artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'rnb', limit: 50 },
    },
    {
      id: 'top-country',
      name: 'Top Country Artists',
      description: 'Top country artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'country', limit: 50 },
    },
    {
      id: 'top-folk',
      name: 'Top Folk Artists',
      description: 'Top folk artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'folk', limit: 50 },
    },
    {
      id: 'top-classical',
      name: 'Top Classical Artists',
      description: 'Top classical artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'classical', limit: 50 },
    },
    {
      id: 'top-ambient',
      name: 'Top Ambient Artists',
      description: 'Top ambient artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'ambient', limit: 50 },
    },
    {
      id: 'top-reggae',
      name: 'Top Reggae Artists',
      description: 'Top reggae artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'reggae', limit: 50 },
    },
    {
      id: 'top-latin',
      name: 'Top Latin Artists',
      description: 'Top latin artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'latin', limit: 50 },
    },
    {
      id: 'top-kpop',
      name: 'Top K-Pop Artists',
      description: 'Top K-Pop artists from Last.fm',
      type: 'lastfm_tag',
      category: 'genre',
      config: { tag: 'k-pop', limit: 50 },
    },

    // GEOGRAPHIC
    {
      id: 'usa-top-artists',
      name: 'USA Top Artists',
      description: 'Top artists in the United States',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'united states', limit: 50 },
    },
    {
      id: 'uk-top-artists',
      name: 'UK Top Artists',
      description: 'Top artists in the United Kingdom',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'united kingdom', limit: 50 },
    },
    {
      id: 'germany-top-artists',
      name: 'Germany Top Artists',
      description: 'Top artists in Germany',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'germany', limit: 50 },
    },
    {
      id: 'france-top-artists',
      name: 'France Top Artists',
      description: 'Top artists in France',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'france', limit: 50 },
    },
    {
      id: 'japan-top-artists',
      name: 'Japan Top Artists',
      description: 'Top artists in Japan',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'japan', limit: 50 },
    },
    {
      id: 'australia-top-artists',
      name: 'Australia Top Artists',
      description: 'Top artists in Australia',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'australia', limit: 50 },
    },
    {
      id: 'canada-top-artists',
      name: 'Canada Top Artists',
      description: 'Top artists in Canada',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'canada', limit: 50 },
    },
    {
      id: 'brazil-top-artists',
      name: 'Brazil Top Artists',
      description: 'Top artists in Brazil',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'brazil', limit: 50 },
    },
    {
      id: 'mexico-top-artists',
      name: 'Mexico Top Artists',
      description: 'Top artists in Mexico',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'mexico', limit: 50 },
    },
    {
      id: 'spain-top-artists',
      name: 'Spain Top Artists',
      description: 'Top artists in Spain',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'spain', limit: 50 },
    },
    {
      id: 'italy-top-artists',
      name: 'Italy Top Artists',
      description: 'Top artists in Italy',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'italy', limit: 50 },
    },
    {
      id: 'netherlands-top-artists',
      name: 'Netherlands Top Artists',
      description: 'Top artists in Netherlands',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'netherlands', limit: 50 },
    },
    {
      id: 'sweden-top-artists',
      name: 'Sweden Top Artists',
      description: 'Top artists in Sweden',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'sweden', limit: 50 },
    },
    {
      id: 'korea-top-artists',
      name: 'South Korea Top Artists',
      description: 'Top artists in South Korea',
      type: 'lastfm_geo',
      category: 'geographic',
      config: { country: 'south korea', limit: 50 },
    },

    // SPOTIFY PERSONALIZED
    {
      id: 'spotify-followed',
      name: 'My Followed Artists',
      description: 'Import all artists you follow on Spotify',
      type: 'spotify_followed',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-saved-albums',
      name: 'My Saved Albums',
      description: 'Import artists from your saved albums',
      type: 'spotify_saved_albums',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-liked-songs',
      name: 'My Liked Songs',
      description: 'Import artists from your liked songs',
      type: 'spotify_liked_songs',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-discover-weekly',
      name: 'Discover Weekly',
      description: 'Your personalized Discover Weekly playlist',
      type: 'spotify_discover_weekly',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-release-radar',
      name: 'Release Radar',
      description: 'New releases from artists you follow',
      type: 'spotify_release_radar',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-daily-mix',
      name: 'Daily Mix (All)',
      description: 'All your Daily Mix playlists combined',
      type: 'spotify_daily_mix',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-on-repeat',
      name: 'On Repeat',
      description: 'Songs you have been playing on repeat',
      type: 'spotify_on_repeat',
      category: 'spotify',
      config: {},
    },
    {
      id: 'spotify-new-releases',
      name: 'Spotify New Releases',
      description: 'New album releases on Spotify',
      type: 'spotify_new_releases',
      category: 'spotify',
      config: { limit: 50 },
    },
    {
      id: 'spotify-featured-playlists',
      name: 'Featured Playlists',
      description: 'Artists from Spotify featured playlists',
      type: 'spotify_featured',
      category: 'spotify',
      config: { limit: 50 },
    },
    {
      id: 'spotify-top-50-global',
      name: 'Top 50 Global',
      description: 'Most streamed tracks worldwide',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZbQMOIybLQPlbIaU', limit: 50 },
    },
    {
      id: 'spotify-top-50-usa',
      name: 'Top 50 USA',
      description: 'Most streamed tracks in the United States',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZbQMOBAZRJvCENCl', limit: 50 },
    },
    {
      id: 'spotify-top-50-uk',
      name: 'Top 50 UK',
      description: 'Most streamed tracks in the United Kingdom',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZbQMSDvIhFszB6qG', limit: 50 },
    },
    {
      id: 'spotify-viral-50-global',
      name: 'Viral 50 Global',
      description: 'Trending viral tracks worldwide',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZbQMOVhmKGWRLdGd', limit: 50 },
    },
    {
      id: 'spotify-rapcaviar',
      name: 'RapCaviar',
      description: 'Top hip-hop and rap tracks',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZF1DX0XUsuxWHRQd', limit: 50 },
    },
    {
      id: 'spotify-todays-top-hits',
      name: "Today's Top Hits",
      description: 'The biggest songs right now',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZF1DXcBWIGoYBM5M', limit: 50 },
    },
    {
      id: 'spotify-rock-this',
      name: 'Rock This',
      description: 'Top rock tracks',
      type: 'spotify_playlist',
      category: 'spotify',
      config: { playlistId: '37i9dQZF1DXcF6B6QPhFDv', limit: 50 },
    },
    {
      id: 'spotify-public-playlist',
      name: 'Public Playlist (Any URL)',
      description: 'Import from any public Spotify playlist - no login required',
      type: 'spotify_public_playlist',
      category: 'spotify',
      config: { publicPlaylistUrl: '', discoverAlbums: false, includeAllArtists: false },
    },
    {
      id: 'spotify-category-pop',
      name: 'Pop Hits',
      description: 'Top pop artists from category playlists',
      type: 'spotify_category',
      category: 'spotify',
      config: { categoryId: 'pop', limit: 50 },
    },
    {
      id: 'spotify-category-hiphop',
      name: 'Hip-Hop Central',
      description: 'Top hip-hop artists from category playlists',
      type: 'spotify_category',
      category: 'spotify',
      config: { categoryId: 'hiphop', limit: 50 },
    },
    {
      id: 'spotify-category-rock',
      name: 'Rock Essentials',
      description: 'Top rock artists from category playlists',
      type: 'spotify_category',
      category: 'spotify',
      config: { categoryId: 'rock', limit: 50 },
    },
    {
      id: 'spotify-category-electronic',
      name: 'Electronic/Dance',
      description: 'Top electronic artists from category playlists',
      type: 'spotify_category',
      category: 'spotify',
      config: { categoryId: 'edm_dance', limit: 50 },
    },

    // MUSICBRAINZ
    {
      id: 'mb-new-releases-week',
      name: 'New Releases This Week',
      description: 'Recent releases from MusicBrainz',
      type: 'musicbrainz_new',
      category: 'musicbrainz',
      config: { days: 7, limit: 50 },
    },
    {
      id: 'mb-new-releases-month',
      name: 'New Releases This Month',
      description: 'Releases from the past month',
      type: 'musicbrainz_new',
      category: 'musicbrainz',
      config: { days: 30, limit: 100 },
    },

    // MY LIBRARY
    {
      id: 'spotify-library',
      name: 'My Spotify Library',
      description: 'Sync all artists from your Spotify library (followed + liked songs + saved albums)',
      type: 'spotify_library',
      category: 'library',
      config: {},
    },
    {
      id: 'lastfm-library-overall',
      name: 'My Last.fm Top Artists (All Time)',
      description: 'Your most listened artists from all time',
      type: 'lastfm_library',
      category: 'library',
      config: { period: 'overall', limit: 100 },
    },
    {
      id: 'lastfm-library-year',
      name: 'My Last.fm Top Artists (12 Months)',
      description: 'Your most listened artists from the past year',
      type: 'lastfm_library',
      category: 'library',
      config: { period: '12month', limit: 50 },
    },
    {
      id: 'lastfm-library-month',
      name: 'My Last.fm Top Artists (Last Month)',
      description: 'Your most listened artists from the past month',
      type: 'lastfm_library',
      category: 'library',
      config: { period: '1month', limit: 50 },
    },
    {
      id: 'lastfm-similar-overall',
      name: 'Last.fm Similar Artists (All Time)',
      description: 'Artists similar to your all-time top scrobbled artists',
      type: 'lastfm_similar',
      category: 'library',
      config: { period: 'overall', topArtistsLimit: 20, similarPerArtist: 10, limit: 100 },
    },
    {
      id: 'lastfm-similar-year',
      name: 'Last.fm Similar Artists (12 Months)',
      description: 'Artists similar to your top artists from the past year',
      type: 'lastfm_similar',
      category: 'library',
      config: { period: '12month', topArtistsLimit: 15, similarPerArtist: 10, limit: 75 },
    },
    {
      id: 'lastfm-similar-recent',
      name: 'Last.fm Similar Artists (Last Month)',
      description: 'Artists similar to what you\'ve been listening to recently',
      type: 'lastfm_similar',
      category: 'library',
      config: { period: '1month', topArtistsLimit: 10, similarPerArtist: 10, limit: 50 },
    },

    // AI RECOMMENDATIONS
    {
      id: 'ai-spotify-similar',
      name: 'AI Similar Artists (Spotify)',
      description: 'AI-powered similar artist recommendations based on your Spotify library',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'spotify', strategy: 'similar', limit: 20 },
    },
    {
      id: 'ai-spotify-genre',
      name: 'AI Genre Expansion (Spotify)',
      description: 'Discover related genres based on your Spotify library',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'spotify', strategy: 'genre_expansion', limit: 20 },
    },
    {
      id: 'ai-spotify-discovery',
      name: 'AI Discovery (Spotify)',
      description: 'Completely new discoveries based on your Spotify library',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'spotify', strategy: 'discovery', limit: 20 },
    },
    {
      id: 'ai-lastfm-similar',
      name: 'AI Similar Artists (Last.fm)',
      description: 'AI-powered similar artist recommendations based on your Last.fm history',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'lastfm', strategy: 'similar', limit: 20 },
    },
    {
      id: 'ai-lastfm-genre',
      name: 'AI Genre Expansion (Last.fm)',
      description: 'Discover related genres based on your Last.fm history',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'lastfm', strategy: 'genre_expansion', limit: 20 },
    },
    {
      id: 'ai-lastfm-discovery',
      name: 'AI Discovery (Last.fm)',
      description: 'Completely new discoveries based on your Last.fm history',
      type: 'ai_recommendation',
      category: 'ai',
      config: { source: 'lastfm', strategy: 'discovery', limit: 20 },
    },

    // TAUTULLI / PLEX
    {
      id: 'tautulli-similar-week',
      name: 'Plex Similar Artists (Last Week)',
      description: 'Artists similar to your Plex listening history from the past week',
      type: 'tautulli_similar',
      category: 'library',
      config: { period: 'week', seedLimit: 10, similarPerSeed: 5, limit: 25, minMatchCount: 1 },
    },
    {
      id: 'tautulli-similar-month',
      name: 'Plex Similar Artists (Last Month)',
      description: 'Artists similar to your Plex listening history from the past month',
      type: 'tautulli_similar',
      category: 'library',
      config: { period: 'month', seedLimit: 15, similarPerSeed: 5, limit: 50, minMatchCount: 1 },
    },
    {
      id: 'tautulli-similar-year',
      name: 'Plex Similar Artists (Last Year)',
      description: 'Artists similar to your Plex listening history from the past year',
      type: 'tautulli_similar',
      category: 'library',
      config: { period: 'year', seedLimit: 20, similarPerSeed: 5, limit: 75, minMatchCount: 2 },
    },
    {
      id: 'tautulli-similar-all',
      name: 'Plex Similar Artists (All Time)',
      description: 'Artists similar to your all-time Plex listening history',
      type: 'tautulli_similar',
      category: 'library',
      config: { period: 'all', seedLimit: 25, similarPerSeed: 5, limit: 100, minMatchCount: 2 },
    },

    // DEEZER
    {
      id: 'deezer-favorites',
      name: 'My Deezer Favorites',
      description: 'Artists from your favorite/loved tracks',
      type: 'deezer_favorites',
      category: 'deezer',
      config: { limit: 50 },
    },
    {
      id: 'deezer-history',
      name: 'My Deezer Listening History',
      description: 'Artists from your recent listening history',
      type: 'deezer_history',
      category: 'deezer',
      config: { limit: 50 },
    },
    {
      id: 'deezer-flow',
      name: 'My Deezer Flow',
      description: 'Artists from your personalized Flow recommendations',
      type: 'deezer_flow',
      category: 'deezer',
      config: { limit: 50 },
    },
    {
      id: 'deezer-playlists',
      name: 'My Deezer Playlists',
      description: 'Artists from all your Deezer playlists',
      type: 'deezer_playlists',
      category: 'deezer',
      config: { limit: 50 },
    },
    {
      id: 'deezer-charts',
      name: 'Deezer Top Charts',
      description: 'Top charting artists on Deezer',
      type: 'deezer_chart',
      category: 'deezer',
      config: { limit: 50 },
    },

    // TIDAL
    {
      id: 'tidal-favorites',
      name: 'My TIDAL Collection',
      description: 'Artists from your TIDAL collection/favorites',
      type: 'tidal_favorites',
      category: 'tidal',
      config: { limit: 50 },
    },
    {
      id: 'tidal-playlists',
      name: 'My TIDAL Playlists',
      description: 'Artists from all your TIDAL playlists',
      type: 'tidal_playlists',
      category: 'tidal',
      config: { limit: 50 },
    },
    {
      id: 'tidal-discovery',
      name: 'TIDAL Discovery Mix',
      description: 'Artists from your personalized Discovery Mix',
      type: 'tidal_discovery',
      category: 'tidal',
      config: { limit: 50 },
    },
    {
      id: 'tidal-new-arrivals',
      name: 'TIDAL New Arrivals',
      description: 'Artists from your New Arrivals recommendations',
      type: 'tidal_new_arrivals',
      category: 'tidal',
      config: { limit: 50 },
    },
    {
      id: 'tidal-mixes',
      name: 'My TIDAL Mixes',
      description: 'Artists from your personalized mixes',
      type: 'tidal_mix',
      category: 'tidal',
      config: { limit: 50 },
    },

    // LISTENBRAINZ
    {
      id: 'listenbrainz-top-all',
      name: 'My ListenBrainz Top Artists (All Time)',
      description: 'Your most-listened artists from ListenBrainz across all time',
      type: 'listenbrainz_top',
      category: 'listenbrainz',
      config: { period: 'all_time', limit: 100 },
    },
    {
      id: 'listenbrainz-top-year',
      name: 'My ListenBrainz Top Artists (Last Year)',
      description: 'Your most-listened artists from the past year',
      type: 'listenbrainz_top',
      category: 'listenbrainz',
      config: { period: 'year', limit: 50 },
    },
    {
      id: 'listenbrainz-top-month',
      name: 'My ListenBrainz Top Artists (Last Month)',
      description: 'Your most-listened artists from the past month',
      type: 'listenbrainz_top',
      category: 'listenbrainz',
      config: { period: 'month', limit: 50 },
    },
    {
      id: 'listenbrainz-recommendations-top',
      name: 'ListenBrainz Recommendations (Top Artist)',
      description: 'ML-powered recommendations based on your top artists',
      type: 'listenbrainz_recommendations',
      category: 'listenbrainz',
      config: { recommendationType: 'top_artist', limit: 25 },
    },
    {
      id: 'listenbrainz-recommendations-similar',
      name: 'ListenBrainz Recommendations (Similar Artist)',
      description: 'ML-powered recommendations based on similar artists',
      type: 'listenbrainz_recommendations',
      category: 'listenbrainz',
      config: { recommendationType: 'similar_artist', limit: 25 },
    },
    {
      id: 'listenbrainz-similar-users',
      name: "ListenBrainz Similar Users' Artists",
      description: 'Artists loved by users with similar taste to yours',
      type: 'listenbrainz_similar',
      category: 'listenbrainz',
      config: { limit: 50 },
    },
    {
      id: 'listenbrainz-explore-week',
      name: 'ListenBrainz Fresh Releases (This Week)',
      description: 'Popular new releases from the past week',
      type: 'listenbrainz_explore',
      category: 'listenbrainz',
      config: { limit: 50 },
    },
    {
      id: 'listenbrainz-year-current',
      name: 'ListenBrainz Year in Music',
      description: 'Your top artists from this year',
      type: 'listenbrainz_year',
      category: 'listenbrainz',
      config: { limit: 50 },
    },
    {
      id: 'listenbrainz-loved',
      name: 'ListenBrainz Loved Tracks Artists',
      description: 'Artists from your loved/favorited tracks',
      type: 'listenbrainz_loved',
      category: 'listenbrainz',
      config: { limit: 50 },
    },
    {
      id: 'listenbrainz-radio',
      name: 'ListenBrainz Artist Radio',
      description: 'Discover artists similar to a seed artist (configure seedMbid)',
      type: 'listenbrainz_radio',
      category: 'listenbrainz',
      config: { mode: 'medium', limit: 50, seedMbid: '' },
    },
    {
      id: 'listenbrainz-playlist',
      name: 'ListenBrainz Playlist Import',
      description: 'Artists from a ListenBrainz playlist (configure playlistId)',
      type: 'listenbrainz_playlist',
      category: 'listenbrainz',
      config: { limit: 50, playlistId: '' },
    },

    // DISCOGS
    {
      id: 'discogs-label-custom',
      name: 'Discogs Label (Custom)',
      description: 'Browse artists from any record label',
      type: 'discogs_label',
      category: 'discogs',
      config: { labelId: null, labelName: '', limit: 50 },
    },
    {
      id: 'discogs-style-jazz',
      name: 'Discogs Jazz Releases',
      description: 'Jazz releases from Discogs',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Jazz', limit: 50 },
    },
    {
      id: 'discogs-style-funk',
      name: 'Discogs Funk/Soul Releases',
      description: 'Funk and Soul releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Funk / Soul', limit: 50 },
    },
    {
      id: 'discogs-style-electronic',
      name: 'Discogs Electronic Releases',
      description: 'Electronic music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Electronic', limit: 50 },
    },
    {
      id: 'discogs-style-rock',
      name: 'Discogs Rock Releases',
      description: 'Rock releases from Discogs',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Rock', limit: 50 },
    },
    {
      id: 'discogs-style-hiphop',
      name: 'Discogs Hip Hop Releases',
      description: 'Hip Hop releases from Discogs',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Hip Hop', limit: 50 },
    },
    {
      id: 'discogs-style-classical',
      name: 'Discogs Classical Releases',
      description: 'Classical music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Classical', limit: 50 },
    },
    {
      id: 'discogs-style-pop',
      name: 'Discogs Pop Releases',
      description: 'Pop music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Pop', limit: 50 },
    },
    {
      id: 'discogs-style-reggae',
      name: 'Discogs Reggae Releases',
      description: 'Reggae music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Reggae', limit: 50 },
    },
    {
      id: 'discogs-style-blues',
      name: 'Discogs Blues Releases',
      description: 'Blues music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Blues', limit: 50 },
    },
    {
      id: 'discogs-style-latin',
      name: 'Discogs Latin Releases',
      description: 'Latin music releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Latin', limit: 50 },
    },
    {
      id: 'discogs-style-folk',
      name: 'Discogs Folk/World/Country Releases',
      description: 'Folk, World, and Country releases',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: 'Folk, World, & Country', limit: 50 },
    },
    {
      id: 'discogs-style-custom',
      name: 'Discogs Style (Custom)',
      description: 'Browse releases by any Discogs style/genre',
      type: 'discogs_style',
      category: 'discogs',
      config: { style: '', limit: 50 },
    },

    // BANDCAMP
    {
      id: 'bandcamp-electronic',
      name: 'Bandcamp Electronic',
      description: 'Popular electronic releases on Bandcamp',
      type: 'bandcamp_tag',
      category: 'bandcamp',
      config: { tag: 'electronic', sort: 'pop', limit: 50 },
    },
    {
      id: 'bandcamp-metal',
      name: 'Bandcamp Metal',
      description: 'Popular metal releases on Bandcamp',
      type: 'bandcamp_tag',
      category: 'bandcamp',
      config: { tag: 'metal', sort: 'pop', limit: 50 },
    },
    {
      id: 'bandcamp-hip-hop',
      name: 'Bandcamp Hip-Hop',
      description: 'Popular hip-hop releases on Bandcamp',
      type: 'bandcamp_tag',
      category: 'bandcamp',
      config: { tag: 'hip-hop', sort: 'pop', limit: 50 },
    },
    {
      id: 'bandcamp-ambient',
      name: 'Bandcamp Ambient',
      description: 'Popular ambient releases on Bandcamp',
      type: 'bandcamp_tag',
      category: 'bandcamp',
      config: { tag: 'ambient', sort: 'pop', limit: 50 },
    },
    {
      id: 'bandcamp-new-releases',
      name: 'Bandcamp New Releases',
      description: 'Latest releases across all genres',
      type: 'bandcamp_new',
      category: 'bandcamp',
      config: { limit: 50 },
    },
  ];

  res.json({ presets });
});
