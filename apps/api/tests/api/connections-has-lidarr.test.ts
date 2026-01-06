/**
 * GET /api/connections/has-lidarr Integration Tests
 * 
 * Tests the endpoint that checks if user has a Lidarr connection.
 * Used by frontend to conditionally show/hide Lidarr-dependent features.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createMockLidarrConnection } from '../utils/fixtures.js';

// Mock prisma before any imports
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock logger to avoid console noise
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock auth middleware to inject user into requests
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'testuser', role: 'user' };
    next();
  }),
}));

// Mock services that connections.ts imports
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: vi.fn(),
}));

vi.mock('../../src/services/spotify.js', () => ({
  SpotifyService: vi.fn(),
}));

vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: vi.fn(),
}));

vi.mock('../../src/services/tautulli.js', () => ({
  TautulliService: vi.fn(),
}));

vi.mock('../../src/services/deezer-oauth.js', () => ({
  DeezerOAuthService: vi.fn(),
}));

vi.mock('../../src/services/tidal.js', () => ({
  TidalService: vi.fn(),
}));

vi.mock('../../src/services/listenbrainz.js', () => ({
  ListenBrainzService: vi.fn(),
}));

vi.mock('../../src/services/discogs.js', () => ({
  DiscogsService: vi.fn(),
}));

vi.mock('../../src/lib/settings.js', () => ({
  getBaseUrl: vi.fn().mockReturnValue('http://localhost:3005'),
}));

vi.mock('../../src/lib/oauth-state.js', () => ({
  createSignedState: vi.fn(),
  verifySignedState: vi.fn(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../src/schemas/connection.js', () => ({
  createConnectionSchema: {},
  updateConnectionSchema: {},
  testConnectionSchema: {},
}));

// Import after mocks are set up
import prisma from '../../src/lib/db.js';
import { connectionsRouter } from '../../src/routes/connections.js';

const app = express();
app.use(express.json());
app.use('/api/connections', connectionsRouter);

describe('GET /api/connections/has-lidarr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return hasLidarr: true when user has a Lidarr connection', async () => {
    const userLidarr = createMockLidarrConnection(1);
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(userLidarr);

    const response = await request(app).get('/api/connections/has-lidarr');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasLidarr: true });
  });

  it('should return hasLidarr: false when user has no Lidarr connection', async () => {
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

    const response = await request(app).get('/api/connections/has-lidarr');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasLidarr: false });
  });

  it('should consider global Lidarr connections (userId: null)', async () => {
    const globalLidarr = createMockLidarrConnection(null);
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(globalLidarr);

    const response = await request(app).get('/api/connections/has-lidarr');
    
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ hasLidarr: true });
    
    // Verify the query includes both user's own and global Lidarr
    expect(prisma.connection.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 1, type: 'lidarr', isActive: true },
          { userId: null, type: 'lidarr', isActive: true },
        ],
      },
    });
  });

  it('should return 500 on database error', async () => {
    vi.mocked(prisma.connection.findFirst).mockRejectedValue(new Error('DB error'));

    const response = await request(app).get('/api/connections/has-lidarr');
    
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to check Lidarr status' });
  });
});
