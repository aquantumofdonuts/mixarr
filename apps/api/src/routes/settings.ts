import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { createLogger } from '../lib/logger.js';
import { SettingsService } from '../services/settings.service.js';
import prisma from '../lib/db.js';
import {
  setBaseUrlSchema,
  bulkUpdateSettingsSchema,
  userSettingKeySchema,
  updatePreferencesSchema,
  globalSettingKeySchema,
  bulkUpdateGlobalSettingsSchema,
} from '../schemas/settings.js';

const logger = createLogger('SettingsRoute');

export const settingsRouter = Router();

// Public endpoint - get base URL (needed for OAuth redirect URI display)
settingsRouter.get('/base-url', async (_req, res) => {
  try {
    const baseUrl = await SettingsService.getBaseUrl();
    res.json({ baseUrl });
  } catch (error) {
    logger.error('Failed to get base URL', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to get base URL' });
  }
});

// Set base URL - open during setup (no users), admin-only after setup
settingsRouter.post('/base-url', validateBody(setBaseUrlSchema), async (req, res) => {
  try {
    // Check if setup is complete (users exist in DB)
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      // After setup: require authentication + admin role
      // Use middleware-style inline checks to keep it in one handler
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }
      if (req.user?.role !== 'admin') {
        res.status(403).json({ error: 'Admin access required' });
        return;
      }
    }

    const { baseUrl } = req.body;

    await SettingsService.setBaseUrl(baseUrl);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to set base URL', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to set base URL' });
  }
});

settingsRouter.use(requireAuth);

// Get user settings
settingsRouter.get('/', async (req, res) => {
  try {
    const settings = await SettingsService.getUserSettings(req.user!.id);
    res.json({ settings });
  } catch (error) {
    logger.error('Failed to fetch settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Bulk update user settings
settingsRouter.put('/', validateBody(bulkUpdateSettingsSchema), async (req, res) => {
  try {
    const { settings } = req.body;

    for (const [key, value] of Object.entries(settings)) {
      await SettingsService.setUserSetting(req.user!.id, key, value as any);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to bulk update settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Get user preferences (convenience endpoint)
settingsRouter.get('/preferences', async (req, res) => {
  try {
    const preferences = await SettingsService.getUserPreferences(req.user!.id);
    res.json({ preferences });
  } catch (error) {
    logger.error('Failed to fetch preferences', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

// Update user preferences
settingsRouter.put('/preferences', validateBody(updatePreferencesSchema), async (req, res) => {
  try {
    const { preferences } = req.body;
    
    const merged = await SettingsService.updateUserPreferences(req.user!.id, preferences);
    
    res.json({ success: true, preferences: merged });
  } catch (error) {
    logger.error('Failed to update preferences', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Admin: Get Collaboration Constellation settings (merged over defaults).
// Registered BEFORE the catch-all PUT /:key so those verbs are not shadowed.
settingsRouter.get('/constellation', requireAdmin, async (_req, res) => {
  try {
    const settings = await SettingsService.getConstellationSettings();
    res.json({ settings });
  } catch (error) {
    logger.error('Failed to fetch constellation settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch constellation settings' });
  }
});

// Admin: Update Collaboration Constellation settings (partial merge).
settingsRouter.put('/constellation', requireAdmin, async (req, res) => {
  try {
    const updates = (req.body?.settings ?? req.body ?? {}) as Record<string, unknown>;
    const merged = await SettingsService.updateConstellationSettings(updates);
    res.json({ success: true, settings: merged });
  } catch (error) {
    logger.error('Failed to update constellation settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to update constellation settings' });
  }
});

// Update user setting (must come after /preferences to avoid shadowing)
settingsRouter.put('/:key', validateParams(userSettingKeySchema), async (req, res) => {
  const { key } = req.params;
  try {
    const { value } = req.body;
    
    await SettingsService.setUserSetting(req.user!.id, key, value);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update setting', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { key },
    });
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Admin: Get global settings
settingsRouter.get('/global', requireAdmin, async (_req, res) => {
  try {
    const settings = await SettingsService.getGlobalSettings();
    res.json({ settings });
  } catch (error) {
    logger.error('Failed to fetch global settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to fetch global settings' });
  }
});

// Admin: Bulk update global settings
settingsRouter.put('/global', requireAdmin, validateBody(bulkUpdateGlobalSettingsSchema), async (req, res) => {
  try {
    const { settings } = req.body;

    for (const [key, value] of Object.entries(settings)) {
      await SettingsService.setGlobalSetting(key, value as any);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to bulk update global settings', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'Failed to save global settings' });
  }
});

// Admin: Update global setting
settingsRouter.put('/global/:key', requireAdmin, validateParams(globalSettingKeySchema), async (req, res) => {
  const { key } = req.params;
  try {
    const { value } = req.body;
    
    await SettingsService.setGlobalSetting(key, value);
    
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update global setting', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { key },
    });
    res.status(500).json({ error: 'Failed to update global setting' });
  }
});

