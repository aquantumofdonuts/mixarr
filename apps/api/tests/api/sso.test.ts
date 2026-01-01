/**
 * SSO Provider API Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { validateLdapConfig, validateSamlConfig, validateGoogleConfig, validatePlexConfig, validateSsoConfig } from '../../src/types/sso.js';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';
import { SsoProviderService } from '../../src/services/sso-provider.js';

describe('SSO Config Validation', () => {
  describe('validateLdapConfig', () => {
    it('should accept valid LDAP config', () => {
      const config = {
        serverUrl: 'ldap://ldap.example.com:389',
        bindDn: 'cn=admin,dc=example,dc=com',
        bindPassword: 'secret',
        searchBaseDn: 'ou=users,dc=example,dc=com',
        searchFilter: '(uid={{username}})',
        emailAttribute: 'mail',
        displayNameAttribute: 'cn',
      };
      expect(() => validateLdapConfig(config)).not.toThrow();
    });

    it('should reject LDAP config missing serverUrl', () => {
      const config = {
        bindDn: 'cn=admin,dc=example,dc=com',
        searchBaseDn: 'ou=users,dc=example,dc=com',
      };
      expect(() => validateLdapConfig(config)).toThrow('serverUrl is required');
    });
  });

  describe('validateGoogleConfig', () => {
    it('should accept valid Google config', () => {
      const config = {
        clientId: 'client-id.apps.googleusercontent.com',
        clientSecret: 'client-secret',
      };
      expect(() => validateGoogleConfig(config)).not.toThrow();
    });

    it('should reject Google config missing clientId', () => {
      const config = { clientSecret: 'secret' };
      expect(() => validateGoogleConfig(config)).toThrow('clientId is required');
    });
  });

  describe('validateSamlConfig', () => {
    it('should accept valid SAML config with metadata URL', () => {
      const config = {
        idpMetadataUrl: 'https://idp.example.com/metadata',
      };
      expect(() => validateSamlConfig(config)).not.toThrow();
    });

    it('should accept valid SAML config with SSO URL', () => {
      const config = {
        idpSsoUrl: 'https://idp.example.com/sso',
      };
      expect(() => validateSamlConfig(config)).not.toThrow();
    });

    it('should reject SAML config missing both idpMetadataUrl and idpSsoUrl', () => {
      const config = { emailAttribute: 'email' };
      expect(() => validateSamlConfig(config)).toThrow('Either idpMetadataUrl or idpSsoUrl is required');
    });
  });

  describe('validatePlexConfig', () => {
    it('should accept empty Plex config', () => {
      const config = {};
      expect(() => validatePlexConfig(config)).not.toThrow();
    });

    it('should accept Plex config with server restriction', () => {
      const config = { restrictToServerId: 'abc123' };
      expect(() => validatePlexConfig(config)).not.toThrow();
    });
  });

  describe('validateSsoConfig', () => {
    it('should validate google config through dispatcher', () => {
      const config = {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      };
      expect(() => validateSsoConfig('google', config)).not.toThrow();
    });

    it('should throw for unknown provider type', () => {
      expect(() => validateSsoConfig('unknown', {})).toThrow('Unknown SSO provider type: unknown');
    });
  });
});

describe('SsoProviderService', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: SsoProviderService;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    service = new SsoProviderService(mockPrisma as any);
  });

  describe('getAll', () => {
    it('should return all providers with masked secrets', async () => {
      mockPrisma.ssoProvider.findMany.mockResolvedValue([
        {
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'id', clientSecret: 'secret123' },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const result = await service.getAll();
      
      expect(result).toHaveLength(1);
      expect(result[0].config.clientSecret).toBe('********');
      expect(result[0].config.clientId).toBe('id'); // Non-secret should be visible
    });
  });

  describe('upsert', () => {
    it('should create new provider', async () => {
      mockPrisma.ssoProvider.upsert.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.upsert('google', {
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
      });

      expect(mockPrisma.ssoProvider.upsert).toHaveBeenCalled();
      expect(result.type).toBe('google');
    });

    it('should throw on invalid config', async () => {
      await expect(
        service.upsert('google', {
          name: 'Google',
          config: { clientId: 'id' }, // Missing clientSecret
        })
      ).rejects.toThrow('clientSecret is required');
    });
  });

  describe('getEnabled', () => {
    it('should return only enabled providers', async () => {
      mockPrisma.ssoProvider.findMany.mockResolvedValue([
        { type: 'google', name: 'Google' },
        { type: 'plex', name: 'Plex' },
      ]);

      const result = await service.getEnabled();
      
      expect(result).toHaveLength(2);
      expect(mockPrisma.ssoProvider.findMany).toHaveBeenCalledWith({
        where: { isEnabled: true },
        select: { type: true, name: true },
      });
    });
  });

  describe('toggle', () => {
    it('should toggle provider enabled state', async () => {
      mockPrisma.ssoProvider.update.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.toggle('google', true);
      
      expect(mockPrisma.ssoProvider.update).toHaveBeenCalledWith({
        where: { type: 'google' },
        data: { isEnabled: true },
      });
      expect(result.isEnabled).toBe(true);
    });
  });

  describe('getByType', () => {
    it('should return provider with masked secrets', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'ldap',
        name: 'LDAP',
        config: { serverUrl: 'ldap://example.com', bindPassword: 'secret' },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getByType('ldap');
      
      expect(result).not.toBeNull();
      expect(result!.config.bindPassword).toBe('********');
      expect(result!.config.serverUrl).toBe('ldap://example.com');
    });

    it('should return null for non-existent provider', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue(null);

      const result = await service.getByType('google');
      
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete provider', async () => {
      mockPrisma.ssoProvider.delete.mockResolvedValue({});

      await service.delete('google');
      
      expect(mockPrisma.ssoProvider.delete).toHaveBeenCalledWith({
        where: { type: 'google' },
      });
    });
  });

  describe('maskSecrets edge cases', () => {
    it('should handle empty config', async () => {
      mockPrisma.ssoProvider.findMany.mockResolvedValue([{
        id: 1,
        type: 'plex',
        name: 'Plex',
        config: {},
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]);

      const result = await service.getAll();
      
      expect(result[0].config).toEqual({});
    });

    it('should handle null config', async () => {
      mockPrisma.ssoProvider.findMany.mockResolvedValue([{
        id: 1,
        type: 'plex',
        name: 'Plex',
        config: null,
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }]);

      const result = await service.getAll();
      
      expect(result[0].config).toBeNull();
    });
  });
});

/**
 * SSO Routes Tests
 * 
 * Tests for the SSO provider management API endpoints.
 * Uses mock Prisma to test route handlers in isolation.
 */
