import { Router } from 'express';
import prisma from '../lib/db.js';
import { parseIntParam } from '../utils/params.js';
import { getBaseUrl } from '../lib/settings.js';
import { createSignedState, verifySignedState } from '../lib/oauth-state.js';
import { requireAuth } from '../middleware/auth.js';
import { withTypedConnection, canAccessConnection, canModifyConnection } from '../middleware/typed-connection.js';
import { LidarrService } from '../services/lidarr.js';
import { SpotifyService } from '../services/spotify.js';
import { LastfmService } from '../services/lastfm.js';
import { TautulliService } from '../services/tautulli.js';
import { DeezerOAuthService } from '../services/deezer-oauth.js';
import { TidalService } from '../services/tidal.js';
import { SlskdService } from '../services/slskd.js';
import { ListenBrainzService } from '../services/listenbrainz.js';
import { DiscogsService } from '../services/discogs.js';
import type { Prisma } from '@prisma/client';
import { validateBody } from '../middleware/validate.js';
import { createConnectionSchema, updateConnectionSchema, testConnectionSchema } from '../schemas/connection.js';
import { createLogger } from '../lib/logger.js';
import { sanitizeConnectionError } from '../utils/sanitize-error.js';

const logger = createLogger('ConnectionsRoute');

export const connectionsRouter = Router();

// Strategy map for connection test handlers
type ConnectionTestResult = {
  success: boolean;
  message: string;
  details?: any;
  needsAuthorization?: boolean;
};

const connectionTestHandlers: Record<string, (config: Record<string, any>) => Promise<ConnectionTestResult>> = {
  lidarr: async (config) => {
    const service = new LidarrService({
      url: config.url,
      apiKey: config.apiKey,
    });
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? `Connected to Lidarr v${testResult.version}`
        : testResult.error || 'Connection failed',
      details: { version: testResult.version },
    };
  },

  spotify: async (config) => {
    const service = new SpotifyService({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
    });
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? `Connected as ${testResult.user}`
        : testResult.error || 'Connection failed',
      details: { user: testResult.user },
    };
  },

  lastfm: async (config) => {
    const service = new LastfmService({ apiKey: config.apiKey });
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? 'Connected to Last.fm'
        : testResult.error || 'Connection failed',
    };
  },

  tautulli: async (config) => {
    const service = new TautulliService();
    const testResult = await service.testConnection({
      tautulliUrl: config.tautulliUrl,
      tautulliApiKey: config.tautulliApiKey,
    });
    return {
      success: testResult.success,
      message: testResult.success
        ? 'Connected to Tautulli'
        : testResult.error || 'Connection failed',
    };
  },

  jellyfin: async (config) => {
    const { JellyfinService } = await import('../services/jellyfin.js');
    const service = new JellyfinService();
    const testResult = await service.testConnection({
      jellyfinUrl: config.jellyfinUrl,
      jellyfinApiKey: config.jellyfinApiKey,
    });
    return {
      success: testResult.success,
      message: testResult.success
        ? `Connected to ${testResult.serverName || 'Jellyfin'}`
        : testResult.error || 'Connection failed',
    };
  },

  deezer: async (config) => {
    if (!config.accessToken) {
      return {
        success: false,
        message: 'Deezer authorization required. Click "Authorize Deezer" to connect your account.',
        needsAuthorization: true,
      };
    }

    const service = new DeezerOAuthService({
      appId: config.appId,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
    });
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? `Connected as ${testResult.user}`
        : testResult.error || 'Connection failed',
      details: { user: testResult.user },
    };
  },

  tidal: async (config) => {
    if (!config.accessToken || !config.refreshToken) {
      return {
        success: false,
        message: 'TIDAL authorization required. Click "Authorize TIDAL" to connect your account.',
        needsAuthorization: true,
      };
    }

    const service = new TidalService({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      accessToken: config.accessToken,
      refreshToken: config.refreshToken,
    });
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? `Connected as ${testResult.user}`
        : testResult.error || 'Connection failed',
      details: { user: testResult.user },
    };
  },

  listenbrainz: async (config) => {
    try {
      const service = new ListenBrainzService(config.username, config.token);
      const isValid = await service.validateUser();
      return {
        success: isValid,
        message: isValid
          ? `Connected to ListenBrainz as ${config.username}`
          : config.token
            ? 'Invalid token or username mismatch. Verify your token matches your username.'
            : 'User not found on ListenBrainz. Check the username spelling.',
      };
    } catch (error) {
      logger.error('ListenBrainz connection test failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        message: sanitizeConnectionError(error),
      };
    }
  },

  discogs: async (config) => {
    const service = new DiscogsService(config.token);
    const testResult = await service.testConnection();
    return {
      success: testResult.success,
      message: testResult.success
        ? 'Connected to Discogs'
        : testResult.error || 'Connection failed',
    };
  },
};

// PUBLIC ROUTES (no auth required)

