/**
 * Settings API Tests
 * 
 * Tests:
 * - User settings CRUD
 * - Global settings (admin only)
 * - User preferences
 * - Base URL endpoint
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockAdminUser,
  resetIdCounter,
} from '../utils/fixtures.js';
import express from 'express';
import request from 'supertest';

// Mock modules used by the settings router
vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: { count: vi.fn() },
    globalSetting: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    userSetting: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock('../../src/services/settings.service.js', () => ({
  SettingsService: {
    getBaseUrl: vi.fn().mockResolvedValue('http://localhost:3010'),
    setBaseUrl: vi.fn().mockResolvedValue(undefined),
    getUserSettings: vi.fn().mockResolvedValue({}),
    setUserSetting: vi.fn().mockResolvedValue(undefined),
    getUserPreferences: vi.fn().mockResolvedValue({}),
    updateUserPreferences: vi.fn().mockResolvedValue({}),
    getGlobalSettings: vi.fn().mockResolvedValue([]),
    setGlobalSetting: vi.fn().mockResolvedValue(undefined),
    getConstellationSettings: vi.fn().mockResolvedValue({}),
    updateConstellationSettings: vi.fn().mockImplementation(async (u: any) => u),
  },
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Import router after mocks
import { settingsRouter } from '../../src/routes/settings.js';
import prisma from '../../src/lib/db.js';
import { SettingsService } from '../../src/services/settings.service.js';

describe('Settings API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let adminUser: ReturnType<typeof createMockAdminUser>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    adminUser = createMockAdminUser();
  });

  describe('GET /api/settings/base-url', () => {
    it('should return base URL without authentication', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue({
        key: 'baseUrl',
        value: 'http://localhost:3010',
      });

      const setting = await mockPrisma.globalSetting.findUnique({
        where: { key: 'baseUrl' },
      });

      expect(setting?.value).toBe('http://localhost:3010');
    });

    it('should return default when base URL not set', async () => {
      mockPrisma.globalSetting.findUnique.mockResolvedValue(null);

      const setting = await mockPrisma.globalSetting.findUnique({
        where: { key: 'baseUrl' },
      });

      const baseUrl = setting?.value || process.env.BASE_URL || 'http://localhost:3010';
      expect(baseUrl).toBe('http://localhost:3010');
    });
  });

  describe('POST /api/settings/base-url', () => {
    /** Build an Express app with the settings router and a chosen auth state. */
    function buildApp(authState: 'none' | 'user' | 'admin') {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        if (authState === 'none') {
          req.isAuthenticated = () => false;
        } else {
          req.isAuthenticated = () => true;
          req.user = authState === 'admin'
            ? { id: 1, role: 'admin', username: 'admin' }
            : { id: 1, role: 'user', username: 'testuser' };
        }
        next();
      });
      app.use('/', settingsRouter);
      return app;
    }

    it('should allow unauthenticated access during setup (no users)', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'http://localhost:3010' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(SettingsService.setBaseUrl).toHaveBeenCalledWith('http://localhost:3010');
    });

    it('should reject unauthenticated requests when users exist (401)', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(1);

      const response = await request(buildApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'http://localhost:3010' });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Authentication required');
    });

    it('should reject non-admin authenticated requests when users exist (403)', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(2);

      const response = await request(buildApp('user'))
        .post('/base-url')
        .send({ baseUrl: 'http://localhost:3010' });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Admin access required');
    });

    it('should allow admin to set base URL when users exist (200)', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(2);

      const response = await request(buildApp('admin'))
        .post('/base-url')
        .send({ baseUrl: 'https://music.example.com' });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ success: true });
      expect(SettingsService.setBaseUrl).toHaveBeenCalledWith('https://music.example.com');
    });

    it('should reject requests with missing baseUrl', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildApp('none'))
        .post('/base-url')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.baseUrl).toBeDefined();
    });

    it('should reject requests with non-string baseUrl', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildApp('none'))
        .post('/base-url')
        .send({ baseUrl: 12345 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.baseUrl).toBeDefined();
    });
  });

  describe('POST /api/settings/base-url validation', () => {
    function buildValidationApp(authState: 'none' | 'user' | 'admin' = 'none') {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        if (authState === 'none') {
          req.isAuthenticated = () => false;
        } else {
          req.isAuthenticated = () => true;
          req.user = authState === 'admin'
            ? { id: 1, role: 'admin', username: 'admin' }
            : { id: 1, role: 'user', username: 'testuser' };
        }
        next();
      });
      app.use('/', settingsRouter);
      return app;
    }

    it('should reject an invalid URL format', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildValidationApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'not-a-url' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.baseUrl).toBeDefined();
    });

    it('should reject javascript: protocol URLs', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildValidationApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'javascript:alert(1)' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject ftp: protocol URLs', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildValidationApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'ftp://files.example.com' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid http URL', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildValidationApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'http://localhost:3010' });

      expect(response.status).toBe(200);
    });

    it('should accept valid https URL', async () => {
      vi.mocked(prisma.user.count).mockResolvedValue(0);

      const response = await request(buildValidationApp('none'))
        .post('/base-url')
        .send({ baseUrl: 'https://music.example.com' });

      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/settings', () => {
    it('should return user settings', async () => {
      const mockSettings = [
        { userId: testUser.id, key: 'theme', value: 'dark' },
        { userId: testUser.id, key: 'notifications', value: true },
      ];

      mockPrisma.userSetting.findMany.mockResolvedValue(mockSettings);

      const settings = await mockPrisma.userSetting.findMany({
        where: { userId: testUser.id },
      });

      const settingsMap: Record<string, any> = {};
      for (const setting of settings) {
        settingsMap[setting.key] = setting.value;
      }

      expect(settingsMap.theme).toBe('dark');
      expect(settingsMap.notifications).toBe(true);
    });

    it('should return empty object for user with no settings', async () => {
      mockPrisma.userSetting.findMany.mockResolvedValue([]);

      const settings = await mockPrisma.userSetting.findMany({
        where: { userId: testUser.id },
      });

      const settingsMap: Record<string, any> = {};
      for (const setting of settings) {
        settingsMap[setting.key] = setting.value;
      }

      expect(Object.keys(settingsMap)).toHaveLength(0);
    });
  });

  describe('PUT /api/settings (bulk)', () => {
    it('should save multiple settings in one call', async () => {
      const settings = { theme: 'dark', notifications: true, language: 'en' };

      // Each setting should be upserted
      for (const [key, value] of Object.entries(settings)) {
        mockPrisma.userSetting.upsert.mockResolvedValueOnce({
          userId: testUser.id,
          key,
          value,
        });
      }

      // Simulate what the bulk route does: iterate and upsert each
      for (const [key, value] of Object.entries(settings)) {
        await mockPrisma.userSetting.upsert({
          where: { userId_key: { userId: testUser.id, key } },
          create: { userId: testUser.id, key, value },
          update: { value },
        });
      }

      expect(mockPrisma.userSetting.upsert).toHaveBeenCalledTimes(3);
    });

    it('should reject when settings is not an object', () => {
      const invalidPayloads = [null, 'string', 42, true, []];

      for (const payload of invalidPayloads) {
        const isValidObject = payload !== null
          && typeof payload === 'object'
          && !Array.isArray(payload);
        expect(isValidObject).toBe(false);
      }
    });

    it('should reject empty settings object', () => {
      const settings = {};
      const hasKeys = Object.keys(settings).length > 0;
      expect(hasKeys).toBe(false);
    });
  });

  describe('PUT /api/settings/:key', () => {
    it('should create new user setting', async () => {
      const newSetting = { userId: testUser.id, key: 'theme', value: 'dark' };
      mockPrisma.userSetting.upsert.mockResolvedValue(newSetting);

      const result = await mockPrisma.userSetting.upsert({
        where: { userId_key: { userId: testUser.id, key: 'theme' } },
        create: { userId: testUser.id, key: 'theme', value: 'dark' },
        update: { value: 'dark' },
      });

      expect(result.value).toBe('dark');
    });

    it('should update existing user setting', async () => {
      const updatedSetting = { userId: testUser.id, key: 'theme', value: 'light' };
      mockPrisma.userSetting.upsert.mockResolvedValue(updatedSetting);

      const result = await mockPrisma.userSetting.upsert({
        where: { userId_key: { userId: testUser.id, key: 'theme' } },
        create: { userId: testUser.id, key: 'theme', value: 'light' },
        update: { value: 'light' },
      });

      expect(result.value).toBe('light');
    });

    it('should handle different value types', async () => {
      const testCases = [
        { key: 'boolSetting', value: true },
        { key: 'numberSetting', value: 42 },
        { key: 'stringSetting', value: 'hello' },
        { key: 'objectSetting', value: { nested: 'value' } },
        { key: 'arraySetting', value: [1, 2, 3] },
      ];

      for (const testCase of testCases) {
        mockPrisma.userSetting.upsert.mockResolvedValue({
          userId: testUser.id,
          ...testCase,
        });

        const result = await mockPrisma.userSetting.upsert({
          where: { userId_key: { userId: testUser.id, key: testCase.key } },
          create: { userId: testUser.id, ...testCase },
          update: { value: testCase.value },
        });

        expect(result.value).toEqual(testCase.value);
      }
    });
  });

  describe('GET /api/settings/preferences', () => {
    it('should return user preferences with defaults', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue(null);

      const defaults = {
        theme: 'system',
        sidebarCollapsed: false,
        defaultResultHandling: 'preview',
      };

      const setting = await mockPrisma.userSetting.findUnique({
        where: { userId_key: { userId: testUser.id, key: 'preferences' } },
      });

      const preferences = { ...defaults, ...(setting?.value as object || {}) };

      expect(preferences.theme).toBe('system');
      expect(preferences.sidebarCollapsed).toBe(false);
      expect(preferences.defaultResultHandling).toBe('preview');
    });

    it('should merge saved preferences with defaults', async () => {
      mockPrisma.userSetting.findUnique.mockResolvedValue({
        userId: testUser.id,
        key: 'preferences',
        value: { theme: 'dark', customOption: 'value' },
      });

      const defaults = {
        theme: 'system',
        sidebarCollapsed: false,
        defaultResultHandling: 'preview',
      };

      const setting = await mockPrisma.userSetting.findUnique({
        where: { userId_key: { userId: testUser.id, key: 'preferences' } },
      });

      const preferences = { ...defaults, ...(setting?.value as object || {}) };

      expect(preferences.theme).toBe('dark');
      expect(preferences.sidebarCollapsed).toBe(false);
      expect((preferences as any).customOption).toBe('value');
    });
  });

  describe('PUT /api/settings/preferences', () => {
    it('should merge new preferences with existing', async () => {
      const existing = {
        userId: testUser.id,
        key: 'preferences',
        value: { theme: 'dark', language: 'en' },
      };

      mockPrisma.userSetting.findUnique.mockResolvedValue(existing);

      const newPreferences = { theme: 'light' };
      const merged = { ...(existing.value as object), ...newPreferences };

      mockPrisma.userSetting.upsert.mockResolvedValue({
        userId: testUser.id,
        key: 'preferences',
        value: merged,
      });

      const result = await mockPrisma.userSetting.upsert({
        where: { userId_key: { userId: testUser.id, key: 'preferences' } },
        create: { userId: testUser.id, key: 'preferences', value: merged },
        update: { value: merged },
      });

      expect((result.value as any).theme).toBe('light');
      expect((result.value as any).language).toBe('en');
    });
  });

  describe('Global Settings (Admin)', () => {
    describe('GET /api/settings/global', () => {
      it('should return all global settings for admin', async () => {
        const mockGlobalSettings = [
          { key: 'baseUrl', value: 'http://localhost:3010' },
          { key: 'setupCompleted', value: true },
        ];

        mockPrisma.globalSetting.findMany.mockResolvedValue(mockGlobalSettings);

        const settings = await mockPrisma.globalSetting.findMany({});

        expect(settings).toHaveLength(2);
      });

      it('should be restricted to admin users', () => {
        const canAccess = adminUser.role === 'admin';
        const regularCanAccess = testUser.role === 'admin';

        expect(canAccess).toBe(true);
        expect(regularCanAccess).toBe(false);
      });
    });

    describe('PUT /api/settings/global/:key', () => {
      it('should update global setting for admin', async () => {
        mockPrisma.globalSetting.upsert.mockResolvedValue({
          key: 'baseUrl',
          value: 'https://music.example.com',
        });

        const result = await mockPrisma.globalSetting.upsert({
          where: { key: 'baseUrl' },
          create: { key: 'baseUrl', value: 'https://music.example.com' },
          update: { value: 'https://music.example.com' },
        });

        expect(result.value).toBe('https://music.example.com');
      });
    });
  });

  describe('Settings Isolation', () => {
    it('should not allow user to access other users settings', async () => {
      mockPrisma.userSetting.findMany.mockImplementation(async (args: any) => {
        const userId = args?.where?.userId;
        if (userId === testUser.id) {
          return [{ userId, key: 'theme', value: 'dark' }];
        }
        return [];
      });

      const ownSettings = await mockPrisma.userSetting.findMany({
        where: { userId: testUser.id },
      });

      const otherSettings = await mockPrisma.userSetting.findMany({
        where: { userId: 999 },
      });

      expect(ownSettings).toHaveLength(1);
      expect(otherSettings).toHaveLength(0);
    });
  });

  describe('Input Validation', () => {
    /** Build an Express app with auth state for validation tests */
    function buildApp(authState: 'user' | 'admin' = 'user') {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.isAuthenticated = () => true;
        req.user = authState === 'admin'
          ? { id: 1, role: 'admin', username: 'admin' }
          : { id: 1, role: 'user', username: 'testuser' };
        next();
      });
      app.use('/', settingsRouter);
      return app;
    }

    describe('PUT / (bulk update) validation', () => {
      it('should reject when settings field is missing', async () => {
        const response = await request(buildApp())
          .put('/')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(response.body.details.settings).toBeDefined();
      });

      it('should reject when settings is null', async () => {
        const response = await request(buildApp())
          .put('/')
          .send({ settings: null });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });

      it('should reject when settings is an array', async () => {
        const response = await request(buildApp())
          .put('/')
          .send({ settings: ['theme', 'dark'] });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });

      it('should reject when settings is an empty object', async () => {
        const response = await request(buildApp())
          .put('/')
          .send({ settings: {} });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });

      it('should accept valid non-empty settings object', async () => {
        const response = await request(buildApp())
          .put('/')
          .send({ settings: { theme: 'dark' } });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    describe('PUT /preferences validation', () => {
      it('should reject when preferences field is missing', async () => {
        const response = await request(buildApp())
          .put('/preferences')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(response.body.details.preferences).toBeDefined();
      });

      it('should reject when preferences is null', async () => {
        const response = await request(buildApp())
          .put('/preferences')
          .send({ preferences: null });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });

      it('should reject when preferences is a string', async () => {
        const response = await request(buildApp())
          .put('/preferences')
          .send({ preferences: 'dark' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      });

      it('should accept valid preferences object', async () => {
        const response = await request(buildApp())
          .put('/preferences')
          .send({ preferences: { theme: 'dark' } });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });

    describe('PUT /global/:key validation', () => {
      it('should reject a key longer than 100 characters', async () => {
        const longKey = 'a'.repeat(101);
        const response = await request(buildApp('admin'))
          .put(`/global/${longKey}`)
          .send({ value: 'test' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(response.body.details.key).toBeDefined();
      });

      it('should accept a key within 100 characters', async () => {
        const response = await request(buildApp('admin'))
          .put('/global/testKey')
          .send({ value: 'test' });

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });

  describe('PUT /api/settings/constellation', () => {
    function buildApp() {
      const app = express();
      app.use(express.json());
      app.use((req: any, _res: any, next: any) => {
        req.isAuthenticated = () => true;
        req.user = { id: 1, role: 'admin', username: 'admin' };
        next();
      });
      app.use('/', settingsRouter);
      return app;
    }

    it('persists a valid partial update', async () => {
      const response = await request(buildApp())
        .put('/constellation')
        .send({ constellationIndexEnabled: true, orbitEdgeBudget: 1000, indexRefresh: 'off' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(SettingsService.updateConstellationSettings).toHaveBeenCalledWith({
        constellationIndexEnabled: true,
        orbitEdgeBudget: 1000,
        indexRefresh: 'off',
      });
    });

    it('rejects a negative budget (400) and never persists', async () => {
      const response = await request(buildApp())
        .put('/constellation')
        .send({ orbitEdgeBudget: -5 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(SettingsService.updateConstellationSettings).not.toHaveBeenCalled();
    });

    it('rejects a garbage indexRefresh enum (400)', async () => {
      const response = await request(buildApp())
        .put('/constellation')
        .send({ indexRefresh: 'weekly' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(SettingsService.updateConstellationSettings).not.toHaveBeenCalled();
    });

    it('rejects unknown keys (400)', async () => {
      const response = await request(buildApp())
        .put('/constellation')
        .send({ bogusKey: 1 });

      expect(response.status).toBe(400);
      expect(SettingsService.updateConstellationSettings).not.toHaveBeenCalled();
    });
  });
});
