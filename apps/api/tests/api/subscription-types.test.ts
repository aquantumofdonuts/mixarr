/**
 * Subscription Types API Tests
 * 
 * Tests for GET /api/subscriptions/types endpoint
 * This endpoint returns subscription type metadata for the frontend.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    subscription: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, username: 'testuser', role: 'user' } as any;
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock validation middleware
vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock scheduler
vi.mock('../../src/jobs/scheduler.js', () => ({
  addScheduledJob: vi.fn(),
  removeScheduledJob: vi.fn(),
}));

// Mock MusicBrainz
vi.mock('../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: vi.fn(),
}));

// Mock Deezer
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

// Mock Lidarr
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class MockLidarrService {
    async getArtists() {
      return [];
    }
  },
}));

// Mock notifications
vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    notify: vi.fn(),
  },
}));

// Create app with routes
async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { subscriptionsRouter } = await import('../../src/routes/subscriptions.js');
  app.use('/api/subscriptions', subscriptionsRouter);
  return app;
}

describe('Subscription Types API', () => {
  let app: Express;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/subscriptions/types', () => {
    it('should return array of subscription type metadata', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
    });
    
    it('should include required metadata fields for each type', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      // Each type should have value, label, description, icon
      response.body.forEach((type: any) => {
        expect(type).toHaveProperty('value');
        expect(type).toHaveProperty('label');
        expect(type).toHaveProperty('description');
        expect(type).toHaveProperty('icon');
        expect(typeof type.value).toBe('string');
        expect(typeof type.label).toBe('string');
        expect(typeof type.icon).toBe('string');
      });
    });
    
    it('should include lastfm_chart type', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      const lastfmChart = response.body.find((t: any) => t.value === 'lastfm_chart');
      expect(lastfmChart).toBeDefined();
      expect(lastfmChart.label).toBe('Last.fm Charts');
    });
    
    it('should include spotify_playlist type', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      const spotifyPlaylist = response.body.find((t: any) => t.value === 'spotify_playlist');
      expect(spotifyPlaylist).toBeDefined();
      expect(spotifyPlaylist.label).toBe('Spotify Playlist');
    });
    
    it('should include required fields where applicable', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      // spotify_playlist should have requiredFields
      const spotifyPlaylist = response.body.find((t: any) => t.value === 'spotify_playlist');
      expect(spotifyPlaylist).toHaveProperty('requiredFields');
      expect(Array.isArray(spotifyPlaylist.requiredFields)).toBe(true);
      
      // lastfm_tag should have requiredFields for tag
      const lastfmTag = response.body.find((t: any) => t.value === 'lastfm_tag');
      expect(lastfmTag).toHaveProperty('requiredFields');
      const tagField = lastfmTag.requiredFields.find((f: any) => f.field === 'tag');
      expect(tagField).toBeDefined();
    });
    
    it('should include warnings where applicable', async () => {
      const response = await request(app)
        .get('/api/subscriptions/types')
        .expect(200);
      
      // spotify_discover_weekly should have a warning
      const discoverWeekly = response.body.find((t: any) => t.value === 'spotify_discover_weekly');
      expect(discoverWeekly).toHaveProperty('warning');
      expect(typeof discoverWeekly.warning).toBe('string');
    });
  });
});