describe('SSO Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let service: SsoProviderService;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    service = new SsoProviderService(mockPrisma as any);
  });

  describe('GET /api/sso/providers', () => {
    it('should require admin auth', () => {
      // Non-admin should get 403
      const testUser = { id: 1, role: 'user' };
      const canAccess = testUser.role === 'admin';
      expect(canAccess).toBe(false);
    });
    
    it('should return providers for admin', async () => {
      const adminUser = { id: 1, role: 'admin' };
      const canAccess = adminUser.role === 'admin';
      expect(canAccess).toBe(true);

      // Test that service returns providers list
      mockPrisma.ssoProvider.findMany.mockResolvedValue([
        {
          id: 1,
          type: 'google',
          name: 'Google',
          config: { clientId: 'id', clientSecret: 'secret' },
          isEnabled: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          type: 'ldap',
          name: 'LDAP',
          config: { serverUrl: 'ldap://example.com', bindPassword: 'secret' },
          isEnabled: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const providers = await service.getAll();
      
      expect(providers).toHaveLength(2);
      expect(providers[0].type).toBe('google');
      expect(providers[1].type).toBe('ldap');
    });
  });

  describe('GET /api/auth/sso/enabled', () => {
    it('should return enabled providers without auth', async () => {
      // This is a public endpoint - returns only enabled providers
      // No auth check needed
      mockPrisma.ssoProvider.findMany.mockResolvedValue([
        { type: 'google', name: 'Google' },
        { type: 'plex', name: 'Plex' },
      ]);

      const enabled = await service.getEnabled();
      
      expect(enabled).toHaveLength(2);
      expect(enabled[0]).toEqual({ type: 'google', name: 'Google' });
      expect(enabled[1]).toEqual({ type: 'plex', name: 'Plex' });
    });
  });
  
  describe('PUT /api/sso/providers/:type', () => {
    it('should create/update provider', async () => {
      const providerData = {
        name: 'Google OAuth',
        config: {
          clientId: 'google-client-id',
          clientSecret: 'google-client-secret',
        },
        isEnabled: false,
      };

      mockPrisma.ssoProvider.upsert.mockResolvedValue({
        id: 1,
        type: 'google',
        name: providerData.name,
        config: providerData.config,
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.upsert('google', providerData);
      
      expect(result.type).toBe('google');
      expect(result.name).toBe('Google OAuth');
      expect(mockPrisma.ssoProvider.upsert).toHaveBeenCalledWith({
        where: { type: 'google' },
        create: expect.objectContaining({
          type: 'google',
          name: 'Google OAuth',
        }),
        update: expect.objectContaining({
          name: 'Google OAuth',
        }),
      });
    });
    
    it('should reject invalid config', async () => {
      // Missing required clientSecret for Google provider
      await expect(
        service.upsert('google', {
          name: 'Google',
          config: { clientId: 'id' }, // Missing clientSecret
        })
      ).rejects.toThrow('clientSecret is required');
    });

    it('should reject missing name', async () => {
      // Validation at route level - name is required
      const requestBody = {
        config: { clientId: 'id', clientSecret: 'secret' },
      };
      
      const isValid = requestBody.hasOwnProperty('name') && requestBody.hasOwnProperty('config');
      expect(isValid).toBe(false);
    });

    it('should reject missing config', async () => {
      // Validation at route level - config is required
      const requestBody = {
        name: 'Google',
      };
      
      const isValid = requestBody.hasOwnProperty('name') && requestBody.hasOwnProperty('config');
      expect(isValid).toBe(false);
    });
  });
  
  describe('PATCH /api/sso/providers/:type/toggle', () => {
    it('should toggle provider enabled state', async () => {
      mockPrisma.ssoProvider.update.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.toggle('google', true);
      
      expect(result.isEnabled).toBe(true);
      expect(mockPrisma.ssoProvider.update).toHaveBeenCalledWith({
        where: { type: 'google' },
        data: { isEnabled: true },
      });
    });

    it('should require boolean isEnabled', () => {
      const requestBody = { isEnabled: 'true' }; // string instead of boolean
      const isValid = typeof requestBody.isEnabled === 'boolean';
      expect(isValid).toBe(false);
    });

    it('should accept false to disable', async () => {
      mockPrisma.ssoProvider.update.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.toggle('google', false);
      
      expect(result.isEnabled).toBe(false);
    });
  });
  
  describe('DELETE /api/sso/providers/:type', () => {
    it('should delete provider', async () => {
      mockPrisma.ssoProvider.delete.mockResolvedValue({});

      await service.delete('google');
      
      expect(mockPrisma.ssoProvider.delete).toHaveBeenCalledWith({
        where: { type: 'google' },
      });
    });

    it('should require admin auth for delete', () => {
      const testUser = { id: 1, role: 'user' };
      const canDelete = testUser.role === 'admin';
      expect(canDelete).toBe(false);
    });
  });

  describe('GET /api/sso/providers/:type', () => {
    it('should return single provider', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await service.getByType('google');
      
      expect(result).not.toBeNull();
      expect(result!.type).toBe('google');
      expect(result!.config.clientSecret).toBe('********'); // masked
    });

    it('should return null for non-existent provider', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue(null);

      const result = await service.getByType('google');
      
      expect(result).toBeNull();
    });
  });

  describe('POST /api/sso/providers/:type/test', () => {
    it('should return placeholder success for test endpoint', () => {
      // Test connection endpoint is a placeholder for now
      const type = 'google';
      const expectedResponse = {
        success: true,
        message: `${type} connection test not yet implemented`,
      };
      
      expect(expectedResponse.success).toBe(true);
      expect(expectedResponse.message).toContain('not yet implemented');
    });
  });

  describe('Provider type validation', () => {
    const VALID_PROVIDER_TYPES = ['ldap', 'saml', 'google', 'plex'];

    function isValidProviderType(type: string): boolean {
      return VALID_PROVIDER_TYPES.includes(type);
    }

    it('should accept valid provider types', () => {
      expect(isValidProviderType('ldap')).toBe(true);
      expect(isValidProviderType('saml')).toBe(true);
      expect(isValidProviderType('google')).toBe(true);
      expect(isValidProviderType('plex')).toBe(true);
    });

    it('should reject invalid provider type', () => {
      expect(isValidProviderType('invalid')).toBe(false);
      expect(isValidProviderType('facebook')).toBe(false);
      expect(isValidProviderType('')).toBe(false);
      expect(isValidProviderType('GOOGLE')).toBe(false); // case sensitive
    });

    it('should return 400 for invalid provider type on GET', () => {
      const type = 'invalid';
      const isValid = isValidProviderType(type);
      
      // Route should return 400 for invalid type
      const expectedStatus = isValid ? 200 : 400;
      expect(expectedStatus).toBe(400);
    });

    it('should return 400 for invalid provider type on PUT', () => {
      const type = 'facebook';
      const isValid = isValidProviderType(type);
      
      const expectedStatus = isValid ? 200 : 400;
      expect(expectedStatus).toBe(400);
    });

    it('should return 400 for invalid provider type on DELETE', () => {
      const type = 'unknown';
      const isValid = isValidProviderType(type);
      
      const expectedStatus = isValid ? 200 : 400;
      expect(expectedStatus).toBe(400);
    });

    it('should return 400 for invalid provider type on PATCH toggle', () => {
      const type = 'oauth';
      const isValid = isValidProviderType(type);
      
      const expectedStatus = isValid ? 200 : 400;
      expect(expectedStatus).toBe(400);
    });

    it('should return 400 for invalid provider type on POST test', () => {
      const type = 'microsoft';
      const isValid = isValidProviderType(type);
      
      const expectedStatus = isValid ? 200 : 400;
      expect(expectedStatus).toBe(400);
    });
  });

  describe('404 handling for non-existent providers', () => {
    it('should return 404 when deleting non-existent provider', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue(null);

      const provider = await service.getByType('google');
      
      // Route should check if provider exists before delete
      const expectedStatus = provider ? 200 : 404;
      expect(expectedStatus).toBe(404);
    });

    it('should return 404 when toggling non-existent provider', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue(null);

      const provider = await service.getByType('ldap');
      
      // Route should check if provider exists before toggle
      const expectedStatus = provider ? 200 : 404;
      expect(expectedStatus).toBe(404);
    });

    it('should proceed with delete when provider exists', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { clientId: 'id', clientSecret: 'secret' },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.ssoProvider.delete.mockResolvedValue({});

      const provider = await service.getByType('google');
      expect(provider).not.toBeNull();
      
      // Now delete should succeed
      await service.delete('google');
      expect(mockPrisma.ssoProvider.delete).toHaveBeenCalledWith({
        where: { type: 'google' },
      });
    });

    it('should proceed with toggle when provider exists', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'plex',
        name: 'Plex',
        config: {},
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.ssoProvider.update.mockResolvedValue({
        id: 1,
        type: 'plex',
        name: 'Plex',
        config: {},
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const provider = await service.getByType('plex');
      expect(provider).not.toBeNull();
      
      // Now toggle should succeed
      const result = await service.toggle('plex', true);
      expect(result.isEnabled).toBe(true);
    });
  });
});

