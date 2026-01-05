import { Router } from 'express';
import prisma from '../lib/db.js';
import { getBaseUrl } from '../lib/settings.js';
import { createSignedState, verifySignedState } from '../lib/oauth-state.js';
import { requireAuth } from '../middleware/auth.js';
import { LidarrService } from '../services/lidarr.js';
import { SpotifyService } from '../services/spotify.js';
import { LastfmService } from '../services/lastfm.js';
import { TautulliService } from '../services/tautulli.js';
import { DeezerOAuthService } from '../services/deezer-oauth.js';
import { TidalService } from '../services/tidal.js';
import { ListenBrainzService } from '../services/listenbrainz.js';
import { DiscogsService } from '../services/discogs.js';
import type { Connection } from '@prisma/client';
import type { Request } from 'express';

export const connectionsRouter = Router();

// Helper: Check if user can access a connection
function canAccessConnection(req: Request, connection: Connection): boolean {
  const isAdmin = req.user!.role === 'admin';
  const isOwner = connection.userId === req.user!.id;
  const isGlobalLidarr = connection.userId === null && connection.type === 'lidarr';
  return isAdmin || isOwner || isGlobalLidarr;
}

// Helper: Check if user can modify a connection
function canModifyConnection(req: Request, connection: Connection): boolean {
  const isAdmin = req.user!.role === 'admin';
  const isOwner = connection.userId === req.user!.id;
  // Only admins can modify global Lidarr, users can modify their own
  if (connection.userId === null) return isAdmin;
  return isAdmin || isOwner;
}

// PUBLIC ROUTES (no auth required)

// Spotify OAuth callback - must be public as Spotify redirects here
connectionsRouter.get('/:id/spotify/callback', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const { code, state, error: spotifyError } = req.query;
    
    // Use BASE_URL from settings for all redirects (same as OAuth callback URL)
    const baseUrl = await getBaseUrl();
    
    if (spotifyError) {
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(String(spotifyError))}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${baseUrl}/connections?error=missing_code_or_state`);
      return;
    }

    // Verify signed state (returnTo is optional, for redirect after OAuth)
    let stateData: { connectionId: number; userId: number; timestamp: number; returnTo?: string };
    try {
      stateData = verifySignedState<typeof stateData>(String(state));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'invalid_state';
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(errorMsg)}`);
      return;
    }

    if (stateData.connectionId !== connectionId) {
      res.redirect(`${baseUrl}/connections?error=connection_mismatch`);
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.redirect(`${baseUrl}/connections?error=connection_not_found`);
      return;
    }

    const config = connection.config as { clientId?: string; clientSecret?: string };
    if (!config.clientId || !config.clientSecret) {
      res.redirect(`${baseUrl}/connections?error=missing_credentials`);
      return;
    }

    const service = new SpotifyService({ clientId: config.clientId, clientSecret: config.clientSecret });
    const redirectUri = `${baseUrl}/api/connections/${connection.id}/spotify/callback`;

    // Exchange code for tokens
    const tokens = await service.exchangeCode(String(code), redirectUri);

    // Update connection config with tokens
    const updatedConfig = {
      ...config,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    };

    await prisma.connection.update({
      where: { id: connection.id },
      data: { 
        config: updatedConfig as any,
        lastTest: new Date(),
      },
    });

    // Redirect to frontend with success - use returnTo if provided
    const returnPath = stateData.returnTo || '/connections';
    const separator = returnPath.includes('?') ? '&' : '?';
    res.redirect(`${baseUrl}${returnPath}${separator}spotify_authorized=${connection.id}`);
  } catch (error) {
    console.error('Error in Spotify callback:', error);
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Generic connection test endpoint (public - used during setup)
// Routes to the appropriate service based on connection type
connectionsRouter.post('/test', async (req, res) => {
  try {
    const { type, url, apiKey, clientId, clientSecret } = req.body;

    if (!type) {
      res.status(400).json({ success: false, error: 'Connection type required' });
      return;
    }

    switch (type) {
      case 'lidarr': {
        if (!url || !apiKey) {
          res.status(400).json({ success: false, error: 'URL and API key required' });
          return;
        }
        const service = new LidarrService({ url, apiKey });
        const testResult = await service.testConnection();
        if (!testResult.success) {
          res.json({ success: false, error: testResult.error || 'Connection failed' });
          return;
        }
        res.json({ success: true, message: `Connected to Lidarr v${testResult.version}` });
        return;
      }

      case 'spotify': {
        if (!clientId || !clientSecret) {
          res.status(400).json({ success: false, error: 'Client ID and Client Secret required' });
          return;
        }
        // For Spotify, we just validate the credentials format for now
        // Full OAuth flow happens after saving the connection
        if (clientId.length < 10 || clientSecret.length < 10) {
          res.json({ success: false, error: 'Invalid credentials format' });
          return;
        }
        res.json({ success: true, message: 'Spotify credentials format valid' });
        return;
      }

      case 'lastfm': {
        if (!apiKey) {
          res.status(400).json({ success: false, error: 'API key required' });
          return;
        }
        const service = new LastfmService({ apiKey });
        const testResult = await service.testConnection();
        if (!testResult.success) {
          res.json({ success: false, error: testResult.error || 'Connection failed' });
          return;
        }
        res.json({ success: true, message: 'Connected to Last.fm' });
        return;
      }

      case 'jellyfin': {
        const config = req.body.config || {};
        const jellyfinUrl = config.jellyfinUrl;
        const jellyfinApiKey = config.jellyfinApiKey;
        
        if (!jellyfinUrl || !jellyfinApiKey) {
          res.status(400).json({ success: false, error: 'Jellyfin URL and API key required' });
          return;
        }
        const { JellyfinService } = await import('../services/jellyfin.js');
        const service = new JellyfinService();
        const testResult = await service.testConnection({ jellyfinUrl, jellyfinApiKey });
        if (!testResult.success) {
          res.json({ success: false, error: testResult.error || 'Connection failed' });
          return;
        }
        res.json({ success: true, message: `Connected to ${testResult.serverName || 'Jellyfin'}` });
        return;
      }

      default:
        res.status(400).json({ success: false, error: `Unknown connection type: ${type}` });
    }
  } catch (error) {
    console.error('Connection test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Test failed' 
    });
  }
});

