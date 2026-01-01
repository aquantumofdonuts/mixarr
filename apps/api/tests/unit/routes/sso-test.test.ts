import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use global for mock state (hoisting workaround)
declare global {
  var __ssoTestMockResult: any;
}
globalThis.__ssoTestMockResult = null;

// Mock auth middleware
vi.mock('../../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Mock the SsoProviderService
vi.mock('../../../src/services/sso-provider.js', () => {
  return {
    SsoProviderService: class MockSsoProviderService {
      async getByType() {
        return globalThis.__ssoTestMockResult;
      }
      async getAll() {
        return [];
      }
      async upsert() {
        return {};
      }
      async delete() {}
      async toggle() {
        return {};
      }
    },
  };
});

// Mock prisma (still needed for service constructor)
vi.mock('../../../src/lib/db.js', () => ({
  default: {},
}));

import { ssoRouter } from '../../../src/routes/sso.js';

describe('SSO Test Connection', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__ssoTestMockResult = null;
    app = express();
    app.use(express.json());
    app.use('/api/sso', ssoRouter);
  });

  describe('POST /api/sso/providers/:type/test', () => {
    it('should return 404 when provider not configured', async () => {
      globalThis.__ssoTestMockResult = null;

      const response = await request(app)
        .post('/api/sso/providers/ldap/test')
        .send();

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not configured');
    });

    describe('Google provider', () => {
      it('should return error when clientId format invalid', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'invalid-id', clientSecret: 'secret123456' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const response = await request(app)
          .post('/api/sso/providers/google/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Client ID');
      });

      it('should return success when credentials format valid', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'test.apps.googleusercontent.com', clientSecret: 'secret123456' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const response = await request(app)
          .post('/api/sso/providers/google/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('valid');
      });
    });

    describe('Plex provider', () => {
      it('should return info message about PIN auth', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'plex',
          name: 'Plex',
          config: {},
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const response = await request(app)
          .post('/api/sso/providers/plex/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('PIN');
      });
    });
  });
});
