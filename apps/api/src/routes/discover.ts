import { effectiveAddOptions } from '../lib/add-options.js';
import { DecisionError } from '../lib/decision.js';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { parseIntParam } from '../utils/params.js';
import {
  discoverLibraryQuerySchema,
  discoverSimilarSchema,
  addArtistSchema,
  deezerLimitQuerySchema,
  deezerGenreParamsSchema,
} from '../schemas/discover.js';
import { LidarrCache } from '../services/lidarr.js';
import { fetchDeezerArtistImage, getDeezerChartArtists, getDeezerGenres, getDeezerGenreArtists } from '../services/deezer.js';
import { addLogEntry } from './logs.js';
import { notificationService } from '../services/notifications.js';
import { createLogger } from '../lib/logger.js';
import { 
  getLidarrService, 
  getLidarrServiceWithConfig, 
  getLastfmService 
} from '../lib/connection-resolver.js';

const logger = createLogger('DiscoverRoute');

export const discoverRouter = Router();

discoverRouter.use(requireAuth);

// Simple in-memory cache for Lidarr library (per connection)
interface CachedLibrary {
  artists: Array<{ id: number; artistName: string; foreignArtistId: string; monitored: boolean }>;
  timestamp: number;
}
const libraryCache = new Map<string, CachedLibrary>();
const LIBRARY_CACHE_TTL = 60 * 1000; // 1 minute TTL

/**
 * GET /api/discover/library
 * Get paginated Lidarr library for selection
 */
discoverRouter.get('/library', validateQuery(discoverLibraryQuerySchema), async (req, res) => {
  try {
    const { page = '1', limit = '500', search, refresh } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 500);
    
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ 
        error: 'Discover requires a Lidarr connection',
        code: 'LIDARR_REQUIRED',
        message: 'Connect Lidarr to browse and discover from your library'
      });
      return;
    }

    // Use cache key based on user ID
    const cacheKey = `user-${req.user!.id}`;
    const now = Date.now();
    type ArtistType = { id: number; artistName: string; foreignArtistId: string; monitored: boolean };
    let allArtists: ArtistType[];

    // Check cache (unless refresh requested)
    const cached = libraryCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < LIBRARY_CACHE_TTL && refresh !== 'true') {
      allArtists = cached.artists;
    } else {
      // Fetch from Lidarr and cache
      allArtists = await lidarr.getArtists();
      // Sort once and cache
      allArtists.sort((a, b) => a.artistName.localeCompare(b.artistName));
      libraryCache.set(cacheKey, { artists: allArtists, timestamp: now });
    }

    // Work with a copy for filtering
    let artists: ArtistType[] = allArtists;
    
    // Filter by search term
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      artists = artists.filter(a => 
        a.artistName.toLowerCase().includes(searchLower)
      );
    }

    // Paginate
    const total = artists.length;
    const totalPages = Math.ceil(total / limitNum);
    const offset = (pageNum - 1) * limitNum;
    const paginatedArtists = artists.slice(offset, offset + limitNum);

    res.json({
      artists: paginatedArtists.map(a => ({
        id: a.id,
        name: a.artistName,
        foreignArtistId: a.foreignArtistId,
        monitored: a.monitored,
      })),
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
      },
    });
  } catch (error) {    logger.error('Failed to get library', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id },
    });    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get library' 
    });
  }
});

/**
 * POST /api/discover/similar
 * Get similar artists based on selected artists
 */
