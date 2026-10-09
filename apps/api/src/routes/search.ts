import { addOptionsSchema, effectiveAddOptions } from '../lib/add-options.js';
import { DecisionError } from '../lib/decision.js';
import { validateBody } from '../middleware/validate.js';
import { Router } from 'express';
import { z } from 'zod';
import type { LabelArtistPage } from '@mixarr/shared-types';
import { ArtistDetailInputError, ArtistDetailService } from '../services/artist-detail.js';
import { readBeforeDeadline } from '../lib/acquisition-deadline.js';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { parseIntParam } from '../utils/params.js';
import { LidarrCache, getSharedLidarrCache } from '../services/lidarr.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { LastfmService } from '../services/lastfm.js';
import { getArtistImages } from '../services/artist-images.js';
import { multiSourceSearch, resolveMbid, SearchSource } from '../services/multi-search.js';
import { MetadataEnrichmentService } from '../services/metadata-enrichment.js';
import { notificationService } from '../services/notifications.js';
import { aiService } from '../services/ai.js';
import { MetadataFixService } from '../services/metadata-fix.js';
import { skyhookWarmer } from '../services/skyhook-cache-warmer.js';
import { addLogEntry } from './logs.js';
import { createLogger } from '../lib/logger.js';
import { 
  getLidarrService, 
  getLidarrServiceWithConfig, 
  getLastfmService 
} from '../lib/connection-resolver.js';

const log = createLogger('Search');

// Singleton for metadata fix operations
const metadataFixService = new MetadataFixService(skyhookWarmer);

export const searchRouter = Router();

searchRouter.use(requireAuth);

// Search for artists
searchRouter.get('/artists', async (req, res) => {
  try {
    const { q, enrich } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }

    // Fetch once with config so we can key the shared cache without a second DB hit
    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    const lidarr = lidarrResult?.service ?? null;
    
    // If Lidarr is available, use it for search with inLibrary status
    if (lidarr && lidarrResult) {
      const results = await lidarr.searchArtist(q);
      
      // Check which artists are already in library (shared cache, no extra DB round-trip)
      const cache = getSharedLidarrCache(lidarrResult.config.url, lidarrResult.service);
      // No explicit refresh needed - exists() populates lazily on first use
      
      // Get Deezer images for all artists
      const artistNames = results.map(r => r.artistName);
      const imageMap = await getArtistImages(artistNames);
      
      const enrichedResults = await Promise.all(
        results.map(async (artist) => ({
          ...artist,
          inLibrary: await cache.exists({ mbid: artist.foreignArtistId }),
          imageUrl: imageMap.get(artist.artistName),
        }))
      );

      // Optionally enrich with Last.fm stats
      let finalResults: typeof enrichedResults & { lastfm?: { listeners: number; playcount: number; tags: string[] } }[] = enrichedResults;
      if (enrich === 'true') {
        const lastfm = await getLastfmService(req.user!.id);
        if (lastfm) {
          finalResults = await Promise.all(
            enrichedResults.map(async (artist) => {
              const stats = await lastfm.getArtistStats(artist.artistName);
              return { ...artist, lastfm: stats || undefined };
            })
          );
        }
      }

      res.json({ results: finalResults });
      return;
    }

    // No Lidarr - fall back to MusicBrainz search (no inLibrary field)
    const mb = new MusicBrainzService();
    const mbResults = await mb.searchArtist(q);
    
    // Get Deezer images for all artists
    const artistNames = mbResults.map(r => r.name);
    const imageMap = await getArtistImages(artistNames);
    
    // Transform MusicBrainz results to match expected format (without inLibrary)
    const results = mbResults.map(artist => ({
      foreignArtistId: artist.id,
      artistName: artist.name,
      overview: artist.disambiguation || undefined,
      imageUrl: imageMap.get(artist.name),
    }));

    // Optionally enrich with Last.fm stats
    let finalResults: typeof results & { lastfm?: { listeners: number; playcount: number; tags: string[] } }[] = results;
    if (enrich === 'true') {
      const lastfm = await getLastfmService(req.user!.id);
      if (lastfm) {
        finalResults = await Promise.all(
          results.map(async (artist) => {
            const stats = await lastfm.getArtistStats(artist.artistName);
            return { ...artist, lastfm: stats || undefined };
          })
        );
      }
    }

    res.json({ results: finalResults });
  } catch (error) {
    log.error('Search /artists error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    res.status(500).json({ error: message });
  }
});

