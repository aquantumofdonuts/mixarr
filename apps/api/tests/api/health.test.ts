import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma before imports
vi.mock('../../src/lib/db.js', () => ({
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock redis before imports
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    ping: vi.fn(),
  },
}));

describe('Health Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('GET /ready', () => {
    it('returns 200 when database and redis are healthy', async () => {
      const prisma = await import('../../src/lib/db.js');
      const { redis } = await import('../../src/lib/redis.js');
      
      vi.mocked(prisma.default.$queryRaw).mockResolvedValue([{ 1: 1 }]);
      vi.mocked(redis.ping).mockResolvedValue('PONG');

      const { healthRouter } = await import('../../src/routes/health.js');
      
      const app = express();
      app.use('/health', healthRouter);

      const response = await request(app).get('/health/ready');
      
      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ready');
      expect(response.body.services.database).toBe('connected');
      expect(response.body.services.redis).toBe('connected');
    });

    it('returns 503 when database is down', async () => {
      const prisma = await import('../../src/lib/db.js');
      const { redis } = await import('../../src/lib/redis.js');
      
      vi.mocked(prisma.default.$queryRaw).mockRejectedValue(new Error('Connection refused'));
      vi.mocked(redis.ping).mockResolvedValue('PONG');

      const { healthRouter } = await import('../../src/routes/health.js');
      
      const app = express();
      app.use('/health', healthRouter);

      const response = await request(app).get('/health/ready');
      
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not ready');
      expect(response.body.services.database).toBe('disconnected');
      expect(response.body.services.redis).toBe('connected');
    });

    it('returns 503 when redis is down', async () => {
      const prisma = await import('../../src/lib/db.js');
      const { redis } = await import('../../src/lib/redis.js');
      
      vi.mocked(prisma.default.$queryRaw).mockResolvedValue([{ 1: 1 }]);
      vi.mocked(redis.ping).mockRejectedValue(new Error('Connection refused'));

      const { healthRouter } = await import('../../src/routes/health.js');
      
      const app = express();
      app.use('/health', healthRouter);

      const response = await request(app).get('/health/ready');
      
      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not ready');
      expect(response.body.services.database).toBe('connected');
      expect(response.body.services.redis).toBe('disconnected');
    });
  });
});

