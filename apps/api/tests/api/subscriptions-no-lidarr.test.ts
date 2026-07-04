/**
 * Subscriptions API Tests - No Lidarr Mode
 *
 * Tests that subscription preview/results endpoint works without Lidarr:
 * - GET /:id/results returns results without Lidarr
 * - Results don't have inLibrary field when no Lidarr
 * - Results have inLibrary field when Lidarr is available
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma with hoisted factory
vi.mock('../../src/lib/db.js', () => ({
  default: {
    subscription: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    subscriptionResult: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
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

// Mock artist image service - prevents real Redis/Deezer calls in tests
vi.mock('../../src/services/artist-images.js', () => ({
  getArtistImages: vi.fn().mockResolvedValue(new Map()),
  normalizeArtistName: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')),
}));

// Mock Lidarr service as a class
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class MockLidarrService {
    async getArtists() {
      return [
        { artistName: 'Pink Floyd' },
        { artistName: 'The Beatles' },
      ];
    }
    async artistExists() { return false; }
  },
  LidarrCache: class MockLidarrCache {
    async exists() { return false; }
    async get() { return null; }
    async refresh() {}
  },
  getSharedLidarrCache: vi.fn(() => ({
    // Pink Floyd is "in library"; all other artists are not.
    exists: vi.fn(({ name }: { name: string; mbid?: string }) => Promise.resolve(name === 'Pink Floyd')),
    get: vi.fn().mockResolvedValue(null),
    refresh: vi.fn().mockResolvedValue(undefined),
  })),
  invalidateLidarrCache: vi.fn(),
}));

// Mock Deezer image fetching
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'testuser', role: 'user' };
    next();
  }),
}));

// Mock validation middleware
vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req: any, _res: any, next: any) => next(),
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

// Mock notifications
vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    notify: vi.fn(),
  },
}));

// Import after mocks
import { subscriptionsRouter } from '../../src/routes/subscriptions.js';
import prisma from '../../src/lib/db.js';

describe('Subscriptions API - No Lidarr Mode', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    app.use('/api/subscriptions', subscriptionsRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/subscriptions/:id/results (Preview)', () => {
    const mockSubscription = {
      id: 1,
      userId: 1,
      name: 'Test Subscription',
      type: 'lastfm_chart',
      config: {},
      isActive: true,
    };

    const mockResults = [
      {
        id: 1,
        subscriptionId: 1,
        name: 'Pink Floyd',
        itemType: 'artist',
        status: 'pending',
        mbid: 'mbid-1',
        createdAt: new Date(),
      },
      {
        id: 2,
        subscriptionId: 1,
        name: 'Led Zeppelin',
        itemType: 'artist',
        status: 'pending',
        mbid: 'mbid-2',
        createdAt: new Date(),
      },
    ];

    it('should return results without Lidarr connection', async () => {
      // Setup: subscription exists, no Lidarr connection
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(mockSubscription as any);
      vi.mocked(prisma.subscriptionResult.findMany).mockResolvedValue(mockResults as any);
      vi.mocked(prisma.subscriptionResult.count).mockResolvedValue(2);
      vi.mocked(prisma.subscriptionResult.groupBy).mockResolvedValue([
        { status: 'pending', _count: { status: 2 } },
      ] as any);
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null); // No Lidarr

      const response = await request(app)
        .get('/api/subscriptions/1/results')
        .expect(200);

      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0].name).toBe('Pink Floyd');
      expect(response.body.results[1].name).toBe('Led Zeppelin');
    });

    it('should NOT have inLibrary field when no Lidarr connection', async () => {
      // Setup: subscription exists, no Lidarr connection
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(mockSubscription as any);
      vi.mocked(prisma.subscriptionResult.findMany).mockResolvedValue(mockResults as any);
      vi.mocked(prisma.subscriptionResult.count).mockResolvedValue(2);
      vi.mocked(prisma.subscriptionResult.groupBy).mockResolvedValue([
        { status: 'pending', _count: { status: 2 } },
      ] as any);
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null); // No Lidarr

      const response = await request(app)
        .get('/api/subscriptions/1/results')
        .expect(200);

      // inLibrary should be absent, not false or undefined
      expect(response.body.results[0]).not.toHaveProperty('inLibrary');
      expect(response.body.results[1]).not.toHaveProperty('inLibrary');
    });

    it('should have inLibrary field when Lidarr is connected', async () => {
      // Setup: subscription exists, Lidarr connected
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(mockSubscription as any);
      vi.mocked(prisma.subscriptionResult.findMany).mockResolvedValue(mockResults as any);
      vi.mocked(prisma.subscriptionResult.count).mockResolvedValue(2);
      vi.mocked(prisma.subscriptionResult.groupBy).mockResolvedValue([
        { status: 'pending', _count: { status: 2 } },
      ] as any);
      vi.mocked(prisma.connection.findFirst).mockResolvedValue({
        id: 1,
        type: 'lidarr',
        isActive: true,
        config: { url: 'http://localhost:8686', apiKey: 'test-key' },
      } as any);

      const response = await request(app)
        .get('/api/subscriptions/1/results')
        .expect(200);

      // Pink Floyd should be inLibrary: true (mocked in LidarrService)
      expect(response.body.results[0]).toHaveProperty('inLibrary', true);
      // Led Zeppelin should be inLibrary: false
      expect(response.body.results[1]).toHaveProperty('inLibrary', false);
    });

    it('should not block the endpoint when Lidarr is unavailable', async () => {
      // Setup: subscription exists, no Lidarr
      vi.mocked(prisma.subscription.findUnique).mockResolvedValue(mockSubscription as any);
      vi.mocked(prisma.subscriptionResult.findMany).mockResolvedValue(mockResults as any);
      vi.mocked(prisma.subscriptionResult.count).mockResolvedValue(2);
      vi.mocked(prisma.subscriptionResult.groupBy).mockResolvedValue([] as any);
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

      const response = await request(app)
        .get('/api/subscriptions/1/results');

      // Should NOT return 400 error about Lidarr
      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('No active Lidarr connection');
      expect(response.status).toBe(200);
    });
  });
});
