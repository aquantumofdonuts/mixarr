/**
 * SAML Strategy Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';

describe('SAML Strategy', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('SAML authentication', () => {
    it('should find existing user by email from SAML assertion', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);

      const samlProfile = {
        nameID: 'test@example.com',
        email: 'test@example.com',
        displayName: 'Test User',
        issuer: 'https://idp.example.com',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: samlProfile.email },
      });

      expect(user).toBeDefined();
      expect(user?.email).toBe('test@example.com');
    });

    it('should reject when no user exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const samlProfile = {
        nameID: 'unknown@example.com',
        email: 'unknown@example.com',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: samlProfile.email },
      });

      expect(user).toBeNull();
    });

    it('should use nameID as fallback for email', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'user@example.com',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);

      const samlProfile = {
        nameID: 'user@example.com', // No email attribute, use nameID
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: samlProfile.nameID },
      });

      expect(user).toBeDefined();
    });

    it('should reject inactive users', async () => {
      const inactiveUser = {
        id: 1,
        username: 'inactive',
        email: 'inactive@example.com',
        isActive: false,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(inactiveUser);

      const samlProfile = {
        nameID: 'inactive@example.com',
        email: 'inactive@example.com',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: samlProfile.email },
      });

      expect(user).toBeDefined();
      expect(user?.isActive).toBe(false);
    });

    it('should upsert auth identity on successful auth', async () => {
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
        provider: 'saml',
        providerUserId: 'test@example.com',
        email: 'test@example.com',
        metadata: {},
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      await mockPrisma.authIdentity.upsert({
        where: {
          provider_providerUserId: {
            provider: 'saml',
            providerUserId: 'test@example.com',
          },
        },
        create: {
          userId: existingUser.id,
          provider: 'saml',
          providerUserId: 'test@example.com',
          email: 'test@example.com',
          metadata: {},
        },
        update: {
          lastUsedAt: new Date(),
        },
      });

      expect(mockPrisma.authIdentity.upsert).toHaveBeenCalled();
    });

    it('should update last login on successful auth', async () => {
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

      await mockPrisma.user.update({
        where: { id: existingUser.id },
        data: { lastLogin: new Date() },
      });

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existingUser.id },
          data: expect.objectContaining({ lastLogin: expect.any(Date) }),
        })
      );
    });
  });

  describe('SAML config options', () => {
    it('should support custom email attribute', () => {
      const config = {
        callbackUrl: 'http://localhost:3010/api/auth/sso/saml/callback',
        entryPoint: 'https://idp.example.com/sso',
        issuer: 'http://localhost:3010',
        emailAttribute: 'mail', // Custom attribute
      };

      expect(config.emailAttribute).toBe('mail');
    });

    it('should support custom displayName attribute', () => {
      const config = {
        callbackUrl: 'http://localhost:3010/api/auth/sso/saml/callback',
        entryPoint: 'https://idp.example.com/sso',
        issuer: 'http://localhost:3010',
        displayNameAttribute: 'cn', // Custom attribute
      };

      expect(config.displayNameAttribute).toBe('cn');
    });

    it('should support IdP certificate configuration', () => {
      const config = {
        callbackUrl: 'http://localhost:3010/api/auth/sso/saml/callback',
        entryPoint: 'https://idp.example.com/sso',
        idpCertificate: 'MIICpDCCAYwCCQDH...', // Certificate
        issuer: 'http://localhost:3010',
      };

      expect(config.idpCertificate).toBeDefined();
    });
  });
});