// Multi-source artist discovery search
searchRouter.get('/discover', async (req, res) => {
  try {
    const { q, sources } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }
    
    // Parse enabled sources (default to all)
    const validSources: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];
    let enabledSources: SearchSource[];
    
    if (sources && typeof sources === 'string') {
      enabledSources = sources.split(',').filter(s => 
        validSources.includes(s as SearchSource)
      ) as SearchSource[];
      
      if (enabledSources.length === 0) {
        enabledSources = validSources;
      }
    } else {
      enabledSources = validSources;
    }
    
    // Search across enabled sources
    const sourceErrors: { source: SearchSource; message: string }[] = [];
    const results = await multiSourceSearch(q, req.user!.id, enabledSources, 25, sourceErrors);
    
    // Skip MBID lookup during search - too slow with rate limits
    // MBID resolution happens when user clicks "Add" via /resolve-mbid endpoint
    
    res.json({ 
      results,
      sources: enabledSources,
      errors: sourceErrors.map(error => error.message),
    });
  } catch (error) {
    log.error('Multi-source search error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    res.status(500).json({ error: message });
  }
});

// Check if AI search is available
searchRouter.get('/ai/status', async (_req, res) => {
  try {
    const available = await aiService.isAvailable();
    res.json({ available });
  } catch (error) {
    res.json({ available: false });
  }
});

// AI-powered natural language search
searchRouter.post('/ai', async (req, res) => {
  try {
    const { prompt, limit: rawLimit } = req.body;
    const limit = Math.min(Math.max(Number(rawLimit) || 20, 1), 100);

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      res.status(400).json({ error: 'Search prompt is required' });
      return;
    }

    // Check if AI is available
    const aiAvailable = await aiService.isAvailable();
    if (!aiAvailable) {
      res.status(400).json({ 
        error: 'AI Search requires OpenAI or Anthropic API keys. Configure in Settings → AI.',
        configured: false,
      });
      return;
    }

    // Get Lidarr service for enrichment (optional - can use MusicBrainz if not available)
    const lidarr = await getLidarrService(req.user!.id);

    // Get AI recommendations (limit to 10 to keep response time reasonable)
    const truncated = prompt.length > 50 ? `${prompt.substring(0, 50)}...` : prompt;
    log.debug(`Processing prompt: "${truncated}"`);
    const effectiveLimit = Math.min(limit, 10); // Cap at 10 to avoid timeouts
    const { artists: artistNames, providers, errors: aiErrors } = await aiService.searchByPrompt(prompt.trim(), effectiveLimit);
    const searchErrors = (aiErrors || []).map(error => `${error.startsWith('OpenAI:') ? 'OpenAI' : error.startsWith('Anthropic:') ? 'Anthropic' : 'AI provider'} search unavailable. Retry the search.`);

    if (artistNames.length === 0) {
      // If we have errors but no results, indicate the failure
      const hasProviderErrors = aiErrors && aiErrors.length > 0;
      const message = hasProviderErrors
        ? `AI providers encountered errors: ${searchErrors.join('; ')}`
        : 'No recommendations found. Try rephrasing your query.';
      
      res.json({
        prompt: prompt.trim(),
        results: [],
        aiProviders: providers,
        message,
        errors: searchErrors,
      });
      return;
    }

    // Resolve each artist name to MBID via Lidarr or MusicBrainz
    let cache: LidarrCache | null = null;
    if (lidarr) {
      const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
      cache = lidarrResult
        ? getSharedLidarrCache(lidarrResult.config.url, lidarrResult.service)
        : new LidarrCache(lidarr);
      // exists() refreshes lazily on first use; no explicit refresh needed
    }

    // Use MusicBrainz as fallback when no Lidarr
    const mb = lidarr ? null : new MusicBrainzService();

    // Resolve artists with limited parallelism (5 at a time to stay within timeout)
    const BATCH_SIZE = 5;
    const enrichedResults: ({
      foreignArtistId: string;
      artistName: string;
      overview: string | undefined;
      imageUrl: null;
      inLibrary?: boolean;
    } | null)[] = [];

    for (let i = 0; i < artistNames.length; i += BATCH_SIZE) {
      const batch = artistNames.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            if (lidarr) {
              // Use Lidarr for search and library check
              const searchResults = await lidarr.searchArtist(name);
              if (searchResults.length === 0) {
                log.debug(`No Lidarr results for: ${name}`);
                return null;
              }

              const artist = searchResults[0];
              const inLibrary = cache ? await cache.exists({ mbid: artist.foreignArtistId }) : false;

              return {
                foreignArtistId: artist.foreignArtistId,
                artistName: artist.artistName,
                overview: artist.overview,
                imageUrl: null as null, // Will be enriched below
                inLibrary,
              };
            } else {
              // Use MusicBrainz for search (no library check available)
              const mbResults = await mb!.searchArtist(name, 1);
              if (mbResults.length === 0) {
                log.debug(`No MusicBrainz results for: ${name}`);
                return null;
              }

              const artist = mbResults[0];
              return {
                foreignArtistId: artist.id,
                artistName: artist.name,
                overview: artist.disambiguation || undefined,
                imageUrl: null as null, // Will be enriched below
                // inLibrary omitted when no Lidarr
              };
            }
          } catch (error) {
            log.error(`Error resolving artist "${name}":`, error instanceof Error ? error.message : error);
            return null;
          }
        })
      );
      enrichedResults.push(...batchResults);
    }

    // Filter out nulls (artists that couldn't be resolved)
    const validResults = enrichedResults.filter((r): r is NonNullable<typeof r> => r !== null);

    // Fetch images from Deezer
    const artistNamesForImages = validResults.map(r => r.artistName);
    const imageMap = await getArtistImages(artistNamesForImages);

    // Add images to results
    const finalResults = validResults.map(r => ({
      ...r,
      imageUrl: imageMap.get(r.artistName) || null,
    }));

    log.debug(`Returning ${finalResults.length} results from ${providers.join(', ')}`);

    res.json({
      prompt: prompt.trim(),
      results: finalResults,
      aiProviders: providers,
      errors: searchErrors,
    });
  } catch (error) {
    log.error('Error:', error);
    const message = error instanceof Error ? error.message : 'AI search failed';
    res.status(500).json({ error: message });
  }
});

