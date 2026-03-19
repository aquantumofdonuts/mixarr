import { Router } from 'express';
import prisma from '../lib/db.js';
import { redis } from '../lib/redis.js';
import { getUpdateStatus } from '../services/update-checker.js';
import { VERSION } from '../version.js';

export const healthRouter = Router();

// Basic liveness check - always returns 200 if process is running
healthRouter.get('/live', async (_req, res) => {
  const update = await getUpdateStatus();
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    version: VERSION,
    update: update?.available ? { latest: update.latest, url: update.url } : null,
  });
});

// Full health check - returns 503 if dependencies are down
// Use this for Docker HEALTHCHECK and orchestrator probes
healthRouter.get('/', async (_req, res) => {
  const health = {
    status: 'ok' as 'ok' | 'error',
    db: false,
    redis: false,
    timestamp: new Date().toISOString(),
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.db = true;
  } catch {
    health.status = 'error';
  }

  try {
    await redis.ping();
    health.redis = true;
  } catch {
    health.status = 'error';
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

healthRouter.get('/ready', async (_req, res) => {
  const services: Record<string, 'connected' | 'disconnected'> = {
    database: 'disconnected',
    redis: 'disconnected',
  };

  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;
    services.database = 'connected';
  } catch (error) {
    // Database is down
  }

  try {
    // Check Redis connection
    await redis.ping();
    services.redis = 'connected';
  } catch (error) {
    // Redis is down
  }

  const allHealthy = services.database === 'connected' && services.redis === 'connected';

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'not ready',
    services,
  });
});
