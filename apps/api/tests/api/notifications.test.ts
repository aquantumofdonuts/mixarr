/**
 * Notifications API Route Tests
 * 
 * Tests for notification channel management and event listing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Express, Request, Response, NextFunction } from 'express';

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    notificationChannel: {
      findMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, username: 'testuser', role: 'user' } as any;
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
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

// Create app with routes
async function createTestApp(): Promise<Express> {
  const app = express();
  app.use(express.json());
  const { default: notificationsRouter } = await import('../../src/routes/notifications.js');
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('Notifications API', () => {
  let app: Express;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    app = await createTestApp();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/notifications/events', () => {
    it('should return array of raw event strings', async () => {
      const response = await request(app)
        .get('/api/notifications/events')
        .expect(200);
      
      // SOC-006: API should return raw event strings, not formatted objects
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toContain('subscription.completed');
      expect(response.body).toContain('subscription.failed');
      expect(response.body).toContain('review.pending');
      expect(response.body).toContain('artist.added');
      expect(response.body).toContain('artist.failed');
      expect(response.body).toContain('enrichment.completed');
      
      // Should be simple strings, not objects with label/description
      response.body.forEach((event: unknown) => {
        expect(typeof event).toBe('string');
      });
    });
    
    it('should not include frontend formatting data', async () => {
      const response = await request(app)
        .get('/api/notifications/events')
        .expect(200);
      
      // Verify no objects with label/description properties
      response.body.forEach((event: unknown) => {
        expect(event).not.toHaveProperty('label');
        expect(event).not.toHaveProperty('description');
        expect(event).not.toHaveProperty('value');
      });
    });
  });

  describe('GET /api/notifications/channels', () => {
    it('should return empty array when no channels exist', async () => {
      const prisma = await import('../../src/lib/db.js');
      vi.mocked(prisma.default.notificationChannel.findMany).mockResolvedValue([]);
      
      const response = await request(app)
        .get('/api/notifications/channels')
        .expect(200);
      
      expect(response.body).toEqual([]);
    });

    it('should return user channels', async () => {
      const prisma = await import('../../src/lib/db.js');
      const mockChannels = [
        {
          id: 1,
          userId: 1,
          type: 'discord',
          name: 'Test Discord',
          config: { webhookUrl: 'https://discord.com/webhook/123' },
          events: ['subscription.completed'],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      
      vi.mocked(prisma.default.notificationChannel.findMany).mockResolvedValue(mockChannels);
      
      const response = await request(app)
        .get('/api/notifications/channels')
        .expect(200);
      
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Test Discord');
    });

    it('should mask sensitive fields in channel config', async () => {
      const { default: prisma } = await import('../../src/lib/db.js');
      (prisma.notificationChannel.findMany as any).mockResolvedValue([
        {
          id: 1,
          userId: 1,
          type: 'discord',
          name: 'My Discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123456/abcdef-secret-token' },
          events: ['subscription.completed'],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          userId: 1,
          type: 'telegram',
          name: 'My Telegram',
          config: { botToken: '123456:ABC-DEF-secret-token', chatId: '99999' },
          events: ['subscription.failed'],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const res = await request(app).get('/api/notifications/channels');

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      // Discord webhook URL should be masked
      expect(res.body[0].config.webhookUrl).toBe('••••••••');
      // Telegram bot token should be masked, chatId should be visible
      expect(res.body[1].config.botToken).toBe('••••••••');
      expect(res.body[1].config.chatId).toBe('99999');
    });
  });

  describe('POST /api/notifications/channels', () => {
    it('should reject invalid event types', async () => {
      const response = await request(app)
        .post('/api/notifications/channels')
        .send({
          type: 'discord',
          name: 'Test Channel',
          config: { webhookUrl: 'https://discord.com/webhook/123' },
          events: ['invalid.event'],
          isActive: true,
        })
        .expect(400);
      
      expect(response.body.error).toContain('Invalid events');
    });

    it('should create channel with valid data', async () => {
      const prisma = await import('../../src/lib/db.js');
      const mockChannel = {
        id: 1,
        userId: 1,
        type: 'discord',
        name: 'Test Channel',
        config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
        events: ['subscription.completed'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      vi.mocked(prisma.default.notificationChannel.create).mockResolvedValue(mockChannel);
      
      const response = await request(app)
        .post('/api/notifications/channels')
        .send({
          type: 'discord',
          name: 'Test Channel',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['subscription.completed'],
          isActive: true,
        })
        .expect(201);
      
      expect(response.body.name).toBe('Test Channel');
    });
  });
});