discoverRouter.post('/similar', validateBody(discoverSimilarSchema), async (req, res) => {
  try {
    const { artistNames, limit = 100 } = req.body;

    const lastfm = await getLastfmService(req.user!.id);
    if (!lastfm) {
      res.status(400).json({ error: 'No active Last.fm connection required for recommendations' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ 
        error: 'Discover requires a Lidarr connection',
        code: 'LIDARR_REQUIRED',
        message: 'Connect Lidarr to browse and discover from your library'
      });
      return;
    }

    // Get Lidarr library for filtering
    const cache = new LidarrCache(lidarr);
    await cache.refresh();

    // Collect similar artists from each selected artist
    const similarMap = new Map<string, {
      name: string;
      mbid?: string;
      url?: string;
      match: number;    // Highest similarity score
      matchCount: number; // How many selected artists this is similar to
      sources: string[];  // Which artists it came from
    }>();

    // Use all seed artists for better results
    const seedArtists = artistNames;

    for (const artistName of seedArtists) {
      try {
        // Use getSimilarArtists which returns up to 100 similar artists per seed
        const similarArtists = await lastfm.getSimilarArtists(artistName, 100);
        for (const similar of similarArtists) {
          const key = similar.name.toLowerCase();
          const existing = similarMap.get(key);
          if (existing) {
            existing.matchCount++;
            existing.sources.push(artistName);
            // Keep the highest match score
            if (similar.match > existing.match) {
              existing.match = similar.match;
            }
          } else {
            similarMap.set(key, {
              name: similar.name,
              mbid: similar.mbid || undefined,
              url: similar.url,
              match: similar.match,
              matchCount: 1,
              sources: [artistName],
            });
          }
        }
      } catch {
        // Skip artists that fail
      }
    }

    // Convert to array and sort by match count (primary) and similarity score (secondary)
    let recommendations = Array.from(similarMap.values())
      .sort((a, b) => {
        // First by match count (more seed artist matches = better)
        if (b.matchCount !== a.matchCount) {
          return b.matchCount - a.matchCount;
        }
        // Then by similarity score
        return b.match - a.match;
      });

    // Filter out artists already in Lidarr
    const filteredRecs: typeof recommendations = [];
    for (const r of recommendations) {
      if (!(await cache.exists({ name: r.name }))) {
        filteredRecs.push(r);
      }
    }
    recommendations = filteredRecs;

    // Limit results
    recommendations = recommendations.slice(0, limit);

    // Fetch images from Deezer API (in parallel, with fallback)
    const recsWithImages = await Promise.all(
      recommendations.map(async (r) => {
        const imageUrl = await fetchDeezerArtistImage(r.name);
        return {
          name: r.name,
          mbid: r.mbid,
          url: r.url,
          matchCount: r.matchCount,
          matchScore: Math.round(r.match * 100),
          matchedFrom: r.sources,
          inLibrary: false,
          imageUrl,
        };
      })
    );

    res.json({
      recommendations: recsWithImages,
      seedArtists,
      total: recsWithImages.length,
    });
  } catch (error) {
    logger.error('Failed to get recommendations', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id },
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get recommendations' 
    });
  }
});

/**
 * POST /api/discover/add
 * Add a recommended artist to Lidarr
 */