// Resolve MBID for an artist (with fallback to manual selection)
searchRouter.post('/resolve-mbid', async (req, res) => {
  try {
    const { artistName } = req.body;
    
    if (!artistName || typeof artistName !== 'string') {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }
    
    const result = await resolveMbid(artistName);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MBID resolution failed';
    res.status(500).json({ error: message });
  }
});

// Add artist from discovery search (with MBID resolution)
searchRouter.post('/discover/add', validateBody(addOptionsSchema.extend({ artistName: z.string().min(1).max(500), mbid: z.string().uuid().transform(value => value.toLowerCase()).optional() })), async (req, res) => {
  try {
    const { artistName, mbid } = req.body;
    
    if (!artistName) {
      res.status(400).json({ error: 'Artist name required' });
      return;
    }
    
    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    if (!lidarrResult) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    const { service: lidarr, config: lidarrConfig } = lidarrResult;
    
    const resolvedMbid = mbid;
    if (!resolvedMbid) {
      const resolution = await resolveMbid(artistName);
      res.status(422).json({ error: 'Choose a MusicBrainz artist before adding', code: 'IDENTITY_REQUIRED',
        details: { candidates: resolution.candidates || [], artistName }, candidates: resolution.candidates || [], artistName });
      return;
    }

    const options = await effectiveAddOptions(lidarr, lidarrConfig, req.body);
    const { qualityProfileId: qpId, metadataProfileId: mpId, rootFolderPath: rfPath } = options;

    // Use addArtistWithCacheWarm to warm SkyHook cache for reliable metadata lookup
    // Use monitorOption from connection config (defaults to 'all' if not set)
    const { artist, refreshCommand } = await lidarr.addArtistWithCacheWarm(
      resolvedMbid, qpId, mpId, rfPath,
      true,  // monitored
      options.searchOnAdd,  // searchForMissingAlbums from config
      false, // waitForRefresh (deprecated)
      options.monitorOption,
      options.monitorNewItems
    );
    
    // Log the successful artist addition
    await addLogEntry('info', 'search', `Added artist "${artistName}" from search`, {
      artistName,
      mbid: resolvedMbid,
      source: 'discover-search',
      userId: req.user!.id,
      username: req.user!.username,
      status: 'success',
    });
    
    res.json({ success: true, artist, mbid: resolvedMbid, refreshTriggered: !!refreshCommand });
  } catch (error) {
    if (error instanceof DecisionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    // Log the failed artist addition
    await addLogEntry('error', 'search', `Failed to add artist "${req.body.artistName}" from search`, {
      artistName: req.body.artistName,
      mbid: req.body.mbid,
      source: 'discover-search',
      userId: req.user!.id,
      username: req.user!.username,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to add artist' 
    });
  }
});

// Add artist to Lidarr
searchRouter.post('/artists/add', validateBody(addOptionsSchema.extend({ foreignArtistId: z.string().uuid().transform(value => value.toLowerCase()) })), async (req, res) => {
  try {
    const { foreignArtistId } = req.body;
    
    if (!foreignArtistId) {
      res.status(400).json({ error: 'Artist ID required' });
      return;
    }

    // Use global connection if user doesn't have their own
    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    if (!lidarrResult) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    const { service: lidarr, config: lidarrConfig } = lidarrResult;
    
    const options = await effectiveAddOptions(lidarr, lidarrConfig, req.body);
    const { qualityProfileId: qpId, metadataProfileId: mpId, rootFolderPath: rfPath } = options;

    // Use addArtistWithCacheWarm to warm SkyHook cache for reliable metadata lookup
    // Use monitorOption from connection config (defaults to 'all' if not set)
    const { artist, refreshCommand } = await lidarr.addArtistWithCacheWarm(
      foreignArtistId, qpId, mpId, rfPath,
      true,  // monitored
      options.searchOnAdd,  // searchForMissingAlbums from config
      false, // waitForRefresh (deprecated)
      options.monitorOption,
      options.monitorNewItems
    );
    
    // Log the successful artist addition
    const artistName = artist.artistName || 'Unknown Artist';
    await addLogEntry('info', 'search', `Added artist "${artistName}" from search`, {
      artistName,
      mbid: foreignArtistId,
      source: 'search',
      userId: req.user!.id,
      username: req.user!.username,
      status: 'success',
    });
    
    // Send notification
    await notificationService.send(req.user!.id, 'artist.added', {
      artistName,
    });
    
    res.json({ success: true, artist, refreshTriggered: !!refreshCommand });
  } catch (error) {
    if (error instanceof DecisionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    // Log the failed artist addition
    await addLogEntry('error', 'search', `Failed to add artist from search`, {
      mbid: req.body.foreignArtistId,
      source: 'search',
      userId: req.user!.id,
      username: req.user!.username,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to add artist' 
    });
  }
});

// Get Lidarr configuration options
searchRouter.get('/lidarr/config', async (req, res) => {
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

    res.json({ qualityProfiles, metadataProfiles, rootFolders });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get config' 
    });
  }
});