// Spotify OAuth callback - must be public as Spotify redirects here
connectionsRouter.get('/:id/spotify/callback', async (req, res) => {
  try {
    const connectionId = parseIntParam(req.params.id);
    if (connectionId === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'invalid_state';
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
        config: updatedConfig as Prisma.InputJsonValue,
        lastTest: new Date(),
      },
    });

    // Redirect to frontend with success - use returnTo if provided
    const returnPath = stateData.returnTo || '/connections';
    const separator = returnPath.includes('?') ? '&' : '?';
    res.redirect(`${baseUrl}${returnPath}${separator}spotify_authorized=${connection.id}`);
  } catch (error) {
    logger.error('Error in Spotify callback', { error });
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Generic connection test endpoint (public - used during setup)
// Routes to the appropriate service based on connection type
connectionsRouter.post('/test', validateBody(testConnectionSchema), async (req, res) => {
  try {
    const { type, url, apiKey, clientId, clientSecret } = req.body;

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

      case 'slskd': {
        if (!url || !apiKey) {
          res.status(400).json({ success: false, error: 'URL and API key required' });
          return;
        }
        const service = new SlskdService({ url, apiKey });
        const testResult = await service.testConnection();
        if (!testResult.success) {
          res.json({ success: false, error: testResult.error || 'Connection failed' });
          return;
        }
        res.json({ success: true, message: `Connected to slskd v${testResult.version}`, version: testResult.version });
        return;
      }

      default:
        res.status(400).json({ success: false, error: `Unknown connection type: ${type}` });
    }
  } catch (error) {
    logger.error('Connection test error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      success: false, 
      error: sanitizeConnectionError(error) 
    });
  }
});

// AUTHENTICATED ROUTES

// All remaining connection routes require authentication
connectionsRouter.use(requireAuth);

// Check if user has a Lidarr connection (user-owned or global)
connectionsRouter.get('/has-lidarr', async (req, res) => {
  try {
    const userId = req.user!.id;
    const lidarrConn = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId, type: 'lidarr', isActive: true },
          { userId: null, type: 'lidarr', isActive: true },
        ],
      },
    });
    res.json({ hasLidarr: !!lidarrConn });
  } catch (error) {
    logger.error('Failed to check Lidarr status', { error, userId: req.user!.id });
    res.status(500).json({ error: 'Failed to check Lidarr status' });
  }
});

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
    logger.error('Failed to fetch connections', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

// Get specific connection (with non-sensitive config)
connectionsRouter.get('/:id', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
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
      safeConfig.monitorNewItems = config.monitorNewItems;
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
    logger.error('Failed to fetch connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch connection' });
  }
});

// Create new connection
connectionsRouter.post('/', validateBody(createConnectionSchema), async (req, res) => {
  try {
    const { type, name, config } = req.body;

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
    logger.error('Failed to create connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to create connection' });
  }
});

// Update connection
connectionsRouter.put('/:id', validateBody(updateConnectionSchema), async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
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
    logger.error('Failed to update connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to update connection' });
  }
});

// Delete connection
connectionsRouter.delete('/:id', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
    
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
    logger.error('Failed to delete connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to delete connection' });
  }
});

// Test connection
connectionsRouter.post('/:id/test', async (req, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }

    const connection = await prisma.connection.findUnique({
      where: { id },
    });

    if (!connection || !canAccessConnection(req, connection)) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    const config = connection.config as Record<string, any>;
    const handler = connectionTestHandlers[connection.type];

    if (!handler) {
      res.json({ success: false, message: `No test handler for type: ${connection.type}` });
      return;
    }

    const result = await handler(config);

    // Update last test timestamp
    await prisma.connection.update({
      where: { id },
      data: { lastTest: new Date() },
    });

    res.json(result);
  } catch (error) {
    logger.error('Failed to test connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      success: false,
      message: sanitizeConnectionError(error),
    });
  }
});

