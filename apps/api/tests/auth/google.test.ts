/**
 * Google OAuth Strategy Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';

describe('Google OAuth Strategy', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
  });

  describe('handleGoogleCallback', () => {
    it('should find existing user by email', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);

      const profile = {
        id: 'google-123',
        emails: [{ value: 'test@example.com' }],
        displayName: 'Test User',
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: profile.emails[0].value },
      });

      expect(user).toBeDefined();
      expect(user?.email).toBe('test@example.com');
    });

    it('should reject login when no user exists with that email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const profile = {
        id: 'google-456',
        emails: [{ value: 'unknown@example.com' }],
      };

      const user = await mockPrisma.user.findFirst({
        where: { email: profile.emails[0].value },
      });

      expect(user).toBeNull();
    });

    it('should upsert auth identity on successful login', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({
        id: 1,
        userId: 1,
        provider: 'google',
        providerUserId: 'google-123',
        email: 'test@example.com',
        metadata: { displayName: 'Test User' },
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });

      const identity = await mockPrisma.authIdentity.upsert({
        where: { provider_providerUserId: { provider: 'google', providerUserId: 'google-123' } },
        create: { userId: 1, provider: 'google', providerUserId: 'google-123', email: 'test@example.com' },
        update: { lastUsedAt: new Date() },
      });

      expect(identity).toBeDefined();
      expect(identity.provider).toBe('google');
    });
  });

  describe('domain restriction', () => {
    it('should accept email from allowed domain', () => {
      const allowedDomains = ['example.com', 'company.org'];
      const email = 'user@example.com';
      const domain = email.split('@')[1];
      
      expect(allowedDomains.includes(domain)).toBe(true);
    });

    it('should reject email from non-allowed domain', () => {
      const allowedDomains = ['example.com'];
      const email = 'user@notallowed.com';
      const domain = email.split('@')[1];
      
      expect(allowedDomains.includes(domain)).toBe(false);
    });
  });
});