// Helper to check what metadata is missing for an artist
function getMetadataIssues(artist: {
  statistics?: { albumCount?: number };
  images?: Array<{ coverType: string; url?: string }>;
  overview?: string;
  genres?: string[];
}): string[] {
  const issues: string[] = [];
  
  if ((artist.statistics?.albumCount || 0) === 0) {
    issues.push('no_albums');
  }
  
  // Check for missing images (poster is the main thumbnail)
  const hasPoster = artist.images?.some(img => 
    img.coverType?.toLowerCase() === 'poster' && img.url
  );
  if (!hasPoster) {
    issues.push('no_poster');
  }
  
  // Check for missing overview/bio
  if (!artist.overview || artist.overview.trim().length === 0) {
    issues.push('no_overview');
  }
  
  // Check for missing genres
  if (!artist.genres || artist.genres.length === 0) {
    issues.push('no_genres');
  }
  
  return issues;
}

// Calculate overall library health score (0-100%)
function calculateHealthScore(artists: Array<{
  hasOverview: boolean;
  hasPoster: boolean;
  hasGenres: boolean;
  albumCount: number;
}>): number {
  if (artists.length === 0) return 100;
  
  // Weights for different metadata types
  const weights = { overview: 0.3, poster: 0.25, genres: 0.25, albums: 0.2 };
  
  const overviewScore = artists.filter(a => a.hasOverview).length / artists.length;
  const posterScore = artists.filter(a => a.hasPoster).length / artists.length;
  const genresScore = artists.filter(a => a.hasGenres).length / artists.length;
  const albumsScore = artists.filter(a => a.albumCount > 0).length / artists.length;
  
  return Math.round(
    (overviewScore * weights.overview +
     posterScore * weights.poster +
     genresScore * weights.genres +
     albumsScore * weights.albums) * 100
  );
}

// Get all artists from Lidarr with album statistics and metadata status
searchRouter.get('/lidarr/artists', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artists = await lidarr.getArtists();
    
    // Map to a format with relevant stats and metadata issues
    const artistsWithStats = artists.map(artist => {
      const issues = getMetadataIssues(artist);
      return {
        id: artist.id,
        name: artist.artistName,
        foreignArtistId: artist.foreignArtistId,
        path: artist.path,
        monitored: artist.monitored,
        albumCount: artist.statistics?.albumCount || 0,
        trackCount: artist.statistics?.trackCount || 0,
        trackFileCount: artist.statistics?.trackFileCount || 0,
        sizeOnDisk: artist.statistics?.sizeOnDisk || 0,
        // Metadata status
        hasOverview: !!artist.overview?.trim(),
        hasPoster: artist.images?.some(img => img.coverType?.toLowerCase() === 'poster' && img.url) || false,
        hasGenres: (artist.genres?.length || 0) > 0,
        // Issues list
        issues,
        needsRefresh: issues.length > 0,
      };
    });

    // Sort by number of issues (most issues first), then by name
    artistsWithStats.sort((a, b) => {
      if (a.issues.length !== b.issues.length) {
        return b.issues.length - a.issues.length;
      }
      return a.name.localeCompare(b.name);
    });

    // Calculate summary stats
    const issueStats = {
      noAlbums: artistsWithStats.filter(a => a.issues.includes('no_albums')).length,
      noPoster: artistsWithStats.filter(a => a.issues.includes('no_poster')).length,
      noOverview: artistsWithStats.filter(a => a.issues.includes('no_overview')).length,
      noGenres: artistsWithStats.filter(a => a.issues.includes('no_genres')).length,
    };

    // Calculate overall health score (0-100%)
    const healthScore = calculateHealthScore(artistsWithStats);

    res.json({ 
      artists: artistsWithStats,
      total: artistsWithStats.length,
      needingRefresh: artistsWithStats.filter(a => a.needsRefresh).length,
      issueStats,
      healthScore,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get artists' 
    });
  }
});

// Refresh a specific artist's metadata
searchRouter.post('/lidarr/artists/:id/refresh', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artistId = parseIntParam(req.params.id);
    if (artistId === null) {
      res.status(400).json({ error: 'Invalid artist ID' });
      return;
    }

    const command = await lidarr.refreshArtist(artistId);
    
    res.json({ 
      success: true, 
      message: `Refresh triggered for artist ${artistId}`,
      commandId: command.id,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to refresh artist' 
    });
  }
});

