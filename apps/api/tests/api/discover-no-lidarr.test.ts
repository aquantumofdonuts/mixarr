/**
 * Discover API Tests - No Lidarr Mode
 *
 * Tests that discover endpoints return helpful error messages when Lidarr is not connected.
 * Unlike search, discover fundamentally requires Lidarr because it browses your library.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma before any imports - NO Lidarr connection, but Last.fm available
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findFirst: vi.fn().mockImplementation((query: any) => {
        // Return Last.fm connection if querying for lastfm type
        if (query?.where?.type === 'lastfm' || 
            (query?.where?.OR && query.where.OR.some((c: any) => c.type === 'lastfm'))) {
          return Promise.resolve({
            id: 1,
            userId: 1,
            type: 'lastfm',
            isActive: true,
            config: { apiKey: 'test-api-key' },
          });
        }
        // Return null for Lidarr connections
        return Promise.resolve(null);
      }),
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

// Mock Lidarr service - should never be instantiated without connection
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: vi.fn(),
  LidarrCache: vi.fn(),
}));

// Mock Last.fm service as a class
vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: class MockLastfmService {
    async getSimilarArtists() {
      return [];
    }
  },
}));

// Mock Deezer service
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImage: vi.fn().mockResolvedValue(null),
  getDeezerGenres: vi.fn().mockResolvedValue([]),
  getDeezerChartArtists: vi.fn().mockResolvedValue([]),
  getDeezerGenreArtists: vi.fn().mockResolvedValue([]),
}));

// Mock logs
vi.mock('../../src/routes/logs.js', () => ({
  addLogEntry: vi.fn().mockResolvedValue(undefined),
}));

// Mock notification service
vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

// Import after mocks are set up
import { discoverRouter } from '../../src/routes/discover.js';

const app = express();
app.use(express.json());
app.use('/api/discover', discoverRouter);

describe('Discover API - No Lidarr Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/discover/library', () => {
    it('should return 400 with LIDARR_REQUIRED code when no Lidarr connection', async () => {
      const response = await request(app)
        .get('/api/discover/library');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LIDARR_REQUIRED');
      expect(response.body.error).toBe('Discover requires a Lidarr connection');
      expect(response.body.message).toBe('Connect Lidarr to browse and discover from your library');
    });

    it('should return a helpful error message for the frontend', async () => {
      const response = await request(app)
        .get('/api/discover/library');

      expect(response.status).toBe(400);
      // Verify all required fields are present for frontend handling
      expect(response.body).toHaveProperty('error');
      expect(response.body).toHaveProperty('code');
      expect(response.body).toHaveProperty('message');
    });
  });

  describe('POST /api/discover/similar', () => {
    it('should return 400 with LIDARR_REQUIRED code when no Lidarr connection', async () => {
      const response = await request(app)
        .post('/api/discover/similar')
        .send({ artistNames: ['Pink Floyd'] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LIDARR_REQUIRED');
      expect(response.body.error).toBe('Discover requires a Lidarr connection');
      expect(response.body.message).toBe('Connect Lidarr to browse and discover from your library');
    });
  });

  describe('POST /api/discover/add', () => {
    it('should return 400 with LIDARR_REQUIRED code when no Lidarr connection', async () => {
      const response = await request(app)
        .post('/api/discover/add')
        .send({ artistName: 'Pink Floyd' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LIDARR_REQUIRED');
      expect(response.body.error).toBe('Discover requires a Lidarr connection');
      expect(response.body.message).toBe('Connect Lidarr to browse and discover from your library');
    });
  });

  describe('GET /api/discover/profiles', () => {
    it('should return 400 with LIDARR_REQUIRED code when no Lidarr connection', async () => {
      const response = await request(app)
        .get('/api/discover/profiles');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('LIDARR_REQUIRED');
      expect(response.body.error).toBe('Discover requires a Lidarr connection');
      expect(response.body.message).toBe('Connect Lidarr to browse and discover from your library');
    });
  });

  describe('Deezer endpoints (should work without Lidarr)', () => {
    it('GET /api/discover/deezer/genres should not require Lidarr', async () => {
      const response = await request(app)
        .get('/api/discover/deezer/genres');

      // Should succeed (not 400 LIDARR_REQUIRED)
      expect(response.status).not.toBe(400);
      expect(response.body.code).not.toBe('LIDARR_REQUIRED');
    });

    it('GET /api/discover/deezer/chart should not require Lidarr', async () => {
      const response = await request(app)
        .get('/api/discover/deezer/chart');

      // Should succeed (not 400 LIDARR_REQUIRED)
      expect(response.status).not.toBe(400);
      expect(response.body.code).not.toBe('LIDARR_REQUIRED');
    });
  });
});
