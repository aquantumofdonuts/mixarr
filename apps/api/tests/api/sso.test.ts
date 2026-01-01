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