// =====================================================
// BATCH FIX ENDPOINTS
// These static routes MUST be placed BEFORE the /:id routes
// to avoid Express matching "fix-all" as an artist ID
// =====================================================

// Start batch fix job for all artists with metadata issues
searchRouter.post('/lidarr/artists/fix-all', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    // Get optional issue type filter from request body
    const { issueType } = req.body as { issueType?: 'no_poster' | 'no_overview' | 'no_genres' | 'any' };

    // Get all artists from Lidarr
    const artists = await lidarr.getArtists();

    // Filter to artists with metadata issues
    const artistsWithIssues = artists.filter(artist => {
      // Must have foreignArtistId (MBID) to be fixable
      if (!artist.foreignArtistId) return false;

      const issues = getMetadataIssues(artist);
      if (issues.length === 0) return false;

      // If specific issue type requested, filter by it
      if (issueType && issueType !== 'any') {
        return issues.includes(issueType);
      }

      // Filter to only metadata issues (not structural issues like no_albums)
      const metadataIssues = issues.filter(i => 
        i === 'no_poster' || i === 'no_overview' || i === 'no_genres'
      );
      return metadataIssues.length > 0;
    });

    // If no artists need fixing, return early
    if (artistsWithIssues.length === 0) {
      res.json({
        jobId: null,
        total: 0,
        estimatedMinutes: 0,
        message: 'No artists need fixing',
      });
      return;
    }

    // Prepare artists for batch fix
    const artistsToFix = artistsWithIssues.map(a => ({
      id: a.id,
      foreignArtistId: a.foreignArtistId,
      artistName: a.artistName,
    }));

    // Start batch fix job
    try {
      const jobInfo = await metadataFixService.startBatchFix(req.user!.id, artistsToFix);

      // Execute batch fix asynchronously (non-blocking)
      setImmediate(async () => {
        try {
          await metadataFixService.executeBatchFix(req.user!.id, lidarr, artistsToFix);
        } catch (error) {
          log.error('Batch fix execution failed:', error);
        }
      });

      res.json(jobInfo);
    } catch (error) {
      if (error instanceof Error && error.message === 'Job already in progress') {
        res.status(409).json({ error: 'Job already in progress' });
        return;
      }
      throw error;
    }
  } catch (error) {
    log.error('Failed to start batch fix:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to start batch fix' 
    });
  }
});

// Get batch fix job status
searchRouter.get('/lidarr/artists/fix-all/status', async (req, res) => {
  try {
    const status = await metadataFixService.getJobStatus(req.user!.id);

    if (!status) {
      res.json({ status: null });
      return;
    }

    res.json(status);
  } catch (error) {
    log.error('Failed to get job status:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get job status' 
    });
  }
});

// Cancel running batch fix job
searchRouter.post('/lidarr/artists/fix-all/cancel', async (req, res) => {
  try {
    const cancelled = await metadataFixService.cancelJob(req.user!.id);

    if (!cancelled) {
      res.status(404).json({ error: 'No running job to cancel' });
      return;
    }

    res.json({ cancelled: true });
  } catch (error) {
    log.error('Failed to cancel job:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to cancel job' 
    });
  }
});

// Fix missing metadata for a specific artist
searchRouter.post('/lidarr/artists/:id/fix', async (req, res) => {
  try {
    const artistId = parseIntParam(req.params.id);
    if (artistId === null || artistId <= 0) {
      res.status(400).json({ error: 'Invalid artist ID' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    // Fetch artist from Lidarr to get MBID
    const artist = await lidarr.getArtist(artistId);
    if (!artist) {
      res.status(404).json({ error: 'Artist not found' });
      return;
    }

    // Check artist has foreignArtistId (MBID)
    if (!artist.foreignArtistId) {
      res.status(400).json({ error: 'Artist has no MusicBrainz ID' });
      return;
    }

    // Call metadataFixService to fix the artist
    const result = await metadataFixService.fixArtist(lidarr, artistId, artist.foreignArtistId);

    res.json(result);
  } catch (error) {
    log.error('Failed to fix artist metadata:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Fix operation failed' 
    });
  }
});

// Refresh all artists that appear to have incomplete data
searchRouter.post('/lidarr/artists/refresh-incomplete', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artists = await lidarr.getArtists();
    
    // Find artists with no albums (likely incomplete)
    const incompleteArtists = artists.filter(a => (a.statistics?.albumCount || 0) === 0);
    
    if (incompleteArtists.length === 0) {
      res.json({ 
        success: true, 
        message: 'No incomplete artists found',
        refreshed: 0,
      });
      return;
    }

    // Refresh each incomplete artist (with a small delay between to avoid overwhelming Lidarr)
    const refreshed: { id: number; name: string; commandId: number }[] = [];
    
    for (const artist of incompleteArtists) {
      try {
        const command = await lidarr.refreshArtist(artist.id);
        refreshed.push({ 
          id: artist.id, 
          name: artist.artistName, 
          commandId: command.id,
        });
        // Small delay between refreshes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        log.error('Failed to refresh artist', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          context: { artistId: artist.id, artistName: artist.artistName },
        });
      }
    }

    res.json({ 
      success: true, 
      message: `Triggered refresh for ${refreshed.length} incomplete artists`,
      refreshed: refreshed.length,
      artists: refreshed,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to refresh incomplete artists' 
    });
  }
});