// AUTHENTICATED ROUTES

// All remaining connection routes require authentication
connectionsRouter.use(requireAuth);

// Get all connections for current user (+ global Lidarr connections)
// Admins see all connections
connectionsRouter.get('/', async (req, res) => {
  try {
    const isAdmin = req.user!.role === 'admin';
    
    let whereClause: any;
    if (isAdmin) {
      // Admins see all connections
      whereClause = {};
    } else {
      // Regular users see: their own connections + global Lidarr
      whereClause = {
        OR: [
          { userId: req.user!.id },
          { userId: null, type: 'lidarr' }, // Global Lidarr
        ],
      };
    }

    const connections = await prisma.connection.findMany({
      where: whereClause,
      select: {
        id: true,
        userId: true,
        type: true,
        name: true,
        isActive: true,
        lastTest: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: { username: true, displayName: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ connections });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Get specific connection (with non-sensitive config)
connectionsRouter.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Return config but sanitize sensitive fields
    const config = connection.config as Record<string, any>;
    const safeConfig: Record<string, any> = {};
    
    if (connection.type === 'lidarr') {
      safeConfig.url = config.url;
      // Include Lidarr settings (non-sensitive)
      safeConfig.qualityProfileId = config.qualityProfileId;
      safeConfig.rootFolderPath = config.rootFolderPath;
      safeConfig.monitorOption = config.monitorOption;
      safeConfig.searchOnAdd = config.searchOnAdd;
    } else if (connection.type === 'spotify') {
      safeConfig.clientId = config.clientId;
    } else if (connection.type === 'tautulli') {
      safeConfig.tautulliUrl = config.tautulliUrl;
      safeConfig.plexUserId = config.plexUserId;
      safeConfig.plexLibraryId = config.plexLibraryId;
      safeConfig.plexUserName = config.plexUserName;
      safeConfig.plexLibraryName = config.plexLibraryName;
    } else if (connection.type === 'lastfm') {
      safeConfig.username = config.username;
    }
    // tidal and deezer clientIds are returned
    else if (connection.type === 'tidal' || connection.type === 'deezer') {
      safeConfig.clientId = config.clientId;
    }
    
    res.json({ 
      connection: {
        id: connection.id,
        type: connection.type,
        name: connection.name,
        isActive: connection.isActive,
        lastTest: connection.lastTest,
        createdAt: connection.createdAt,
        updatedAt: connection.updatedAt,
        config: safeConfig,
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch connection' });
  }
});

// Create new connection
connectionsRouter.post('/', async (req, res) => {
  try {
    const { type, name, config } = req.body;
    
    if (!type || !name || !config) {
      res.status(400).json({ error: 'Type, name, and config required' });
      return;
    }

    // Lidarr connections are global (admin only), others are per-user
    const isLidarr = type === 'lidarr';
    if (isLidarr && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only admins can create Lidarr connections' });
      return;
    }

    const connection = await prisma.connection.create({
      data: {
        userId: isLidarr ? undefined : req.user!.id,
        type,
        name,
        config,
        isActive: true,
      },
    });

    res.json({
      success: true,
      connection: {
        id: connection.id,
        type: connection.type,
        name: connection.name,
        isActive: connection.isActive,
      },
    });
  } catch (error: any) {
    if (error.code === 'P2002') {
      res.status(400).json({ error: 'Connection with this name already exists' });
      return;
    }
    res.status(500).json({ error: 'Failed to create connection' });
  }
});

// Update connection
connectionsRouter.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, config, isActive } = req.body;
    
    const existing = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!existing || !canModifyConnection(req, existing)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // Merge config, preserving sensitive fields if not provided
    let mergedConfig = config;
    if (config && existing.config) {
      const existingConfig = existing.config as Record<string, any>;
      mergedConfig = { ...existingConfig, ...config };
      
      // Preserve sensitive fields if new value is empty
      if (config.apiKey === '' && existingConfig.apiKey) {
        mergedConfig.apiKey = existingConfig.apiKey;
      }
      if (config.clientSecret === '' && existingConfig.clientSecret) {
        mergedConfig.clientSecret = existingConfig.clientSecret;
      }
      if (config.tautulliApiKey === '' && existingConfig.tautulliApiKey) {
        mergedConfig.tautulliApiKey = existingConfig.tautulliApiKey;
      }
    }

    const connection = await prisma.connection.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(mergedConfig && { config: mergedConfig }),
        ...(typeof isActive === 'boolean' && { isActive }),
      },
    });

    res.json({
      success: true,
      connection: {
        id: connection.id,
        type: connection.type,
        name: connection.name,
        isActive: connection.isActive,
      },
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update connection' });
  }
});

