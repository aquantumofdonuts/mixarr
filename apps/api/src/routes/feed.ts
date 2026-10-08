/**
 * Feed Routes - Discovery Feed API
 *
 * Endpoints:
 * - GET /api/feed - Returns paginated feed items
 * - POST /api/feed/:id/approve - Approves a feed item
 * - POST /api/feed/:id/dismiss - Dismisses a feed item
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { FeedService, NotFoundError, ForbiddenError } from '../services/FeedService.js';
import { createLogger } from '../lib/logger.js';
import { getLidarrServiceWithConfig, getLastfmService } from '../lib/connection-resolver.js';
import prisma from '../lib/db.js';
import { restoreDecision, restoreDecisionSchema } from '../lib/decision-undo.js';
import { DecisionError } from '../lib/decision.js';
import { cacheService } from '../services/cache.js';

const logger = createLogger('FeedRoute');

/**
 * Zod schema for query parameters.
 * limit: 1-100, defaults to 50 (values > 100 are capped to 100)
 * offset: >= 0, defaults to 0
 */
const feedQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .default(50)
    .transform((val) => Math.min(val, 100)),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Create feed router with optional dependency injection for testing.
 */
export function feedRouter(feedService?: FeedService): Router {
  const router = Router();
  const service = feedService || new FeedService(undefined, undefined, undefined, cacheService);

  /**
   * Auth middleware - ensures user is authenticated.
   */
  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    next();
  };

  /**
   * GET /api/feed
   * Returns paginated, deduplicated, scored feed items for the authenticated user.
   */
  router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const parsed = feedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({
          error: 'Invalid query parameters',
          details: parsed.error.errors,
        });
        return;
      }

      const { limit, offset } = parsed.data;
      const userId = req.user!.id;

      // Get user's Last.fm service for on-demand metadata enrichment
      const lastfmService = await getLastfmService(userId);

      const feed = await service.getFeedForUser(userId, { limit, offset, lastfmService });
      res.json(feed);
    } catch (error) {
      logger.error('Feed fetch error', { error });
      res.status(500).json({ error: 'Failed to fetch feed' });
    }
  });

  router.post('/restore', requireAuth, async (req: Request, res: Response): Promise<void> => {
    const body = restoreDecisionSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: 'Invalid restoration request' }); return; }
    try {
      res.json(await restoreDecision(prisma, body.data.undoToken, req.user!.id, 'feed-dismiss'));
    } catch (error) {
      if (error instanceof DecisionError) { res.status(error.status).json({ error: error.message, code: error.code }); return; }
      res.status(500).json({ error: 'Failed to restore decision' });
    }
  });

  /**
   * POST /api/feed/:id/approve
   * Approves a feed item, updating status to 'added' and removing from review.
   * Also adds to Lidarr if configured.
   */
  router.post('/:id/approve', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const feedId = req.params.id;
      const userId = req.user!.id;

      // Get user's Lidarr connection for adding artist
      const signal = AbortSignal.timeout(60_000);
      const lidarrResult = await getLidarrServiceWithConfig(userId, signal);
      signal.throwIfAborted();
      
      // Create FeedService with Lidarr integration if available
      const approveService = lidarrResult 
        ? new FeedService(undefined, lidarrResult.service, lidarrResult.config, cacheService)
        : service;

      const result = await approveService.approve(feedId, userId, signal);
      res.json({ success: result.outcome.state === 'added' || result.outcome.state === 'already-in-library', ...result });
    } catch (error) {
      if (error instanceof DecisionError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof ForbiddenError) {
        res.status(403).json({ error: error.message });
        return;
      }
      logger.error('Approve error', { error });
      res.status(500).json({ error: 'Failed to approve' });
    }
  });

  /**
   * POST /api/feed/:id/dismiss
   * Dismisses a feed item, updating status to 'rejected' and removing from review.
   */
  router.post('/:id/dismiss', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
      const feedId = req.params.id;
      const userId = req.user!.id;

      const result = await service.dismiss(feedId, userId);
      res.json({ success: true, ...result });
    } catch (error) {
      if (error instanceof DecisionError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (error instanceof NotFoundError) {
        res.status(404).json({ error: error.message });
        return;
      }
      if (error instanceof ForbiddenError) {
        res.status(403).json({ error: error.message });
        return;
      }
      logger.error('Dismiss error', { error });
      res.status(500).json({ error: 'Failed to dismiss' });
    }
  });

  return router;
}