// Refresh artists with specific issues (more flexible than refresh-incomplete)
searchRouter.post('/lidarr/artists/refresh-by-issue', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    // Filter options: no_albums, no_poster, no_overview, no_genres, or 'any'
    const { issueType = 'any', limit = 50 } = req.body as { issueType?: string; limit?: number };
    
    const artists = await lidarr.getArtists();
    
    // Find artists with the specified issue
    let incompleteArtists = artists.filter(artist => {
      const issues = getMetadataIssues(artist);
      if (issueType === 'any') {
        return issues.length > 0;
      }
      return issues.includes(issueType);
    });
    
    // Limit the number of artists to refresh
    incompleteArtists = incompleteArtists.slice(0, limit);
    
    if (incompleteArtists.length === 0) {
      res.json({ 
        success: true, 
        message: `No artists found with issue: ${issueType}`,
        refreshed: 0,
      });
      return;
    }

    // Refresh each artist (with a small delay between to avoid overwhelming Lidarr)
    const refreshed: { id: number; name: string; commandId: number; issues: string[] }[] = [];
    
    for (const artist of incompleteArtists) {
      try {
        const command = await lidarr.refreshArtist(artist.id);
        refreshed.push({ 
          id: artist.id, 
          name: artist.artistName, 
          commandId: command.id,
          issues: getMetadataIssues(artist),
        });
        // Small delay between refreshes
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        log.error('Failed to refresh artist', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          context: { artistId: artist.id, artistName: artist.artistName },
        });
      }
    }

    res.json({ 
      success: true, 
      message: `Triggered refresh for ${refreshed.length} artists with ${issueType} issues`,
      refreshed: refreshed.length,
      issueType,
      artists: refreshed,
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to refresh artists' 
    });
  }
});

// Enrich a single artist's metadata from connected sources
searchRouter.post('/lidarr/artists/:id/enrich', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const artistId = parseIntParam(req.params.id);
    if (artistId === null) {
      res.status(400).json({ error: 'Invalid artist ID' });
      return;
    }

    // Get Last.fm service for the user
    const lastfmConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'lastfm', isActive: true },
    });

    if (!lastfmConn) {
      res.status(400).json({ error: 'No active Last.fm connection for metadata enrichment' });
      return;
    }

    // Get Discogs token if available (optional)
    const discogsConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'discogs', isActive: true },
    });
    const discogsToken = discogsConn ? (discogsConn.config as { token?: string }).token : undefined;

    const lastfm = new LastfmService(lastfmConn.config as { apiKey: string });
    const enrichService = new MetadataEnrichmentService(lidarr, lastfm, discogsToken);

    const { updateLidarr = true, forceUpdate = false } = req.body as {
      updateLidarr?: boolean;
      forceUpdate?: boolean;
    };

    const result = await enrichService.enrichArtist(artistId, { updateLidarr, forceUpdate });

    res.json(result);
  } catch (error) {
    log.error('Error enriching artist:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich artist',
    });
  }
});

// Enrich all artists with incomplete metadata
searchRouter.post('/lidarr/artists/enrich-incomplete', async (req, res) => {
  try {
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    const lastfmConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'lastfm', isActive: true },
    });

    if (!lastfmConn) {
      res.status(400).json({ error: 'No active Last.fm connection for metadata enrichment' });
      return;
    }

    // Get Discogs token if available (optional)
    const discogsConn = await prisma.connection.findFirst({
      where: { userId: req.user!.id, type: 'discogs', isActive: true },
    });
    const discogsToken = discogsConn ? (discogsConn.config as { token?: string }).token : undefined;

    const lastfm = new LastfmService(lastfmConn.config as { apiKey: string });
    const enrichService = new MetadataEnrichmentService(lidarr, lastfm, discogsToken);

    const { limit = 50, issueType = 'any' } = req.body as {
      limit?: number;
      issueType?: string;
    };

    // Get all artists and filter to incomplete ones
    const artists = await lidarr.getArtists();
    let incompleteArtists = artists.filter(artist => {
      const issues = getMetadataIssues(artist);
      if (issueType === 'any') {
        return issues.length > 0;
      }
      return issues.includes(issueType);
    });

    incompleteArtists = incompleteArtists.slice(0, limit);

    if (incompleteArtists.length === 0) {
      res.json({
        success: true,
        message: `No artists found with issue: ${issueType}`,
        enriched: 0,
        total: 0,
        results: [],
      });
      return;
    }

    const results = await enrichService.enrichArtists(
      incompleteArtists.map(a => a.id),
      { updateLidarr: true }
    );

    const enrichedCount = results.filter(r => r.updated).length;

    res.json({
      success: true,
      message: `Enriched ${enrichedCount} of ${results.length} incomplete artists`,
      enriched: enrichedCount,
      total: results.length,
      results,
    });
  } catch (error) {
    log.error('Error enriching incomplete artists:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to enrich artists',
    });
  }
});