// Delete connection
connectionsRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const existing = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!existing || !canModifyConnection(req, existing)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    await prisma.connection.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

// Test connection
connectionsRouter.post('/:id/test', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    
    const connection = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    const config = connection.config as Record<string, any>;
    let result: { success: boolean; message: string; details?: any; needsAuthorization?: boolean };

    switch (connection.type) {
      case 'lidarr': {
        const service = new LidarrService({
          url: config.url,
          apiKey: config.apiKey,
        });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected to Lidarr v${testResult.version}` 
            : testResult.error || 'Connection failed',
          details: { version: testResult.version },
        };
        break;
      }
      
      case 'spotify': {
        const service = new SpotifyService({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          accessToken: config.accessToken,
          refreshToken: config.refreshToken,
        });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected as ${testResult.user}` 
            : testResult.error || 'Connection failed',
          details: { user: testResult.user },
        };
        break;
      }
      
      case 'lastfm': {
        const service = new LastfmService({ apiKey: config.apiKey });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? 'Connected to Last.fm' 
            : testResult.error || 'Connection failed',
        };
        break;
      }
      
      case 'tautulli': {
        const service = new TautulliService();
        const testResult = await service.testConnection({
          tautulliUrl: config.tautulliUrl,
          tautulliApiKey: config.tautulliApiKey,
        });
        result = {
          success: testResult.success,
          message: testResult.success 
            ? 'Connected to Tautulli' 
            : testResult.error || 'Connection failed',
        };
        break;
      }
      
      case 'jellyfin': {
        const { JellyfinService } = await import('../services/jellyfin.js');
        const service = new JellyfinService();
        const testResult = await service.testConnection({
          jellyfinUrl: config.jellyfinUrl,
          jellyfinApiKey: config.jellyfinApiKey,
        });
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected to ${testResult.serverName || 'Jellyfin'}` 
            : testResult.error || 'Connection failed',
        };
        break;
      }
      
      case 'deezer': {
        // Deezer requires OAuth authorization first
        if (!config.accessToken) {
          result = {
            success: false,
            message: 'Deezer authorization required. Click "Authorize Deezer" to connect your account.',
            needsAuthorization: true,
          };
          break;
        }
        
        const service = new DeezerOAuthService({
          appId: config.appId,
          appSecret: config.appSecret,
          accessToken: config.accessToken,
        });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected as ${testResult.user}` 
            : testResult.error || 'Connection failed',
          details: { user: testResult.user },
        };
        break;
      }
      
      case 'tidal': {
        // TIDAL requires OAuth authorization first
        if (!config.accessToken || !config.refreshToken) {
          result = {
            success: false,
            message: 'TIDAL authorization required. Click "Authorize TIDAL" to connect your account.',
            needsAuthorization: true,
          };
          break;
        }
        
        const service = new TidalService({
          clientId: config.clientId,
          clientSecret: config.clientSecret,
          accessToken: config.accessToken,
          refreshToken: config.refreshToken,
        });
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? `Connected as ${testResult.user}` 
            : testResult.error || 'Connection failed',
          details: { user: testResult.user },
        };
        break;
      }
      
      case 'listenbrainz': {
        try {
          const service = new ListenBrainzService(config.username, config.token);
          const isValid = await service.validateUser();
          result = {
            success: isValid,
            message: isValid 
              ? `Connected to ListenBrainz as ${config.username}` 
              : config.token 
                ? 'Invalid token or username mismatch. Verify your token matches your username.'
                : 'User not found on ListenBrainz. Check the username spelling.',
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result = {
            success: false,
            message: errorMessage.includes('timed out')
              ? 'ListenBrainz API request timed out. Please try again later.'
              : `ListenBrainz connection failed: ${errorMessage}`,
          };
        }
        break;
      }
      
      case 'discogs': {
        const service = new DiscogsService(config.token);
        const testResult = await service.testConnection();
        result = {
          success: testResult.success,
          message: testResult.success 
            ? 'Connected to Discogs' 
            : testResult.error || 'Connection failed',
        };
        break;
      }
      
      default:
        result = { success: false, message: 'Unknown connection type' };
    }

    // Update last test timestamp
    await prisma.connection.update({
      where: { id },
      data: { lastTest: new Date() },
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Test failed' 
    });
  }
});