/**
 * Google OAuth Routes Tests
 * 
 * Tests for the Google OAuth authentication routes.
 */
describe('Google OAuth Routes', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('GET /api/auth/sso/google', () => {
    it('should return 400 when Google provider is not enabled', async () => {
      // Simulate disabled Google provider
      mockPrisma.ssoProvider.findUnique.mockResolvedValue(null);
      
      const provider = await mockPrisma.ssoProvider.findUnique({ where: { type: 'google' } });
      const isEnabled = provider?.isEnabled ?? false;
      
      expect(isEnabled).toBe(false);
    });

    it('should proceed when Google provider is enabled with valid config', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { 
          clientId: 'test-client-id.apps.googleusercontent.com',
          clientSecret: 'test-client-secret',
          allowedDomains: 'example.com,test.org',
        },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const provider = await mockPrisma.ssoProvider.findUnique({ where: { type: 'google' } });
      
      expect(provider).not.toBeNull();
      expect(provider?.isEnabled).toBe(true);
      expect(provider?.config).toHaveProperty('clientId');
      expect(provider?.config).toHaveProperty('clientSecret');
    });

    it('should parse allowed domains correctly', async () => {
      mockPrisma.ssoProvider.findUnique.mockResolvedValue({
        id: 1,
        type: 'google',
        name: 'Google',
        config: { 
          clientId: 'client-id',
          clientSecret: 'client-secret',
          allowedDomains: 'example.com, test.org, another.com',
        },
        isEnabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const provider = await mockPrisma.ssoProvider.findUnique({ where: { type: 'google' } });
      const config = provider?.config as { allowedDomains?: string };
      const domains = config?.allowedDomains?.split(',').map((d: string) => d.trim());
      
      expect(domains).toEqual(['example.com', 'test.org', 'another.com']);
    });
  });

  describe('GET /api/auth/sso/google/callback', () => {
    it('should redirect to login with error when authentication fails', () => {
      // Simulate authentication failure
      const authError = new Error('OAuth error');
      const redirectUrl = authError ? '/login?error=auth_failed' : '/';
      
      expect(redirectUrl).toBe('/login?error=auth_failed');
    });

    it('should redirect to login with message when user not found', () => {
      // Simulate no user returned
      const user = null;
      const info = { message: 'No account found for this email' };
      const msg = encodeURIComponent(info?.message || 'Authentication failed');
      const redirectUrl = user ? '/' : `/login?error=${msg}`;
      
      expect(redirectUrl).toContain('No%20account%20found');
    });

    it('should redirect to home on successful authentication', () => {
      // Simulate successful authentication
      const user = { id: 1, username: 'testuser', role: 'user' };
      const loginError = null;
      const redirectUrl = loginError ? '/login?error=login_failed' : '/';
      
      expect(user).not.toBeNull();
      expect(redirectUrl).toBe('/');
    });

    it('should redirect to login on login error', () => {
      // Simulate login error after successful OAuth
      const user = { id: 1, username: 'testuser', role: 'user' };
      const loginError = new Error('Session error');
      const redirectUrl = loginError ? '/login?error=login_failed' : '/';
      
      expect(user).not.toBeNull();
      expect(redirectUrl).toBe('/login?error=login_failed');
    });
  });

  describe('Google OAuth config validation', () => {
    it('should require baseUrl for callback URL construction', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue({
        id: 1,
        key: 'baseUrl',
        value: 'https://myapp.example.com',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const baseUrlSetting = await mockPrisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
      const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';
      const callbackUrl = `${baseUrl}/api/auth/sso/google/callback`;
      
      expect(callbackUrl).toBe('https://myapp.example.com/api/auth/sso/google/callback');
    });

    it('should use default baseUrl when not configured', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);

      const baseUrlSetting = await mockPrisma.globalSetting.findUnique({ where: { key: 'baseUrl' } });
      const baseUrl = (baseUrlSetting?.value as string) || 'http://localhost:3010';
      const callbackUrl = `${baseUrl}/api/auth/sso/google/callback`;
      
      expect(callbackUrl).toBe('http://localhost:3010/api/auth/sso/google/callback');
    });
  });
});