// MusicBrainz artist lookup
searchRouter.get('/musicbrainz/artist', async (req, res) => {
  try {
    const { q } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }

    const mb = new MusicBrainzService();
    const artists = await mb.searchArtist(q);
    
    res.json({ results: artists });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Search failed' 
    });
  }
});

// Search by label
searchRouter.get('/label', async (req, res) => {
  try {
    const { q, limit = '25', offset = '0' } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }

    const mb = new MusicBrainzService();
    const result = await mb.searchByLabel(q, parseInt(limit as string), parseInt(offset as string));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Label search failed' 
    });
  }
});

// Search by album
searchRouter.get('/album', async (req, res) => {
  try {
    const { q, limit = '25', offset = '0' } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }

    const mb = new MusicBrainzService();
    const result = await mb.searchByAlbum(q, parseInt(limit as string), parseInt(offset as string));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Album search failed' 
    });
  }
});

// Search by year
searchRouter.get('/year', async (req, res) => {
  try {
    const { year, limit = '25', offset = '0' } = req.query;
    
    if (!year || typeof year !== 'string') {
      res.status(400).json({ error: 'Year required' });
      return;
    }

    const yearNum = parseInt(year);
    if (isNaN(yearNum) || yearNum < 1900 || yearNum > new Date().getFullYear() + 1) {
      res.status(400).json({ error: 'Invalid year' });
      return;
    }

    const mb = new MusicBrainzService();
    const result = await mb.searchByYear(yearNum, parseInt(limit as string), parseInt(offset as string));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Year search failed' 
    });
  }
});

const artistIdentity = z.string().uuid().transform(value => value.toLowerCase());
const pagingInteger = (min: number, max: number) => z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));
const detailQuery = z.object({
  sourceLimit: pagingInteger(1, 100).optional(),
  sourceCursor: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
const releaseQuery = z.object({
  limit: pagingInteger(1, 100).default('100'),
  offset: pagingInteger(0, 1_000_000).default('0'),
});

// Owned provenance and optional metadata share one budget, including connection lookup.
searchRouter.get('/artist/:mbid/detail', async (req, res) => {
  const mbid = artistIdentity.safeParse(req.params.mbid);
  const query = detailQuery.safeParse(req.query);
  if (!mbid.success || !query.success) {
    res.status(400).json({ error: 'Invalid artist identity or source paging', code: 'INVALID_INPUT' });
    return;
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), cancellation.signal]);
  const close = () => { if (!res.writableEnded) cancellation.abort(); };
  res.on('close', close);
  try {
    const service = new ArtistDetailService(prisma, {
      getArtistByMbid: async (identity, providerSignal) => {
        const lidarr = await getLidarrService(req.user!.id, providerSignal);
        if (!lidarr) throw new Error('No active Lidarr connection');
        return lidarr.getArtistByMbid(identity, providerSignal);
      },
    });
    const detail = await service.getArtistDetail(mbid.data, req.user!.id, {
      limit: query.data.sourceLimit, cursor: query.data.sourceCursor, signal,
    });
    if (!cancellation.signal.aborted) res.json(detail);
  } catch (error) {
    if (cancellation.signal.aborted) return;
    if (error instanceof ArtistDetailInputError) {
      res.status(error.status).json({ error: error.message, code: error.code });
    } else if (error && typeof error === 'object' && 'status' in error && (error.status === 401 || error.status === 403)) {
      res.status(error.status).json({ error: 'Artist detail access denied' });
    } else {
      log.error('Artist detail lookup failed:', error);
      res.status(signal.aborted ? 504 : 500).json({ error: 'Artist detail unavailable' });
    }
  } finally {
    res.off('close', close);
  }
});

// Reuse the MusicBrainz release-group contract with strict bounded paging.
searchRouter.get('/artist/:mbid/releases', async (req, res) => {
  const mbid = artistIdentity.safeParse(req.params.mbid);
  const query = releaseQuery.safeParse(req.query);
  if (!mbid.success || !query.success) {
    res.status(400).json({ error: 'Invalid artist identity or release paging', code: 'INVALID_INPUT' });
    return;
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), cancellation.signal]);
  const close = () => { if (!res.writableEnded) cancellation.abort(); };
  res.on('close', close);
  try {
    const mb = new MusicBrainzService();
    const result = await readBeforeDeadline(mb.getArtistReleases(mbid.data, query.data.limit, query.data.offset), signal);
    if (!cancellation.signal.aborted) res.json(result);
  } catch (error) {
    if (cancellation.signal.aborted) return;
    log.error('Artist releases lookup failed:', error);
    res.status(signal.aborted ? 504 : 500).json({ error: 'Artist releases unavailable' });
  } finally {
    res.off('close', close);
  }
});