// Get Lidarr options (quality profiles, root folders) for an existing connection
connectionsRouter.get('/:id/lidarr-options', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (connection.type !== 'lidarr') {
      res.status(400).json({ error: 'Not a Lidarr connection' });
      return;
    }

    const config = connection.config as Record<string, any>;
    
    if (!config.url || !config.apiKey) {
      res.status(400).json({ error: 'Lidarr connection is missing URL or API key. Please edit the connection.' });
      return;
    }
    
    const service = new LidarrService({
      url: config.url,
      apiKey: config.apiKey,
    });

    const [qualityProfiles, rootFolders] = await Promise.all([
      service.getQualityProfiles(),
      service.getRootFolders(),
    ]);

    res.json({ qualityProfiles, rootFolders });
  } catch (error) {
    console.error('Lidarr options error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to fetch Lidarr options' 
    });
  }
});

// Test Lidarr connection and get options (for new connections before save)
connectionsRouter.post('/test-lidarr', async (req, res) => {
  try {
    const { url, apiKey } = req.body;
    
    if (!url || !apiKey) {
      res.status(400).json({ success: false, message: 'URL and API key required' });
      return;
    }

    const service = new LidarrService({ url, apiKey });
    const testResult = await service.testConnection();
    
    if (!testResult.success) {
      res.json({ 
        success: false, 
        message: testResult.error || 'Connection failed' 
      });
      return;
    }

    const [qualityProfiles, rootFolders] = await Promise.all([
      service.getQualityProfiles(),
      service.getRootFolders(),
    ]);

    res.json({ 
      success: true, 
      message: `Connected to Lidarr v${testResult.version}`,
      qualityProfiles, 
      rootFolders 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Test failed' 
    });
  }
});

