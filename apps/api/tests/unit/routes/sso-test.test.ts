import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ssoRouter } from '../../../src/routes/sso.js';

// Mock auth middleware
vi.mock('../../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Mock prisma
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    ssoProvider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import prisma from '../../../src/lib/db.js';

describe('SSO Test Connection', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/sso', ssoRouter);
  });

  describe('POST /api/sso/providers/:type/test', () => {
    it('should return 404 when provider not configured', async () => {
      vi.mocked(prisma.ssoProvider.findUnique).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/sso/providers/ldap/test')
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not configured');
    });
  });
});
