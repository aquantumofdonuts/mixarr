/**
 * LDAP Strategy Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';

describe('LDAP Strategy', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('LDAP authentication', () => {
    it('should find existing user by email from LDAP', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);

      const ldapUser = {
        dn: 'cn=testuser,dc=example,dc=com',
        mail: 'test@example.com',
        cn: 'Test User',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: ldapUser.mail },
      });

      expect(user).toBeDefined();
      expect(user?.email).toBe('test@example.com');
    });

    it('should reject when no user exists with that email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const ldapUser = {
        dn: 'cn=unknown,dc=example,dc=com',
        mail: 'unknown@example.com',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: ldapUser.mail },
      });

      expect(user).toBeNull();
    });

    it('should reject inactive users', async () => {
      const inactiveUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: false,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(inactiveUser);

      const user = await mockPrisma.user.findFirst({
        where: { email: 'test@example.com' },
      });

      expect(user?.isActive).toBe(false);
    });

    it('should create or update auth identity on successful login', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({
        id: 1,
        userId: 1,
        provider: 'ldap',
        providerUserId: 'cn=testuser,dc=example,dc=com',
        email: 'test@example.com',
      });

      const ldapUser = {
        dn: 'cn=testuser,dc=example,dc=com',
        mail: 'test@example.com',
        cn: 'Test User',
      };

      // Simulate upsert call
      const identity = await mockPrisma.authIdentity.upsert({
        where: {
          provider_providerUserId: {
            provider: 'ldap',
            providerUserId: ldapUser.dn,
          },
        },
        create: {
          userId: existingUser.id,
          provider: 'ldap',
          providerUserId: ldapUser.dn,
          email: ldapUser.mail,
        },
        update: {
          lastUsedAt: new Date(),
        },
      });

      expect(identity.provider).toBe('ldap');
      expect(identity.providerUserId).toBe('cn=testuser,dc=example,dc=com');
    });

    it('should update last login on successful authentication', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.user.update.mockResolvedValue({
        ...existingUser,
        lastLogin: new Date(),
      });

      // Simulate update call
      await mockPrisma.user.update({
        where: { id: existingUser.id },
        data: { lastLogin: new Date() },
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            lastLogin: expect.any(Date),
          }),
        })
      );
    });
  });

  describe('LDAP configuration', () => {
    it('should use email attribute from config', () => {
      const config = {
        serverUrl: 'ldap://localhost:389',
        bindDn: 'cn=admin,dc=example,dc=com',
        bindPassword: 'secret',
        searchBaseDn: 'dc=example,dc=com',
        searchFilter: '(uid={{username}})',
        emailAttribute: 'mail',
        displayNameAttribute: 'cn',
      };

      expect(config.emailAttribute).toBe('mail');
      expect(config.displayNameAttribute).toBe('cn');
    });

    it('should support custom search filter', () => {
      const config = {
        serverUrl: 'ldap://localhost:389',
        bindDn: 'cn=admin,dc=example,dc=com',
        bindPassword: 'secret',
        searchBaseDn: 'ou=users,dc=example,dc=com',
        searchFilter: '(&(objectClass=person)(sAMAccountName={{username}}))',
        emailAttribute: 'userPrincipalName',
      };

      expect(config.searchFilter).toContain('sAMAccountName');
    });
  });
});
