import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { parseIntParam } from '../utils/params.js';
import { LidarrService, LidarrCache } from '../services/lidarr.js';
import { LastfmService } from '../services/lastfm.js';
import { fetchDeezerArtistImage, getDeezerChartArtists, getDeezerGenres, getDeezerGenreArtists } from '../services/deezer.js';
import { addLogEntry } from './logs.js';
import { notificationService } from '../services/notifications.js';

export const discoverRouter = Router();

discoverRouter.use(requireAuth);

// Simple in-memory cache for Lidarr library (per connection)
interface CachedLibrary {
  artists: Array<{ id: number; artistName: string; foreignArtistId: string; monitored: boolean }>;
  timestamp: number;
}
const libraryCache = new Map<string, CachedLibrary>();
const LIBRARY_CACHE_TTL = 60 * 1000; // 1 minute TTL

// Helper to get Last.fm service if configured
async function getLastfmService(userId: number): Promise<LastfmService | null> {
  const connection = await prisma.connection.findFirst({
    where: { userId, type: 'lastfm', isActive: true },
  });
  if (!connection) return null;
  const config = connection.config as { apiKey: string };
  return new LastfmService(config);
}

// Helper to get Lidarr service (user-owned or global)
async function getLidarrService(userId: number): Promise<LidarrService | null> {
  // First try user's own connection, then fall back to global
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'lidarr', isActive: true },
        { userId: null, type: 'lidarr', isActive: true }, // Global Lidarr
      ],
    },
    orderBy: { userId: 'desc' }, // Prefer user's own connection (non-null userId first)
  });
  if (!connection) return null;
  const config = connection.config as { url: string; apiKey: string };
  return new LidarrService(config);
}

/**
 * GET /api/discover/library
 * Get paginated Lidarr library for selection
 */
discoverRouter.get('/library', async (req, res) => {
  try {
    const { page = '1', limit = '500', search, refresh } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.max(1, parseInt(limit as string, 10) || 500);
    
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
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
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get library' 
    });
  }
});

/**
 * POST /api/discover/similar
 * Get similar artists based on selected artists
 */
discoverRouter.post('/similar', async (req, res) => {
  try {
    const { artistNames, limit = 100 } = req.body;
    
    if (!artistNames || !Array.isArray(artistNames) || artistNames.length === 0) {
      res.status(400).json({ error: 'At least one artist name required' });
      return;
    }

    const lastfm = await getLastfmService(req.user!.id);
    if (!lastfm) {
      res.status(400).json({ error: 'No active Last.fm connection required for recommendations' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
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
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get recommendations' 
    });
  }
});

/**
 * POST /api/discover/add
 * Add a recommended artist to Lidarr
 */
discoverRouter.post('/add', async (req, res) => {
  try {
    const { artistName, mbid, qualityProfileId, metadataProfileId, rootFolderPath } = req.body;
    
    if (!artistName) {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    let foreignArtistId: string | undefined;

    // Try MBID first if available - this is more reliable with Lidarr
    if (mbid) {
      const mbidResults = await lidarr.searchArtist(mbid);
      const mbidMatch = mbidResults.find(a => a.foreignArtistId === mbid);
      if (mbidMatch) {
        foreignArtistId = mbidMatch.foreignArtistId;
      }
    }

    // Fall back to name search if MBID not available or didn't match
    if (!foreignArtistId) {
      const nameResults = await lidarr.searchArtist(artistName);
      if (nameResults.length > 0) {
        foreignArtistId = nameResults[0].foreignArtistId;
      }
    }

    if (!foreignArtistId) {
      res.status(404).json({ error: 'Artist not found in Lidarr search' });
      return;
    }

    // Check if already in library
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    if (await cache.exists({ mbid: foreignArtistId })) {
      res.status(409).json({ error: 'Artist already in library' });
      return;
    }

    // Add to Lidarr with metadata refresh to ensure complete MusicBrainz data
    const { artist: result, refreshCommand } = await lidarr.addArtistWithRefresh(
      foreignArtistId,
      qualityProfileId,
      metadataProfileId,
      rootFolderPath
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
    const errorMessage = error instanceof Error ? error.message : 'Failed to add artist';
    console.error('Discover add error:', errorMessage, error);
    
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
 */
discoverRouter.get('/profiles', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const [qualityProfiles, metadataProfiles, rootFolders] = await Promise.all([
      lidarr.getQualityProfiles(),
      lidarr.getMetadataProfiles(),
      lidarr.getRootFolders(),
    ]);

    res.json({
      qualityProfiles,
      metadataProfiles,
      rootFolders,
    });
  } catch (error) {
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
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Deezer genres' 
    });
  }
});

/**
 * Get Deezer chart artists
 */
discoverRouter.get('/deezer/chart', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
    const artists = await getDeezerChartArtists(limit);
    res.json(artists);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get Deezer chart' 
    });
  }
});

/**
 * Get Deezer artists by genre
 */
discoverRouter.get('/deezer/genre/:genreId/artists', async (req, res) => {
  try {
    const genreId = parseIntParam(req.params.genreId);
    if (genreId === null) {
      return res.status(400).json({ error: 'Invalid genre ID' });
    }
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 100);
    const artists = await getDeezerGenreArtists(genreId, limit);
    res.json(artists);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get genre artists' 
    });
  }
});