// Tautulli Routes

// Test Tautulli connection (for new connections before save)
connectionsRouter.post('/test-tautulli', async (req, res) => {
  try {
    const { tautulliUrl, tautulliApiKey } = req.body;
    
    if (!tautulliUrl || !tautulliApiKey) {
      res.status(400).json({ success: false, message: 'Tautulli URL and API key required' });
      return;
    }

    const service = new TautulliService();
    const testResult = await service.testConnection({ tautulliUrl, tautulliApiKey });
    
    if (!testResult.success) {
      res.json({ 
        success: false, 
        message: testResult.error || 'Connection failed' 
      });
      return;
    }

    res.json({ 
      success: true, 
      message: 'Connected to Tautulli'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error instanceof Error ? error.message : 'Test failed' 
    });
  }
});

// Get Plex users from Tautulli
connectionsRouter.post('/tautulli/users', async (req, res) => {
  try {
    const { tautulliUrl, tautulliApiKey } = req.body;
    
    if (!tautulliUrl || !tautulliApiKey) {
      res.status(400).json({ error: 'Tautulli URL and API key required' });
      return;
    }

    const service = new TautulliService();
    const users = await service.getUsers({ tautulliUrl, tautulliApiKey });
    
    res.json({ users });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get users' 
    });
  }
});

// Get Plex music libraries from Tautulli
connectionsRouter.post('/tautulli/libraries', async (req, res) => {
  try {
    const { tautulliUrl, tautulliApiKey } = req.body;
    
    if (!tautulliUrl || !tautulliApiKey) {
      res.status(400).json({ error: 'Tautulli URL and API key required' });
      return;
    }

    const service = new TautulliService();
    const libraries = await service.getLibraries({ tautulliUrl, tautulliApiKey });
    
    res.json({ libraries });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get libraries' 
    });
  }
});

// Get top artists for a Tautulli connection
connectionsRouter.get('/:id/tautulli/top-artists', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const period = (req.query.period as string) || 'month';
    const limit = parseInt(req.query.limit as string) || 25;
    
    const connection = await prisma.connection.findUnique({
      where: { id },
    });
    
    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (connection.type !== 'tautulli') {
      res.status(400).json({ error: 'Connection is not a Tautulli connection' });
      return;
    }

    const config = connection.config as Record<string, any>;
    const service = new TautulliService();
    
    const artists = await service.getTopArtists(
      {
        tautulliUrl: config.tautulliUrl,
        tautulliApiKey: config.tautulliApiKey,
        plexUserId: config.plexUserId,
        plexLibraryId: config.plexLibraryId,
      },
      { period: period as 'week' | 'month' | 'year' | 'all', limit }
    );
    
    res.json({ artists });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get top artists' 
    });
  }
});

// Get Jellyfin users
connectionsRouter.post('/jellyfin/users', async (req, res) => {
  try {
    const { jellyfinUrl, jellyfinApiKey } = req.body;
    
    if (!jellyfinUrl || !jellyfinApiKey) {
      res.status(400).json({ error: 'Jellyfin URL and API key required' });
      return;
    }

    const { JellyfinService } = await import('../services/jellyfin.js');
    const service = new JellyfinService();
    const users = await service.getUsers({ jellyfinUrl, jellyfinApiKey });
    
    res.json({ users });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get users' 
    });
  }
});

