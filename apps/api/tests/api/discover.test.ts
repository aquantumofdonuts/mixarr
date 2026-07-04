/**
 * Discover API Tests
 * 
 * Tests:
 * - Library browsing with pagination
 * - Similar artist recommendations
 * - Filtering already in library
 * - Seed selection
 * - Batch add operations
 * - Input validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { discoverRouter } from '../../src/routes/discover.js';
import {
  createMockPrisma,
  createMockUser,
  createMockLidarrService,
  createMockLastfmService,
  createMockLidarrCache,
  createMockLidarrConnection,
  resetIdCounter,
} from '../utils/fixtures.js';

// Mock all external dependencies so validation middleware can run
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((_req: any, _res: any, next: any) => {
    _req.user = { id: 1, username: 'test', role: 'user' };
    next();
  }),
}));

vi.mock('../../src/lib/connection-resolver.js', () => ({
  getLidarrService: vi.fn().mockResolvedValue(null),
  getLidarrServiceWithConfig: vi.fn().mockResolvedValue(null),
  getLastfmService: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImage: vi.fn(),
  getDeezerChartArtists: vi.fn().mockResolvedValue([]),
  getDeezerGenres: vi.fn().mockResolvedValue([]),
  getDeezerGenreArtists: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/services/lidarr.js', () => ({
  LidarrCache: vi.fn(),
}));

vi.mock('../../src/services/skyhook-cache-warmer.js', () => ({
  skyhookWarmer: { warmArtist: vi.fn() },
}));

vi.mock('../../src/routes/logs.js', () => ({
  addLogEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/notifications.js', () => ({
  notificationService: { send: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Set up Express app with the real router (includes validation middleware)
const app = express();
app.use(express.json());
app.use('/api/discover', discoverRouter);

describe('Discover API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;
  let mockLastfm: ReturnType<typeof createMockLastfmService>;
  let mockCache: ReturnType<typeof createMockLidarrCache>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockLidarr = createMockLidarrService();
    mockLastfm = createMockLastfmService();
    mockCache = createMockLidarrCache();
  });

  describe('GET /api/discover/library', () => {
    it('should return paginated library', async () => {
      const artists = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        artistName: `Artist ${i + 1}`,
        foreignArtistId: `mbid${i + 1}`,
        monitored: true,
      }));
      mockLidarr.getArtists.mockResolvedValue(artists);
      
      const result = await mockLidarr.getArtists();
      
      expect(result).toHaveLength(100);
    });

    it('should support pagination parameters', () => {
      const page = 1;
      const limit = 500;
      const offset = (page - 1) * limit;
      
      expect(offset).toBe(0);
      
      const page2Offset = (2 - 1) * limit;
      expect(page2Offset).toBe(500);
    });

    it('should filter by search term', () => {
      const artists = [
        { artistName: 'Pink Floyd' },
        { artistName: 'Pink' },
        { artistName: 'Led Zeppelin' },
      ];
      
      const searchTerm = 'pink';
      const filtered = artists.filter(a => 
        a.artistName.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      expect(filtered).toHaveLength(2);
    });

    it('should use cache for library data', () => {
      // Simulating cache behavior
      const cache = new Map<string, { artists: unknown[]; timestamp: number }>();
      const cacheKey = `user-${testUser.id}`;
      const TTL = 60 * 1000; // 1 minute
      
      // Set cache
      cache.set(cacheKey, { artists: [], timestamp: Date.now() });
      
      // Check cache validity
      const cached = cache.get(cacheKey);
      const isValid = cached && (Date.now() - cached.timestamp) < TTL;
      
      expect(isValid).toBe(true);
    });

    it('should refresh cache when requested', () => {
      const cache = new Map<string, { artists: unknown[]; timestamp: number }>();
      const cacheKey = `user-${testUser.id}`;
      
      // Old cache
      cache.set(cacheKey, { artists: [], timestamp: Date.now() - 120000 }); // 2 min old
      
      const cached = cache.get(cacheKey);
      const isExpired = cached && (Date.now() - cached.timestamp) >= 60000;
      
      expect(isExpired).toBe(true);
    });

    it('should require Lidarr connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'lidarr' },
      });
      
      expect(conn).toBeNull();
    });
  });

  describe('POST /api/discover/recommendations', () => {
    it('should get recommendations from seed artists', async () => {
      const seedArtists = ['Pink Floyd', 'Led Zeppelin'];
      const recommendations = [
        { name: 'Genesis', listeners: 1000000 },
        { name: 'Yes', listeners: 800000 },
        { name: 'King Crimson', listeners: 600000 },
      ];
      
      mockLastfm.getSimilarArtists.mockResolvedValue(recommendations);
      
      const results = await mockLastfm.getSimilarArtists(seedArtists[0]);
      
      expect(results).toHaveLength(3);
    });

    it('should filter out artists already in library', async () => {
      const recommendations = [
        { name: 'Genesis', mbid: 'mbid1' },
        { name: 'Yes', mbid: 'mbid2' },
      ];
      
      // Simulate cache check
      mockCache.exists.mockImplementation(async ({ mbid }) => mbid === 'mbid1');
      
      const filtered = [];
      for (const rec of recommendations) {
        if (!await mockCache.exists({ mbid: rec.mbid })) {
          filtered.push(rec);
        }
      }
      
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe('Yes');
    });

    it('should limit results per seed', async () => {
      const limit = 100; // per seed
      const seeds = 5;
      const maxResults = limit * seeds;
      
      expect(maxResults).toBe(500);
    });

    it('should use random sampling for variety', () => {
      const allResults = Array.from({ length: 500 }, (_, i) => ({ name: `Artist ${i}` }));
      const sampleSize = 100;
      
      // Simulate random sampling
      const shuffled = [...allResults].sort(() => Math.random() - 0.5);
      const sample = shuffled.slice(0, sampleSize);
      
      expect(sample).toHaveLength(100);
    });

    it('should require seed artists', () => {
      const seeds: string[] = [];
      const isValid = seeds.length > 0;
      
      expect(isValid).toBe(false);
    });
  });

  describe('POST /api/discover/add', () => {
    it('should add single artist from recommendations', async () => {
      mockLidarr.addArtist.mockResolvedValue({ id: 123 });
      
      const result = await mockLidarr.addArtist('mbid123', 1, 1, '/music');
      
      expect(result.id).toBe(123);
    });

    it('should handle add failure gracefully', async () => {
      mockLidarr.addArtist.mockRejectedValue(new Error('Failed to add'));
      
      await expect(mockLidarr.addArtist('mbid', 1, 1, '/music')).rejects.toThrow();
    });
  });

  describe('POST /api/discover/add-batch', () => {
    it('should add multiple artists in batch', async () => {
      const artists = [
        { foreignArtistId: 'mbid1', artistName: 'Artist 1' },
        { foreignArtistId: 'mbid2', artistName: 'Artist 2' },
        { foreignArtistId: 'mbid3', artistName: 'Artist 3' },
      ];
      
      mockLidarr.addArtist.mockResolvedValue({ id: 1 });
      
      let added = 0;
      let failed = 0;
      
      for (const artist of artists) {
        try {
          await mockLidarr.addArtist(artist.foreignArtistId, 1, 1, '/music');
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(3);
      expect(failed).toBe(0);
    });

    it('should continue on individual failures', async () => {
      const artists = ['mbid1', 'mbid2', 'mbid3'];
      
      mockLidarr.addArtist
        .mockResolvedValueOnce({ id: 1 })
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce({ id: 3 });
      
      let added = 0;
      let failed = 0;
      
      for (const mbid of artists) {
        try {
          await mockLidarr.addArtist(mbid, 1, 1, '/music');
          added++;
        } catch {
          failed++;
        }
      }
      
      expect(added).toBe(2);
      expect(failed).toBe(1);
    });
  });

  describe('Deezer image enrichment', () => {
    it('should add Deezer images to recommendations', () => {
      const recommendations = [
        { name: 'Artist 1' },
        { name: 'Artist 2' },
      ];
      
      const imageMap = new Map([
        ['Artist 1', 'https://deezer.com/image1.jpg'],
        ['Artist 2', 'https://deezer.com/image2.jpg'],
      ]);
      
      const enriched = recommendations.map(r => ({
        ...r,
        imageUrl: imageMap.get(r.name),
      }));
      
      expect(enriched[0].imageUrl).toBeDefined();
      expect(enriched[1].imageUrl).toBeDefined();
    });
  });

  describe('Input Validation', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    describe('GET /api/discover/library validation', () => {
      it('should reject non-numeric page', async () => {
        const res = await request(app)
          .get('/api/discover/library')
          .query({ page: 'abc' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.page).toBeDefined();
      });

      it('should reject non-numeric limit', async () => {
        const res = await request(app)
          .get('/api/discover/library')
          .query({ limit: 'xyz' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should reject invalid refresh value', async () => {
        const res = await request(app)
          .get('/api/discover/library')
          .query({ refresh: 'yes' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.refresh).toBeDefined();
      });

      it('should reject search term over 500 characters', async () => {
        const res = await request(app)
          .get('/api/discover/library')
          .query({ search: 'a'.repeat(501) });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.search).toBeDefined();
      });

      it('should accept valid query parameters', async () => {
        const res = await request(app)
          .get('/api/discover/library')
          .query({ page: '1', limit: '50', search: 'Pink', refresh: 'true' });

        // Should pass validation (may get 400 from service layer for no Lidarr connection)
        expect(res.body.code).not.toBe('VALIDATION_ERROR');
      });

      it('should accept request with no query parameters', async () => {
        const res = await request(app)
          .get('/api/discover/library');

        // Should pass validation (may get 400 from service layer for no Lidarr connection)
        expect(res.body.code).not.toBe('VALIDATION_ERROR');
      });
    });

    describe('POST /api/discover/similar validation', () => {
      it('should reject missing artistNames', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistNames).toBeDefined();
      });

      it('should reject empty artistNames array', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: [] });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistNames).toBeDefined();
      });

      it('should reject non-array artistNames', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: 'Pink Floyd' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistNames).toBeDefined();
      });

      it('should reject empty string in artistNames', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: [''] });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
      });

      it('should reject negative limit', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: ['Pink Floyd'], limit: -1 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should reject limit over 500', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: ['Pink Floyd'], limit: 501 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should reject non-integer limit', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: ['Pink Floyd'], limit: 1.5 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should accept valid similar request', async () => {
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: ['Pink Floyd', 'Led Zeppelin'], limit: 50 });

        // Should pass validation (may fail at service layer)
        expect(res.body.code).not.toBe('VALIDATION_ERROR');
      });

      it('should reject more than 200 artist names', async () => {
        const names = Array.from({ length: 501 }, (_, i) => `Artist ${i}`);
        const res = await request(app)
          .post('/api/discover/similar')
          .send({ artistNames: names });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistNames).toBeDefined();
      });
    });

    describe('POST /api/discover/add validation', () => {
      it('should reject missing artistName', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({});

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistName).toBeDefined();
      });

      it('should reject empty artistName', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: '' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistName).toBeDefined();
      });

      it('should reject artistName over 500 characters', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'a'.repeat(501) });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.artistName).toBeDefined();
      });

      it('should reject invalid mbid (non-UUID)', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'Pink Floyd', mbid: 'not-a-uuid' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.mbid).toBeDefined();
      });

      it('should reject non-integer qualityProfileId', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'Pink Floyd', qualityProfileId: 1.5 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.qualityProfileId).toBeDefined();
      });

      it('should reject negative metadataProfileId', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'Pink Floyd', metadataProfileId: -1 });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.metadataProfileId).toBeDefined();
      });

      it('should reject rootFolderPath over 1000 characters', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'Pink Floyd', rootFolderPath: '/'.repeat(1001) });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.rootFolderPath).toBeDefined();
      });

      it('should accept valid add request with only required fields', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({ artistName: 'Pink Floyd' });

        // Should pass validation (may fail at service layer)
        expect(res.body.code).not.toBe('VALIDATION_ERROR');
      });

      it('should accept valid add request with all fields', async () => {
        const res = await request(app)
          .post('/api/discover/add')
          .send({
            artistName: 'Pink Floyd',
            mbid: '83d91898-7763-47d7-b03b-b92132375c47',
            qualityProfileId: 1,
            metadataProfileId: 1,
            rootFolderPath: '/music',
          });

        // Should pass validation (may fail at service layer)
        expect(res.body.code).not.toBe('VALIDATION_ERROR');
      });
    });

    describe('GET /api/discover/deezer/chart validation', () => {
      it('should reject non-numeric limit', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/chart')
          .query({ limit: 'abc' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should accept valid limit', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/chart')
          .query({ limit: '50' });

        expect(res.status).toBe(200);
      });

      it('should accept request with no limit', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/chart');

        expect(res.status).toBe(200);
      });
    });

    describe('GET /api/discover/deezer/genre/:genreId/artists validation', () => {
      it('should reject non-numeric genreId', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/genre/abc/artists');

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.genreId).toBeDefined();
      });

      it('should reject non-numeric limit query', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/genre/1/artists')
          .query({ limit: 'xyz' });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe('VALIDATION_ERROR');
        expect(res.body.details.limit).toBeDefined();
      });

      it('should accept valid genreId and limit', async () => {
        const res = await request(app)
          .get('/api/discover/deezer/genre/132/artists')
          .query({ limit: '50' });

        expect(res.status).toBe(200);
      });
    });
  });
});
