import { Router } from 'express';
import prisma from '../lib/db.js';
import { redis } from '../lib/redis.js';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '2.0.0',
  });
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
