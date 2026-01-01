/**
 * Plex Authentication Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockPrisma, resetIdCounter } from '../utils/fixtures.js';
import { PlexAuthService } from '../../src/auth/strategies/plex.js';

describe('Plex Authentication', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let plexService: PlexAuthService;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    plexService = new PlexAuthService(
      { callbackUrl: 'http://localhost:3010/api/auth/sso/plex/callback' },
      mockPrisma as any
    );
  });

  describe('authenticateUser', () => {
    it('should authenticate existing user by email', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      const plexUser = {
        id: 12345,
        uuid: 'abc-123',
        email: 'test@example.com',
        username: 'plexuser',
        title: 'Plex User',
        thumb: 'https://plex.tv/avatar.jpg',
      };

      const result = await plexService.authenticateUser(plexUser);

      expect(result.success).toBe(true);
      expect(result.user?.username).toBe('testuser');
      expect(result.user?.displayName).toBe('Test User');
      expect(result.user?.role).toBe('user');
    });

    it('should reject when no user exists with that email', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      const plexUser = {
        id: 12345,
        uuid: 'abc-123',
        email: 'unknown@example.com',
        username: 'plexuser',
        title: 'Unknown User',
        thumb: '',
      };

      const result = await plexService.authenticateUser(plexUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No account found');
    });

    it('should reject inactive users', async () => {
      const inactiveUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        isActive: false,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(inactiveUser);

      const plexUser = {
        id: 12345,
        uuid: 'abc-123',
        email: 'test@example.com',
        username: 'plexuser',
        title: 'Test',
        thumb: '',
      };

      const result = await plexService.authenticateUser(plexUser);

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });

    it('should upsert auth identity on successful login', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({
        id: 1,
        userId: 1,
        provider: 'plex',
        providerUserId: '12345',
        email: 'test@example.com',
        metadata: { username: 'plexuser' },
        createdAt: new Date(),
        lastUsedAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue({});

      const plexUser = {
        id: 12345,
        uuid: 'abc-123',
        email: 'test@example.com',
        username: 'plexuser',
        title: 'Plex User',
        thumb: 'https://plex.tv/avatar.jpg',
      };

      await plexService.authenticateUser(plexUser);

      expect(mockPrisma.authIdentity.upsert).toHaveBeenCalledWith({
        where: {
          provider_providerUserId: {
            provider: 'plex',
            providerUserId: '12345',
          },
        },
        create: expect.objectContaining({
          userId: 1,
          provider: 'plex',
          providerUserId: '12345',
          email: 'test@example.com',
        }),
        update: expect.objectContaining({
          lastUsedAt: expect.any(Date),
        }),
      });
    });

    it('should update user lastLogin on successful auth', async () => {
      const existingUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
        role: 'user',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(existingUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      const plexUser = {
        id: 12345,
        uuid: 'abc-123',
        email: 'test@example.com',
        username: 'plexuser',
        title: 'Plex User',
        thumb: '',
      };

      await plexService.authenticateUser(plexUser);

      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { lastLogin: expect.any(Date) },
      });
    });
  });

  describe('admin user authentication', () => {
    it('should authenticate admin user and return admin role', async () => {
      const adminUser = {
        id: 1,
        username: 'admin',
        email: 'admin@example.com',
        displayName: 'Admin User',
        role: 'admin',
        isActive: true,
      };
      
      mockPrisma.user.findFirst.mockResolvedValue(adminUser);
      mockPrisma.authIdentity.upsert.mockResolvedValue({});
      mockPrisma.user.update.mockResolvedValue({});

      const plexUser = {
        id: 99999,
        uuid: 'admin-uuid',
        email: 'admin@example.com',
        username: 'plexadmin',
        title: 'Admin',
        thumb: '',
      };

      const result = await plexService.authenticateUser(plexUser);

      expect(result.success).toBe(true);
      expect(result.user?.role).toBe('admin');
    });
  });

  describe('PlexAuthService configuration', () => {
    it('should accept restrictToServerId config', () => {
      const service = new PlexAuthService(
        { 
          callbackUrl: 'http://localhost:3010/api/auth/sso/plex/callback',
          restrictToServerId: 'server-123',
        },
        mockPrisma as any
      );
      
      // Service should be created without error
      expect(service).toBeDefined();
    });
  });
});