discoverRouter.post('/add', validateBody(addArtistSchema), async (req, res) => {
  try {
    const { artistName, mbid } = req.body;

    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    if (!lidarrResult) {
      res.status(400).json({ 
        error: 'Discover requires a Lidarr connection',
        code: 'LIDARR_REQUIRED',
        message: 'Connect Lidarr to browse and discover from your library'
      });
      return;
    }
    const { service: lidarr, config: lidarrConfig } = lidarrResult;

    if (!mbid) {
      res.status(422).json({ error: 'Choose a MusicBrainz artist before adding', code: 'IDENTITY_REQUIRED' });
      return;
    }
    const foreignArtistId = mbid;

    // Check if already in library
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    if (await cache.exists({ mbid: foreignArtistId })) {
      res.status(409).json({ error: 'Artist already in library' });
      return;
    }

    const options = await effectiveAddOptions(lidarr, lidarrConfig, req.body);
    const { qualityProfileId: qpId, metadataProfileId: mpId, rootFolderPath: rfPath } = options;

    // Add to Lidarr with SkyHook cache warming for reliable metadata lookup
    // Use monitorOption from connection config (defaults to 'all' if not set)
    const { artist: result, refreshCommand } = await lidarr.addArtistWithCacheWarm(
      foreignArtistId,
      qpId,
      mpId,
      rfPath,
      true,  // monitored
      options.searchOnAdd,  // searchForMissingAlbums from config
      false, // waitForRefresh (deprecated)
      options.monitorOption,
      options.monitorNewItems
    );

    // Log the addition
    await addLogEntry('info', 'discover', `Added artist "${artistName}" from discover`, {
      artistName,
      mbid: foreignArtistId,
      refreshTriggered: !!refreshCommand,
    });

    // Send notification
    await notificationService.send(req.user!.id, 'artist.added', {
      artistName,
    });

    res.json({ success: true, artist: result, refreshTriggered: !!refreshCommand });
  } catch (error) {
    if (error instanceof DecisionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    const errorMessage = error instanceof Error ? error.message : 'Failed to add artist';
    logger.error('Discover add error', { errorMessage, error });
    
    // Log the error
    await addLogEntry('error', 'discover', `Failed to add artist "${req.body.artistName}"`, {
      artistName: req.body.artistName,
      error: errorMessage,
    }).catch(() => {}); // Don't fail if logging fails
    
    // Check if it's an "already exists" error from Lidarr
    if (errorMessage.includes('already') || errorMessage.includes('409') || errorMessage.includes('400')) {
      res.status(409).json({ error: 'Artist may already exist in library' });
      return;
    }
    
    res.status(500).json({ error: errorMessage });
  }
});

/**
 * GET /api/discover/profiles
 * Get Lidarr quality and metadata profiles for the add form
 * Includes connection's default selections
 */
discoverRouter.get('/profiles', async (req, res) => {
  try {
    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    if (!lidarrResult) {
      res.status(400).json({ 
        error: 'Discover requires a Lidarr connection',
        code: 'LIDARR_REQUIRED',
        message: 'Connect Lidarr to browse and discover from your library'
      });
      return;
    }

    const { service: lidarr, config: lidarrConfig } = lidarrResult;

    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      lidarr.getQualityProfiles(),
      lidarr.getMetadataProfiles(),
      lidarr.getRootFolders(),
    ]);

    // Include connection's default selections so frontend can initialize correctly
    res.json({
      qualityProfiles,
      metadataProfiles,
      rootFolders,
      defaults: {
        qualityProfileId: lidarrConfig.qualityProfileId,
        metadataProfileId: lidarrConfig.metadataProfileId,
        rootFolderPath: lidarrConfig.rootFolderPath,
        monitorOption: lidarrConfig.monitorOption,
        monitorNewItems: lidarrConfig.monitorNewItems,
        searchOnAdd: lidarrConfig.searchOnAdd,
      },
    });
  } catch (error) {
    logger.error('Failed to get profiles', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id },
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get profiles' 
    });
  }
});

// DEEZER PUBLIC API ENDPOINTS (no OAuth required)

/**
 * Get Deezer genres list
 */
discoverRouter.get('/deezer/genres', async (_req, res) => {
  try {
    const genres = await getDeezerGenres();
    res.json(genres);
  } catch (error) {
    logger.error('Failed to get Deezer genres', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Deezer genres' 
    });
  }
});

/**
 * Get Deezer chart artists
 */
discoverRouter.get('/deezer/chart', validateQuery(deezerLimitQuerySchema), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
    const artists = await getDeezerChartArtists(limit);
    res.json(artists);
  } catch (error) {
    logger.error('Failed to get Deezer chart', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Deezer chart' 
    });
  }
});

/**
 * Get Deezer artists by genre
 */
discoverRouter.get('/deezer/genre/:genreId/artists', validateParams(deezerGenreParamsSchema), validateQuery(deezerLimitQuerySchema), async (req, res) => {
  try {
    const genreId = parseIntParam(req.params.genreId);
    if (genreId === null) {
      return res.status(400).json({ error: 'Invalid genre ID' });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
    const artists = await getDeezerGenreArtists(genreId, limit);
    res.json(artists);
  } catch (error) {
    logger.error('Failed to get genre artists', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { genreId: req.params.genreId },
    });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get genre artists' 
    });
  }
});
