import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use global for mock state (hoisting workaround)
declare global {
  var __ssoTestMockResult: any;
  var __ldapMockBind: { success: boolean; error?: string } | null;
  var __fetchMockResult: { ok: boolean; text: string } | { error: string } | null;
}
globalThis.__ssoTestMockResult = null;
globalThis.__ldapMockBind = null;
globalThis.__fetchMockResult = null;

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

// Mock ldapjs
vi.mock('ldapjs', () => ({
  createClient: () => ({
    bind: (_dn: string, _password: string, callback: (err: Error | null) => void) => {
      const mockResult = globalThis.__ldapMockBind;
      if (mockResult && mockResult.success) {
        callback(null);
      } else {
        callback(new Error(mockResult?.error || 'Bind failed'));
      }
    },
    unbind: () => {},
  }),
}));

// Mock prisma - wire findUnique to return global test mock
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    ssoProvider: {
      findUnique: () => Promise.resolve(globalThis.__ssoTestMockResult),
      findMany: () => Promise.resolve([]),
    },
  },
}));

import { ssoRouter } from '../../../src/routes/sso.js';

describe('SSO Test Connection', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.__ssoTestMockResult = null;
    globalThis.__ldapMockBind = null;
    globalThis.__fetchMockResult = null;
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

    describe('SAML provider', () => {
      it('should return success when metadata URL returns valid XML', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { idpMetadataUrl: 'https://example.com/metadata' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Mock global fetch
        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          text: () => Promise.resolve('<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"></EntityDescriptor>'),
        });

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('metadata');
      });

      it('should return error when metadata URL unreachable', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { idpMetadataUrl: 'https://unreachable.example.com/metadata' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('fetch');
      });

      it('should validate manual config when no metadata URL', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'saml',
          name: 'SAML',
          config: { 
            idpSsoUrl: 'https://idp.example.com/sso', 
            idpCertificate: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----' 
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const response = await request(app)
          .post('/api/sso/providers/saml/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('valid');
      });
    });

    describe('OIDC provider', () => {
      it('should return error when required fields missing', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'oidc',
          name: 'OIDC',
          config: { issuerUrl: 'https://idp.example.com' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const response = await request(app)
          .post('/api/sso/providers/oidc/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('issuerUrl, clientId, and clientSecret');
      });

      it('should return success when discovery document is valid', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'oidc',
          name: 'OIDC',
          config: {
            issuerUrl: 'https://idp.example.com',
            clientId: 'oidc-client',
            clientSecret: 'oidc-secret',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({
            issuer: 'https://idp.example.com',
            authorization_endpoint: 'https://idp.example.com/auth',
            token_endpoint: 'https://idp.example.com/token',
          }),
        });

        const response = await request(app)
          .post('/api/sso/providers/oidc/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('discovery successful');
      });

      it('should return error when discovery document missing required fields', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'oidc',
          name: 'OIDC',
          config: {
            issuerUrl: 'https://idp.example.com',
            clientId: 'oidc-client',
            clientSecret: 'oidc-secret',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ issuer: 'https://idp.example.com' }),
        });

        const response = await request(app)
          .post('/api/sso/providers/oidc/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('missing required fields');
      });

      it('should return error when discovery endpoint returns non-200', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'oidc',
          name: 'OIDC',
          config: {
            issuerUrl: 'https://idp.example.com',
            clientId: 'oidc-client',
            clientSecret: 'oidc-secret',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        globalThis.fetch = vi.fn().mockResolvedValue({
          ok: false,
          status: 404,
          json: () => Promise.resolve({}),
        });

        const response = await request(app)
          .post('/api/sso/providers/oidc/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('HTTP 404');
      });
    });

    describe('LDAP provider', () => {
      it('should return success when LDAP bind succeeds', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'ldap',
          name: 'LDAP',
          config: {
            serverUrl: 'ldap://localhost:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'password',
            searchBaseDn: 'ou=users,dc=example,dc=com',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Mock will be set up in implementation
        globalThis.__ldapMockBind = { success: true };

        const response = await request(app)
          .post('/api/sso/providers/ldap/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('successful');
      });

      it('should return error when LDAP bind fails', async () => {
        globalThis.__ssoTestMockResult = {
          id: 1,
          type: 'ldap',
          name: 'LDAP',
          config: {
            serverUrl: 'ldap://localhost:389',
            bindDn: 'cn=admin,dc=example,dc=com',
            bindPassword: 'wrongpassword',
            searchBaseDn: 'ou=users,dc=example,dc=com',
          },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        globalThis.__ldapMockBind = { success: false, error: 'Invalid credentials' };

        const response = await request(app)
          .post('/api/sso/providers/ldap/test')
          .send();

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid credentials');
      });
    });
  });
});