// Get Jellyfin music libraries
connectionsRouter.post('/jellyfin/libraries', async (req, res) => {
  try {
    const { jellyfinUrl, jellyfinApiKey } = req.body;
    
    if (!jellyfinUrl || !jellyfinApiKey) {
      res.status(400).json({ error: 'Jellyfin URL and API key required' });
      return;
    }

    const { JellyfinService } = await import('../services/jellyfin.js');
    const service = new JellyfinService();
    const libraries = await service.getLibraries({ jellyfinUrl, jellyfinApiKey });
    
    res.json({ libraries });
  } catch (error) {
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Failed to get libraries' 
    });
  }
});

// Spotify OAuth Routes

// Get Spotify authorization URL for a connection
connectionsRouter.get('/:id/spotify/auth', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'spotify') {
      res.status(400).json({ error: 'Connection is not a Spotify connection' });
      return;
    }

    const config = connection.config as { clientId?: string; clientSecret?: string };
    if (!config.clientId || !config.clientSecret) {
      res.status(400).json({ error: 'Spotify client ID and secret are required' });
      return;
    }

    const service = new SpotifyService({ clientId: config.clientId, clientSecret: config.clientSecret });
    
    // Build redirect URI - should point back to our callback endpoint
    const baseUrl = await getBaseUrl();
    const redirectUri = `${baseUrl}/api/connections/${connection.id}/spotify/callback`;
    
    // Create HMAC-signed state for security, including optional returnTo
    const returnTo = req.query.returnTo as string | undefined;
    const state = createSignedState({ 
      connectionId: connection.id,
      userId: req.user!.id,
      returnTo: returnTo || undefined,
    });
    
    const authUrl = service.getAuthUrl(redirectUri, state);
    
    res.json({ authUrl, redirectUri });
  } catch (error) {
    console.error('Error getting Spotify auth URL:', error);
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if Spotify connection is authorized
connectionsRouter.get('/:id/spotify/status', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'spotify') {
      res.status(400).json({ error: 'Connection is not a Spotify connection' });
      return;
    }

    const config = connection.config as { 
      accessToken?: string; 
      refreshToken?: string;
      tokenExpiresAt?: number;
    };

    const isAuthorized = !!(config.accessToken && config.refreshToken);
    const isExpired = config.tokenExpiresAt ? Date.now() > config.tokenExpiresAt : false;

    res.json({ 
      authorized: isAuthorized,
      expired: isExpired,
      needsReauthorization: !isAuthorized || isExpired,
    });
  } catch (error) {
    console.error('Error checking Spotify status:', error);
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke Spotify authorization
connectionsRouter.post('/:id/spotify/revoke', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canModifyConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'spotify') {
      res.status(400).json({ error: 'Connection is not a Spotify connection' });
      return;
    }

    const config = connection.config as Record<string, unknown>;
    
    // Remove tokens from config
    const { accessToken, refreshToken, tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as any },
    });

    res.json({ success: true, message: 'Spotify authorization revoked' });
  } catch (error) {
    console.error('Error revoking Spotify auth:', error);
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Deezer OAuth Routes

// Deezer OAuth callback - must be public as Deezer redirects here
connectionsRouter.get('/:id/deezer/callback', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const { code, state, error_reason: deezerError } = req.query;
    
    const baseUrl = await getBaseUrl();
    
    if (deezerError) {
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(String(deezerError))}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${baseUrl}/connections?error=missing_code_or_state`);
      return;
    }

    // Verify signed state
    let stateData: { connectionId: number; userId: number; timestamp: number };
    try {
      stateData = verifySignedState<typeof stateData>(String(state));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'invalid_state';
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(errorMsg)}`);
      return;
    }

    if (stateData.connectionId !== connectionId) {
      res.redirect(`${baseUrl}/connections?error=connection_mismatch`);
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.redirect(`${baseUrl}/connections?error=connection_not_found`);
      return;
    }

    const config = connection.config as { appId?: string; appSecret?: string };
    if (!config.appId || !config.appSecret) {
      res.redirect(`${baseUrl}/connections?error=missing_credentials`);
      return;
    }

    const service = new DeezerOAuthService({ appId: config.appId, appSecret: config.appSecret });

    // Exchange code for tokens
    const tokens = await service.exchangeCode(String(code));

    // Update connection config with tokens
    const updatedConfig = {
      ...config,
      accessToken: tokens.accessToken,
      tokenExpiresAt: tokens.expiresAt,
    };

    await prisma.connection.update({
      where: { id: connection.id },
      data: { 
        config: updatedConfig as any,
        lastTest: new Date(),
      },
    });

    res.redirect(`${baseUrl}/connections?deezer_authorized=${connection.id}`);
  } catch (error) {
    console.error('Error in Deezer callback:', error);
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Get Deezer authorization URL for a connection
connectionsRouter.get('/:id/deezer/auth', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'deezer') {
      res.status(400).json({ error: 'Connection is not a Deezer connection' });
      return;
    }

    const config = connection.config as { appId?: string; appSecret?: string };
    if (!config.appId || !config.appSecret) {
      res.status(400).json({ error: 'Deezer App ID and Secret are required' });
      return;
    }

    const service = new DeezerOAuthService({ appId: config.appId, appSecret: config.appSecret });
    
    const baseUrl = await getBaseUrl();
    const redirectUri = `${baseUrl}/api/connections/${connection.id}/deezer/callback`;
    
    // Create HMAC-signed state for security
    const state = createSignedState({ 
      connectionId: connection.id,
      userId: req.user!.id,
    });
    
    const authUrl = service.getAuthUrl(redirectUri, state);
    
    res.json({ authUrl, redirectUri });
  } catch (error) {
    console.error('Error getting Deezer auth URL:', error);
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if Deezer connection is authorized
connectionsRouter.get('/:id/deezer/status', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'deezer') {
      res.status(400).json({ error: 'Connection is not a Deezer connection' });
      return;
    }

    const config = connection.config as { accessToken?: string };
    const isAuthorized = !!config.accessToken;

    res.json({ 
      authorized: isAuthorized,
      needsReauthorization: !isAuthorized,
    });
  } catch (error) {
    console.error('Error checking Deezer status:', error);
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke Deezer authorization
connectionsRouter.post('/:id/deezer/revoke', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canModifyConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'deezer') {
      res.status(400).json({ error: 'Connection is not a Deezer connection' });
      return;
    }

    const config = connection.config as Record<string, unknown>;
    const { accessToken, tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as any },
    });

    res.json({ success: true, message: 'Deezer authorization revoked' });
  } catch (error) {
    console.error('Error revoking Deezer auth:', error);
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Get user's Deezer playlists
connectionsRouter.get('/:id/deezer/playlists', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (connection.type !== 'deezer') {
      res.status(400).json({ error: 'Connection is not a Deezer connection' });
      return;
    }

    const config = connection.config as { appId: string; appSecret: string; accessToken?: string };
    if (!config.accessToken) {
      res.status(400).json({ error: 'Deezer connection not authorized' });
      return;
    }

    const service = new DeezerOAuthService({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
    });

    const playlists = await service.getAllPlaylists();
    res.json({ playlists });
  } catch (error) {
    console.error('Error fetching Deezer playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// TIDAL OAuth Routes

// TIDAL OAuth callback - must be public as TIDAL redirects here
connectionsRouter.get('/:id/tidal/callback', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const { code, state, error: tidalError } = req.query;
    
    const baseUrl = await getBaseUrl();
    
    if (tidalError) {
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(String(tidalError))}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${baseUrl}/connections?error=missing_code_or_state`);
      return;
    }

    // Verify signed state and get code_verifier
    let stateData: { connectionId: number; userId: number; timestamp: number; codeVerifier: string };
    try {
      stateData = verifySignedState<typeof stateData>(String(state));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'invalid_state';
      res.redirect(`${baseUrl}/connections?error=${encodeURIComponent(errorMsg)}`);
      return;
    }

    if (stateData.connectionId !== connectionId) {
      res.redirect(`${baseUrl}/connections?error=connection_mismatch`);
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.redirect(`${baseUrl}/connections?error=connection_not_found`);
      return;
    }

    const config = connection.config as { clientId?: string; clientSecret?: string };
    if (!config.clientId || !config.clientSecret) {
      res.redirect(`${baseUrl}/connections?error=missing_credentials`);
      return;
    }

    const service = new TidalService({ clientId: config.clientId, clientSecret: config.clientSecret });
    const redirectUri = `${baseUrl}/api/connections/${connection.id}/tidal/callback`;

    // Exchange code for tokens (PKCE requires code_verifier)
    const tokens = await service.exchangeCode(String(code), redirectUri, stateData.codeVerifier);

    // Update connection config with tokens
    const updatedConfig = {
      ...config,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt,
    };

    await prisma.connection.update({
      where: { id: connection.id },
      data: { 
        config: updatedConfig as any,
        lastTest: new Date(),
      },
    });

    res.redirect(`${baseUrl}/connections?tidal_authorized=${connection.id}`);
  } catch (error) {
    console.error('Error in TIDAL callback:', error);
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Get TIDAL authorization URL for a connection
connectionsRouter.get('/:id/tidal/auth', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'tidal') {
      res.status(400).json({ error: 'Connection is not a TIDAL connection' });
      return;
    }

    const config = connection.config as { clientId?: string; clientSecret?: string };
    if (!config.clientId || !config.clientSecret) {
      res.status(400).json({ error: 'TIDAL Client ID and Secret are required' });
      return;
    }
    
    const baseUrl = await getBaseUrl();
    const redirectUri = `${baseUrl}/api/connections/${connection.id}/tidal/callback`;
    
    // Generate PKCE values first so we can include codeVerifier in state
    const { codeVerifier, codeChallenge } = TidalService.generatePKCE();
    
    // Create HMAC-signed state with codeVerifier included for the callback
    const state = createSignedState({ 
      connectionId: connection.id,
      userId: req.user!.id,
      codeVerifier,
    });
    
    // Use TidalService to generate auth URL with proper scopes
    const service = new TidalService({ clientId: config.clientId, clientSecret: config.clientSecret });
    const authUrl = service.getAuthUrlWithPKCE(redirectUri, state, codeChallenge);
    
    res.json({ authUrl, redirectUri });
  } catch (error) {
    console.error('Error getting TIDAL auth URL:', error);
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if TIDAL connection is authorized
connectionsRouter.get('/:id/tidal/status', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canAccessConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'tidal') {
      res.status(400).json({ error: 'Connection is not a TIDAL connection' });
      return;
    }

    const config = connection.config as { 
      accessToken?: string; 
      refreshToken?: string;
      tokenExpiresAt?: number;
    };

    const isAuthorized = !!(config.accessToken && config.refreshToken);
    const isExpired = config.tokenExpiresAt ? Date.now() > config.tokenExpiresAt : false;

    res.json({ 
      authorized: isAuthorized,
      expired: isExpired,
      needsReauthorization: !isAuthorized || isExpired,
    });
  } catch (error) {
    console.error('Error checking TIDAL status:', error);
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke TIDAL authorization
connectionsRouter.post('/:id/tidal/revoke', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (!canModifyConnection(req, connection)) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    if (connection.type !== 'tidal') {
      res.status(400).json({ error: 'Connection is not a TIDAL connection' });
      return;
    }

    const config = connection.config as Record<string, unknown>;
    const { accessToken, refreshToken, tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as any },
    });

    res.json({ success: true, message: 'TIDAL authorization revoked' });
  } catch (error) {
    console.error('Error revoking TIDAL auth:', error);
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Get user's TIDAL playlists
connectionsRouter.get('/:id/tidal/playlists', async (req, res) => {
  try {
    const connectionId = parseInt(req.params.id, 10);
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    if (connection.type !== 'tidal') {
      res.status(400).json({ error: 'Connection is not a TIDAL connection' });
      return;
    }

    const config = connection.config as { 
      clientId: string; 
      clientSecret: string; 
      accessToken?: string;
      refreshToken?: string;
    };
    if (!config.accessToken) {
      res.status(400).json({ error: 'TIDAL connection not authorized' });
      return;
    }

    const service = new TidalService({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
    });

    const playlists = await service.getPlaylists();
    res.json({ playlists });
  } catch (error) {
    console.error('Error fetching TIDAL playlists:', error);
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