// Get Lidarr options (quality profiles, root folders) for an existing connection
connectionsRouter.get('/:id/lidarr-options', withTypedConnection('lidarr'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig!;
    
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
    logger.error('Lidarr options error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
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
    logger.error('Failed to test Lidarr connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      success: false, 
      message: sanitizeConnectionError(error) 
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
    logger.error('Failed to test Tautulli connection', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      success: false, 
      message: sanitizeConnectionError(error) 
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
    logger.error('Failed to fetch Tautulli users', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
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
    logger.error('Failed to fetch Tautulli libraries', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
    });
  }
});

// Get top artists for a Tautulli connection
connectionsRouter.get('/:id/tautulli/top-artists', withTypedConnection('tautulli'), async (req, res) => {
  try {
    const period = (req.query.period as string) || 'month';
    const limit = parseInt(req.query.limit as string) || 25;

    const config = req.typedConnectionConfig!;
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
    logger.error('Failed to fetch Tautulli top artists', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
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
    logger.error('Failed to fetch Jellyfin users', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
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
    logger.error('Failed to fetch Jellyfin libraries', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ 
      error: sanitizeConnectionError(error) 
    });
  }
});

// Spotify OAuth Routes

// Get Spotify authorization URL for a connection
connectionsRouter.get('/:id/spotify/auth', withTypedConnection('spotify'), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as { clientId?: string; clientSecret?: string };
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
    logger.error('Error getting Spotify auth URL', { error });
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if Spotify connection is authorized
connectionsRouter.get('/:id/spotify/status', withTypedConnection('spotify'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig! as { 
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
    logger.error('Error checking Spotify status', { error });
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke Spotify authorization
connectionsRouter.post('/:id/spotify/revoke', withTypedConnection('spotify', { requireModify: true }), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as Record<string, unknown>;
    
    // Remove tokens from config
    const { accessToken: _accessToken, refreshToken: _refreshToken, tokenExpiresAt: _tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as Prisma.InputJsonValue },
    });

    res.json({ success: true, message: 'Spotify authorization revoked' });
  } catch (error) {
    logger.error('Error revoking Spotify auth', { error });
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Deezer OAuth Routes

// Deezer OAuth callback - must be public as Deezer redirects here
connectionsRouter.get('/:id/deezer/callback', async (req, res) => {
  try {
    const connectionId = parseIntParam(req.params.id);
    if (connectionId === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'invalid_state';
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
        config: updatedConfig as Prisma.InputJsonValue,
        lastTest: new Date(),
      },
    });

    res.redirect(`${baseUrl}/connections?deezer_authorized=${connection.id}`);
  } catch (error) {
    logger.error('Error in Deezer callback', { error });
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Get Deezer authorization URL for a connection
connectionsRouter.get('/:id/deezer/auth', withTypedConnection('deezer'), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as { appId?: string; appSecret?: string };
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
    logger.error('Error getting Deezer auth URL', { error });
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if Deezer connection is authorized
connectionsRouter.get('/:id/deezer/status', withTypedConnection('deezer'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig! as { accessToken?: string };
    const isAuthorized = !!config.accessToken;

    res.json({ 
      authorized: isAuthorized,
      needsReauthorization: !isAuthorized,
    });
  } catch (error) {
    logger.error('Error checking Deezer status', { error });
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke Deezer authorization
connectionsRouter.post('/:id/deezer/revoke', withTypedConnection('deezer', { requireModify: true }), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as Record<string, unknown>;
    // Remove tokens from config
    const { accessToken: _accessToken, tokenExpiresAt: _tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as Prisma.InputJsonValue },
    });

    res.json({ success: true, message: 'Deezer authorization revoked' });
  } catch (error) {
    logger.error('Error revoking Deezer auth', { error });
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Get user's Deezer playlists
connectionsRouter.get('/:id/deezer/playlists', withTypedConnection('deezer'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig! as { appId: string; appSecret: string; accessToken?: string };
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
    logger.error('Error fetching Deezer playlists', { error });
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

// TIDAL OAuth Routes

// TIDAL OAuth callback - must be public as TIDAL redirects here
connectionsRouter.get('/:id/tidal/callback', async (req, res) => {
  try {
    const connectionId = parseIntParam(req.params.id);
    if (connectionId === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }
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
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'invalid_state';
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
        config: updatedConfig as Prisma.InputJsonValue,
        lastTest: new Date(),
      },
    });

    res.redirect(`${baseUrl}/connections?tidal_authorized=${connection.id}`);
  } catch (error) {
    logger.error('Error in TIDAL callback', { error });
    const baseUrl = await getBaseUrl().catch(() => 'http://localhost:3010');
    res.redirect(`${baseUrl}/connections?error=token_exchange_failed`);
  }
});

// Get TIDAL authorization URL for a connection
connectionsRouter.get('/:id/tidal/auth', withTypedConnection('tidal'), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as { clientId?: string; clientSecret?: string };
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
    logger.error('Error getting TIDAL auth URL', { error });
    res.status(500).json({ error: 'Failed to get authorization URL' });
  }
});

// Check if TIDAL connection is authorized
connectionsRouter.get('/:id/tidal/status', withTypedConnection('tidal'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig! as { 
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
    logger.error('Error checking TIDAL status', { error });
    res.status(500).json({ error: 'Failed to check authorization status' });
  }
});

// Revoke TIDAL authorization
connectionsRouter.post('/:id/tidal/revoke', withTypedConnection('tidal', { requireModify: true }), async (req, res) => {
  try {
    const connection = req.typedConnection!;
    const config = req.typedConnectionConfig! as Record<string, unknown>;
    // Remove tokens from config
    const { accessToken: _accessToken, refreshToken: _refreshToken, tokenExpiresAt: _tokenExpiresAt, ...restConfig } = config;

    await prisma.connection.update({
      where: { id: connection.id },
      data: { config: restConfig as Prisma.InputJsonValue },
    });

    res.json({ success: true, message: 'TIDAL authorization revoked' });
  } catch (error) {
    logger.error('Error revoking TIDAL auth', { error });
    res.status(500).json({ error: 'Failed to revoke authorization' });
  }
});

// Get user's TIDAL playlists
connectionsRouter.get('/:id/tidal/playlists', withTypedConnection('tidal'), async (req, res) => {
  try {
    const config = req.typedConnectionConfig! as { 
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
    logger.error('Error fetching TIDAL playlists', { error });
    res.status(500).json({ error: 'Failed to fetch playlists' });
  }
});