// Label traversal counts releases, not the artists extracted from each release page.
searchRouter.get('/label/:mbid/artists', async (req, res) => {
  const mbid = artistIdentity.safeParse(req.params.mbid);
  const query = releaseQuery.safeParse(req.query);
  if (!mbid.success || !query.success) {
    res.status(400).json({ error: 'Invalid label identity or release paging', code: 'INVALID_INPUT' });
    return;
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), cancellation.signal]);
  const close = () => { if (!res.writableEnded) cancellation.abort(); };
  res.on('close', close);
  try {
    const mb = new MusicBrainzService();
    const result = await readBeforeDeadline(mb.getLabelArtists(mbid.data, query.data.limit, query.data.offset), signal);
    if (!Number.isSafeInteger(result.count) || result.count < 0 || (!result.releases.length && query.data.offset < result.count)) {
      res.status(502).json({ error: 'Label release page unavailable. Retry this page.' });
      return;
    }
    const artistMap = new Map<string, LabelArtistPage['artists'][number]>();
    for (const release of result.releases) {
      for (const credit of release['artist-credit'] || []) {
        const identity = artistIdentity.safeParse(credit.artist?.id);
        if (identity.success && typeof credit.artist?.name === 'string' && credit.artist.name.trim() && !artistMap.has(identity.data)) {
          artistMap.set(identity.data, {
            id: identity.data,
            name: credit.artist.name,
            sortName: typeof credit.artist['sort-name'] === 'string' ? credit.artist['sort-name'] : credit.artist.name,
            imageUrl: null,
          });
        }
      }
    }
    const artists = [...artistMap.values()];
    // ponytail: artwork is optional. An image outage must not discard a valid release page.
    try {
      const imageMap = await readBeforeDeadline(getArtistImages(artists.map(artist => artist.name)), signal);
      artists.forEach(artist => { artist.imageUrl = imageMap.get(artist.name) || null; });
    } catch (error) {
      log.warn('Label artist images unavailable:', error);
    }
    const nextOffset = query.data.offset + result.releases.length;
    const page: LabelArtistPage = {
      artists,
      releasesProcessed: result.releases.length,
      totalReleases: result.count,
      nextReleaseOffset: nextOffset < result.count ? nextOffset : null,
    };
    if (!cancellation.signal.aborted) res.json(page);
  } catch (error) {
    if (cancellation.signal.aborted) return;
    log.error('Label release lookup failed:', error);
    res.status(signal.aborted ? 504 : 500).json({ error: 'Label artists unavailable. Retry this page.' });
  } finally {
    res.off('close', close);
  }
});

// Batch add artists to Lidarr
searchRouter.post('/batch', validateBody(addOptionsSchema.extend({ artistIds: z.array(z.string().uuid().transform(value => value.toLowerCase())).min(1).max(100).transform(ids => [...new Set(ids)]) })), async (req, res) => {
  try {
    const { artistIds } = req.body;
    
    if (!artistIds || !Array.isArray(artistIds) || artistIds.length === 0) {
      res.status(400).json({ error: 'Artist IDs array required' });
      return;
    }

    const lidarrResult = await getLidarrServiceWithConfig(req.user!.id);
    if (!lidarrResult) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    const { service: lidarr, config: lidarrConfig } = lidarrResult;
    
    const options = await effectiveAddOptions(lidarr, lidarrConfig, req.body);
    const { qualityProfileId: qpId, metadataProfileId: mpId, rootFolderPath: rfPath } = options;

    // Get cache to check existing artists (shared 5-min cache)
    const lidarrResult2 = await getLidarrServiceWithConfig(req.user!.id);
    const cache = lidarrResult2
      ? getSharedLidarrCache(lidarrResult2.config.url, lidarrResult2.service)
      : new LidarrCache(lidarr);
    // exists() refreshes lazily on first use

    const results = {
      added: [] as string[],
      skipped: [] as string[],
      failed: [] as { id: string; error: string }[]
    };

    for (const artistId of artistIds) {
      try {
        // Check if already in library
        const exists = await cache.exists({ mbid: artistId });
        if (exists) {
          results.skipped.push(artistId);
          continue;
        }

        // Use addArtistWithCacheWarm to warm SkyHook cache (batch mode)
        // Use monitorOption from connection config (defaults to 'all' if not set)
        await lidarr.addArtistWithCacheWarm(
          artistId, qpId, mpId, rfPath,
          true,  // monitored
          options.searchOnAdd,  // searchForMissingAlbums from config
          false, // waitForRefresh (deprecated)
          options.monitorOption,
          options.monitorNewItems
        );
        results.added.push(artistId);
      } catch (error) {
        results.failed.push({
          id: artistId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    res.json(results);
  } catch (error) {
    if (error instanceof DecisionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Batch add failed' 
    });
  }
});
