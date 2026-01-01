/**
 * SSO Provider API Tests
 */

import { describe, it, expect } from 'vitest';
import { validateLdapConfig, validateSamlConfig, validateGoogleConfig, validatePlexConfig } from '../../src/types/sso.js';

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
});
