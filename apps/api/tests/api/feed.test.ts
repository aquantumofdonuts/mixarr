/**
 * Feed API Route Tests
 *
 * Tests for the Discovery Feed API endpoints:
 * - GET /api/feed - Returns paginated feed items
 * - POST /api/feed/:id/approve - Approves a feed item
 * - POST /api/feed/:id/dismiss - Dismisses a feed item
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';
import { feedRouter } from '../../src/routes/feed.js';
import { NotFoundError, ForbiddenError } from '../../src/services/FeedService.js';

// Mock connection-resolver to prevent real Lidarr/Last.fm lookup
vi.mock('../../src/lib/connection-resolver.js', () => ({
  getLidarrServiceWithConfig: vi.fn().mockResolvedValue(null),
  getLastfmService: vi.fn().mockResolvedValue(null),
}));

describe('Feed Routes', () => {
  let app: Express;
  let mockFeedService: {
    getFeedForUser: ReturnType<typeof vi.fn>;
    approve: ReturnType<typeof vi.fn>;
    dismiss: ReturnType<typeof vi.fn>;
  };
  let mockUser: { id: number; email: string; role: string };

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockUser = { id: 1, email: 'test@example.com', role: 'user' };
    mockFeedService = {
      getFeedForUser: vi.fn(),
      approve: vi.fn(),
      dismiss: vi.fn(),
    };

    app = express();
    app.use(express.json());
    // Mock auth middleware - attaches user
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as any).user = mockUser;
      next();
    });
    app.use('/api/feed', feedRouter(mockFeedService as any));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/feed', () => {
    it('returns 401 when not authenticated', async () => {
      // Create app without auth user
      const noAuthApp = express();
      noAuthApp.use(express.json());
      noAuthApp.use('/api/feed', feedRouter(mockFeedService as any));

      const response = await request(noAuthApp).get('/api/feed');
      
      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('returns feed items with default pagination', async () => {
      const feedResponse = {
        items: [
          {
            id: 'feed-1',
            artistName: 'Radiohead',
            artistMbid: 'mbid-1',
            imageUrl: null,
            subscriptionCount: 2,
            sourceTypes: ['lastfm_chart'],
            sourceCount: 1,
            linkedResultIds: [1],
            earliestFound: new Date(),
            score: 70,
          },
        ],
        total: 1,
        stats: { pending: 1, addedToday: 0 },
      };
      mockFeedService.getFeedForUser.mockResolvedValue(feedResponse);

      const response = await request(app).get('/api/feed');

      expect(response.status).toBe(200);
      expect(response.body.items).toHaveLength(1);
      expect(response.body.total).toBe(1);
      expect(response.body.stats).toEqual({ pending: 1, addedToday: 0 });
      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 50, offset: 0, lastfmService: null });
    });

    it('accepts custom limit and offset', async () => {
      mockFeedService.getFeedForUser.mockResolvedValue({
        items: [],
        total: 0,
        stats: { pending: 0, addedToday: 0 },
      });

      await request(app).get('/api/feed?limit=20&offset=40');

      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 20, offset: 40, lastfmService: null });
    });

    it('rejects invalid limit (negative)', async () => {
      const response = await request(app).get('/api/feed?limit=-1');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('rejects invalid offset (negative)', async () => {
      const response = await request(app).get('/api/feed?offset=-5');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid query parameters');
    });

    it('caps limit at 100', async () => {
      mockFeedService.getFeedForUser.mockResolvedValue({
        items: [],
        total: 0,
        stats: { pending: 0, addedToday: 0 },
      });

      await request(app).get('/api/feed?limit=500');

      expect(mockFeedService.getFeedForUser).toHaveBeenCalledWith(1, { limit: 100, offset: 0, lastfmService: null });
    });

    it('handles service errors gracefully', async () => {
      mockFeedService.getFeedForUser.mockRejectedValue(new Error('Database error'));

      const response = await request(app).get('/api/feed');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to fetch feed');
    });
  });

  describe('POST /api/feed/:id/approve', () => {
    it('returns 401 when not authenticated', async () => {
      const noAuthApp = express();
      noAuthApp.use(express.json());
      noAuthApp.use('/api/feed', feedRouter(mockFeedService as any));

      const response = await request(noAuthApp).post('/api/feed/feed-1/approve');

      expect(response.status).toBe(401);
    });

    it('approves feed item and returns artist name', async () => {
      mockFeedService.approve.mockResolvedValue({ artistName: 'Radiohead', outcome: { artistMbid: 'a', state: 'added', message: 'Confirmed' } });

      const response = await request(app).post('/api/feed/feed-1-2-3/approve');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true, artistName: 'Radiohead', outcome: { state: 'added' } });
      expect(mockFeedService.approve).toHaveBeenCalledWith('feed-1-2-3', 1, expect.any(AbortSignal), {});
    });

    it('returns 404 when feed item not found', async () => {
      mockFeedService.approve.mockRejectedValue(new NotFoundError('Feed item not found'));

      const response = await request(app).post('/api/feed/feed-999/approve');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Feed item not found');
    });

    it('returns 403 when not authorized', async () => {
      mockFeedService.approve.mockRejectedValue(new ForbiddenError('Not authorized'));

      const response = await request(app).post('/api/feed/feed-1/approve');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Not authorized');
    });

    it('handles unexpected errors', async () => {
      mockFeedService.approve.mockRejectedValue(new Error('Unexpected error'));

      const response = await request(app).post('/api/feed/feed-1/approve');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to approve');
    });
  });

  describe('POST /api/feed/:id/dismiss', () => {
    it('returns 401 when not authenticated', async () => {
      const noAuthApp = express();
      noAuthApp.use(express.json());
      noAuthApp.use('/api/feed', feedRouter(mockFeedService as any));

      const response = await request(noAuthApp).post('/api/feed/feed-1/dismiss');

      expect(response.status).toBe(401);
    });

    it('dismisses feed item and returns artist name', async () => {
      mockFeedService.dismiss.mockResolvedValue({ artistName: 'Coldplay' });

      const response = await request(app).post('/api/feed/feed-1/dismiss');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true, artistName: 'Coldplay' });
      expect(mockFeedService.dismiss).toHaveBeenCalledWith('feed-1', 1);
    });

    it('returns 404 when feed item not found', async () => {
      mockFeedService.dismiss.mockRejectedValue(new NotFoundError('Feed item not found'));

      const response = await request(app).post('/api/feed/feed-invalid/dismiss');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Feed item not found');
    });

    it('returns 403 when not authorized', async () => {
      mockFeedService.dismiss.mockRejectedValue(new ForbiddenError('Not authorized'));

      const response = await request(app).post('/api/feed/feed-1/dismiss');

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Not authorized');
    });

    it('handles unexpected errors', async () => {
      mockFeedService.dismiss.mockRejectedValue(new Error('Database connection lost'));

      const response = await request(app).post('/api/feed/feed-1/dismiss');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to dismiss');
    });
  });
});
