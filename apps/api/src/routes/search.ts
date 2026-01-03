import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { LidarrService, LidarrCache } from '../services/lidarr.js';
import { MusicBrainzService } from '../services/musicbrainz.js';
import { LastfmService } from '../services/lastfm.js';
import { fetchDeezerArtistImages } from '../services/deezer.js';
import { multiSourceSearch, resolveMbid, SearchSource } from '../services/multi-search.js';
import { MetadataEnrichmentService } from '../services/metadata-enrichment.js';
import { notificationService } from '../services/notifications.js';
import { aiService } from '../services/ai.js';
import { addLogEntry } from './logs.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Search');

export const searchRouter = Router();

searchRouter.use(requireAuth);

// Helper to get Last.fm service (user-owned or global)
async function getLastfmService(userId: number): Promise<LastfmService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'lastfm', isActive: true },
        { userId: null, type: 'lastfm', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  const config = connection.config as { apiKey: string };
  return new LastfmService(config);
}

// Helper to get Lidarr service (user-owned or global)
async function getLidarrService(userId: number): Promise<LidarrService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'lidarr', isActive: true },
        { userId: null, type: 'lidarr', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  const config = connection.config as { url: string; apiKey: string };
  return new LidarrService(config);
}

// Search for artists
searchRouter.get('/artists', async (req, res) => {
  try {
    const { q, enrich } = req.query;
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({ error: 'Search query required' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    
    const results = await lidarr.searchArtist(q);
    
    // Check which artists are already in library
    const cache = new LidarrCache(lidarr);
    await cache.refresh();
    
    // Get Deezer images for all artists
    const artistNames = results.map(r => r.artistName);
    const imageMap = await fetchDeezerArtistImages(artistNames);
    
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
  } catch (error) {
    log.error('Search /artists error:', error);
    const message = error instanceof Error ? error.message : 'Search failed';
    res.status(500).json({ error: `Lidarr API error: ${message}` });
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
    const results = await multiSourceSearch(q, req.user!.id, enabledSources, 25);
    
    // Skip MBID lookup during search - too slow with rate limits
    // MBID resolution happens when user clicks "Add" via /resolve-mbid endpoint
    
    res.json({ 
      results,
      sources: enabledSources,
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

    // Get Lidarr service for enrichment
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }

    // Get AI recommendations (limit to 10 to keep response time reasonable)
    const truncated = prompt.length > 50 ? `${prompt.substring(0, 50)}...` : prompt;
    log.debug(`Processing prompt: "${truncated}"`);
    const effectiveLimit = Math.min(limit, 10); // Cap at 10 to avoid timeouts
    const { artists: artistNames, providers, errors: aiErrors } = await aiService.searchByPrompt(prompt.trim(), effectiveLimit);

    if (artistNames.length === 0) {
      // If we have errors but no results, indicate the failure
      const hasProviderErrors = aiErrors && aiErrors.length > 0;
      const message = hasProviderErrors
        ? `AI providers encountered errors: ${aiErrors.join('; ')}. Please try again.`
        : 'No recommendations found. Try rephrasing your query.';
      
      res.json({
        prompt: prompt.trim(),
        results: [],
        aiProviders: providers,
        message,
        errors: aiErrors,
      });
      return;
    }

    // Resolve each artist name to MBID via Lidarr search
    const cache = new LidarrCache(lidarr);
    try {
      await cache.refresh();
    } catch (cacheError) {
      log.error('Failed to refresh library cache:', cacheError);
      // Continue without cache - inLibrary will be false for all
    }

    // Resolve artists with limited parallelism (5 at a time to stay within timeout)
    const BATCH_SIZE = 5;
    const enrichedResults: ({
      foreignArtistId: string;
      artistName: string;
      overview: string | undefined;
      imageUrl: null;
      inLibrary: boolean;
    } | null)[] = [];

    for (let i = 0; i < artistNames.length; i += BATCH_SIZE) {
      const batch = artistNames.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (name) => {
          try {
            const searchResults = await lidarr.searchArtist(name);
            if (searchResults.length === 0) {
              log.debug(`No Lidarr results for: ${name}`);
              return null;
            }

            const artist = searchResults[0];
            const inLibrary = await cache.exists({ mbid: artist.foreignArtistId });

            return {
              foreignArtistId: artist.foreignArtistId,
              artistName: artist.artistName,
              overview: artist.overview,
              imageUrl: null as null, // Will be enriched below
              inLibrary,
            };
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
    const imageMap = await fetchDeezerArtistImages(artistNamesForImages);

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
searchRouter.post('/discover/add', async (req, res) => {
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
    
    // Use provided MBID or resolve it
    let resolvedMbid = mbid;
    if (!resolvedMbid) {
      const resolution = await resolveMbid(artistName);
      if (!resolution.mbid) {
        // Return candidates for manual selection
        res.status(422).json({
          error: 'Could not automatically match artist in MusicBrainz',
          candidates: resolution.candidates,
          artistName,
        });
        return;
      }
      resolvedMbid = resolution.mbid;
    }
    
    // Get defaults if not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    let rfPath = rootFolderPath;

    if (!qpId) {
      const profiles = await lidarr.getQualityProfiles();
      qpId = profiles[0]?.id;
    }

    if (!mpId) {
      const profiles = await lidarr.getMetadataProfiles();
      mpId = profiles[0]?.id;
    }

    if (!rfPath) {
      const folders = await lidarr.getRootFolders();
      rfPath = folders[0]?.path;
    }

    if (!qpId || !mpId || !rfPath) {
      res.status(400).json({ error: 'Missing Lidarr configuration (profiles/folders)' });
      return;
    }

    // Use addArtistWithRefresh to trigger metadata refresh for complete MusicBrainz data
    const { artist, refreshCommand } = await lidarr.addArtistWithRefresh(resolvedMbid, qpId, mpId, rfPath);
    
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
searchRouter.post('/artists/add', async (req, res) => {
  try {
    const { foreignArtistId, qualityProfileId, metadataProfileId, rootFolderPath } = req.body;
    
    if (!foreignArtistId) {
      res.status(400).json({ error: 'Artist ID required' });
      return;
    }

    // Use global connection if user doesn't have their own
    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    
    // Get defaults if not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    let rfPath = rootFolderPath;

    if (!qpId) {
      const profiles = await lidarr.getQualityProfiles();
      qpId = profiles[0]?.id;
    }

    if (!mpId) {
      const profiles = await lidarr.getMetadataProfiles();
      mpId = profiles[0]?.id;
    }

    if (!rfPath) {
      const folders = await lidarr.getRootFolders();
      rfPath = folders[0]?.path;
    }

    if (!qpId || !mpId || !rfPath) {
      res.status(400).json({ error: 'Missing Lidarr configuration (profiles/folders)' });
      return;
    }

    // Use addArtistWithRefresh to trigger metadata refresh for complete MusicBrainz data
    const { artist, refreshCommand } = await lidarr.addArtistWithRefresh(foreignArtistId, qpId, mpId, rfPath);
    
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

    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) {
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
      } catch (err) {
        log.error(`Failed to refresh artist ${artist.id} (${artist.artistName}):`, err);
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
      } catch (err) {
        log.error(`Failed to refresh artist ${artist.id} (${artist.artistName}):`, err);
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

    const artistId = parseInt(req.params.id);
    if (isNaN(artistId)) {
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

// Get artist releases
searchRouter.get('/artist/:mbid/releases', async (req, res) => {
  try {
    const { mbid } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    const mb = new MusicBrainzService();
    const result = await mb.getArtistReleases(mbid, parseInt(limit as string), parseInt(offset as string));
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get releases' 
    });
  }
});

// Get label artists
searchRouter.get('/label/:mbid/artists', async (req, res) => {
  try {
    const { mbid } = req.params;
    const { limit = '100', offset = '0' } = req.query;

    const mb = new MusicBrainzService();
    const result = await mb.getLabelArtists(mbid, parseInt(limit as string), parseInt(offset as string));
    
    // Extract unique artists from releases
    const artistMap = new Map<string, { id: string; name: string; sortName: string }>();
    for (const release of result.releases) {
      for (const credit of release['artist-credit'] || []) {
        if (credit.artist && !artistMap.has(credit.artist.id)) {
          artistMap.set(credit.artist.id, {
            id: credit.artist.id,
            name: credit.artist.name,
            sortName: credit.artist['sort-name']
          });
        }
      }
    }
    
    const artists = Array.from(artistMap.values());
    
    // Fetch images from Deezer
    const artistNames = artists.map(a => a.name);
    const imageMap = await fetchDeezerArtistImages(artistNames);
    
    const enrichedArtists = artists.map(artist => ({
      ...artist,
      imageUrl: imageMap.get(artist.name) || null
    }));
    
    res.json({ 
      artists: enrichedArtists,
      count: enrichedArtists.length 
    });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get label artists' 
    });
  }
});

// Batch add artists to Lidarr
searchRouter.post('/batch', async (req, res) => {
  try {
    const { artistIds, qualityProfileId, metadataProfileId, rootFolderPath } = req.body;
    
    if (!artistIds || !Array.isArray(artistIds) || artistIds.length === 0) {
      res.status(400).json({ error: 'Artist IDs array required' });
      return;
    }

    const lidarr = await getLidarrService(req.user!.id);
    if (!lidarr) {
      res.status(400).json({ error: 'No active Lidarr connection' });
      return;
    }
    
    // Get defaults if not provided
    let qpId = qualityProfileId;
    let mpId = metadataProfileId;
    let rfPath = rootFolderPath;

    if (!qpId) {
      const profiles = await lidarr.getQualityProfiles();
      qpId = profiles[0]?.id;
    }

    if (!mpId) {
      const profiles = await lidarr.getMetadataProfiles();
      mpId = profiles[0]?.id;
    }

    if (!rfPath) {
      const folders = await lidarr.getRootFolders();
      rfPath = folders[0]?.path;
    }

    if (!qpId || !mpId || !rfPath) {
      res.status(400).json({ error: 'Missing Lidarr configuration (profiles/folders)' });
      return;
    }

    // Get cache to check existing artists
    const cache = new LidarrCache(lidarr);
    await cache.refresh();

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

        // Use addArtistWithRefresh but don't wait (batch mode - avoid blocking)
        await lidarr.addArtistWithRefresh(artistId, qpId, mpId, rfPath, true, true, false);
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
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Batch add failed' 
    });
  }
});