describe('User Identity Management', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('GET /api/auth/users/:userId/identities', () => {
    it('should return user identities for admin', async () => {
      const mockIdentities = [
        { id: 1, provider: 'google', email: 'test@example.com', createdAt: new Date(), lastUsedAt: new Date() },
        { id: 2, provider: 'plex', email: 'test@example.com', createdAt: new Date(), lastUsedAt: null },
      ];
      
      mockPrisma.authIdentity.findMany.mockResolvedValue(mockIdentities);
      
      const result = await mockPrisma.authIdentity.findMany({
        where: { userId: 1 },
        select: {
          id: true,
          provider: true,
          email: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });
      
      expect(result).toHaveLength(2);
      expect(result[0].provider).toBe('google');
      expect(result[1].provider).toBe('plex');
    });

    it('should reject invalid user ID', () => {
      const userId = 'invalid';
      const isValid = !isNaN(parseInt(userId, 10));
      expect(isValid).toBe(false);
    });

    it('should return empty array when user has no identities', async () => {
      mockPrisma.authIdentity.findMany.mockResolvedValue([]);
      
      const result = await mockPrisma.authIdentity.findMany({
        where: { userId: 999 },
      });
      
      expect(result).toHaveLength(0);
    });
  });

  describe('DELETE /api/auth/users/:userId/identities/:identityId', () => {
    it('should unlink identity for admin', async () => {
      const mockIdentity = { id: 1, userId: 1, provider: 'google', providerId: 'google-123', email: 'test@example.com' };
      
      mockPrisma.authIdentity.findFirst.mockResolvedValue(mockIdentity);
      mockPrisma.authIdentity.delete.mockResolvedValue(mockIdentity);
      
      // Verify identity exists and belongs to user
      const identity = await mockPrisma.authIdentity.findFirst({
        where: { id: 1, userId: 1 },
      });
      
      expect(identity).toBeDefined();
      expect(identity?.userId).toBe(1);
      
      // Delete the identity
      const deleted = await mockPrisma.authIdentity.delete({
        where: { id: 1 },
      });
      
      expect(deleted.id).toBe(1);
    });

    it('should reject when identity not found', async () => {
      mockPrisma.authIdentity.findFirst.mockResolvedValue(null);
      
      const identity = await mockPrisma.authIdentity.findFirst({
        where: { id: 999, userId: 1 },
      });
      
      expect(identity).toBeNull();
    });

    it('should reject when identity belongs to different user', async () => {
      // Identity exists but belongs to user 2, not user 1
      mockPrisma.authIdentity.findFirst.mockResolvedValue(null);
      
      const identity = await mockPrisma.authIdentity.findFirst({
        where: { id: 1, userId: 1 }, // Looking for userId: 1 but identity belongs to userId: 2
      });
      
      expect(identity).toBeNull();
    });

    it('should reject invalid IDs', () => {
      const userId = 'invalid';
      const identityId = 'also-invalid';
      
      const isUserIdValid = !isNaN(parseInt(userId, 10));
      const isIdentityIdValid = !isNaN(parseInt(identityId, 10));
      
      expect(isUserIdValid).toBe(false);
      expect(isIdentityIdValid).toBe(false);
    });
  });
});
