/**
 * AI Settings Routes
 * 
 * Manages AI configuration for OpenAI and Anthropic integrations.
 */

import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { aiService } from '../services/ai.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('AIRoute');

export const aiRouter = Router();

// All AI routes require authentication
aiRouter.use(requireAuth);

// Get AI settings (admin only for API keys)
aiRouter.get('/settings', async (req, res) => {
  try {
    const settings = await prisma.aISettings.findFirst();
    
    if (!settings) {
      // Return default settings if none exist
      res.json({
        settings: {
          openaiEnabled: false,
          openaiConfigured: false,
          anthropicEnabled: false,
          anthropicConfigured: false,
        },
      });
      return;
    }

    // For non-admins, hide API keys but show if configured
    const isAdmin = req.user?.role === 'admin';
    
    res.json({
      settings: {
        openaiEnabled: settings.openaiEnabled,
        openaiConfigured: !!settings.openaiApiKey,
        openaiApiKey: isAdmin ? settings.openaiApiKey : undefined,
        anthropicEnabled: settings.anthropicEnabled,
        anthropicConfigured: !!settings.anthropicApiKey,
        anthropicApiKey: isAdmin ? settings.anthropicApiKey : undefined,
      },
    });
  } catch (error) {
    logger.error('Failed to get AI settings', { error });
    res.status(500).json({ error: 'Failed to get AI settings' });
  }
});

// Update AI settings (admin only)
aiRouter.put('/settings', requireAdmin, async (req, res) => {
  try {
    const {
      openaiApiKey,
      openaiEnabled,
      openaiStrategy,
      anthropicApiKey,
      anthropicEnabled,
      anthropicStrategy,
    } = req.body;

    // Get existing settings or create new
    let settings = await prisma.aISettings.findFirst();
    
    const data: any = {};
    
    // Only update fields that were provided
    if (typeof openaiEnabled === 'boolean') {
      data.openaiEnabled = openaiEnabled;
    }
    if (openaiStrategy && ['similar', 'genre_expansion', 'discovery'].includes(openaiStrategy)) {
      data.openaiStrategy = openaiStrategy;
    }
    if (openaiApiKey !== undefined) {
      // Allow setting to null/empty to clear, or set new key
      data.openaiApiKey = openaiApiKey || null;
    }
    
    if (typeof anthropicEnabled === 'boolean') {
      data.anthropicEnabled = anthropicEnabled;
    }
    if (anthropicStrategy && ['similar', 'genre_expansion', 'discovery'].includes(anthropicStrategy)) {
      data.anthropicStrategy = anthropicStrategy;
    }
    if (anthropicApiKey !== undefined) {
      data.anthropicApiKey = anthropicApiKey || null;
    }

    if (settings) {
      settings = await prisma.aISettings.update({
        where: { id: settings.id },
        data,
      });
    } else {
      settings = await prisma.aISettings.create({
        data: {
          openaiEnabled: data.openaiEnabled ?? false,
          openaiStrategy: data.openaiStrategy ?? 'similar',
          openaiApiKey: data.openaiApiKey ?? null,
          anthropicEnabled: data.anthropicEnabled ?? false,
          anthropicStrategy: data.anthropicStrategy ?? 'similar',
          anthropicApiKey: data.anthropicApiKey ?? null,
        },
      });
    }

    // Reload AI service settings
    await aiService.loadSettings();

    res.json({
      success: true,
      settings: {
        openaiEnabled: settings.openaiEnabled,
        openaiConfigured: !!settings.openaiApiKey,
        anthropicEnabled: settings.anthropicEnabled,
        anthropicConfigured: !!settings.anthropicApiKey,
      },
    });
  } catch (error) {
    logger.error('Failed to update AI settings', { error });
    res.status(500).json({ error: 'Failed to update AI settings' });
  }
});

// Test AI connection
aiRouter.post('/test', requireAdmin, async (req, res) => {
  try {
    const { provider } = req.body;

    if (!provider || !['openai', 'anthropic'].includes(provider)) {
      res.status(400).json({ error: 'Provider must be openai or anthropic' });
      return;
    }

    // Reload settings to get latest
    await aiService.loadSettings();

    // Try to get recommendations with a simple artist
    const testArtists = ['The Beatles'];
    const recommendations = await aiService.getRecommendations(testArtists, 5);

    // Check if we got recommendations from the requested provider
    const providerRecs = recommendations.filter(r => r.source === provider);

    if (providerRecs.length > 0) {
      res.json({
        success: true,
        message: `${provider} connection successful`,
        sampleRecommendations: providerRecs.slice(0, 3).map(r => r.name),
      });
    } else {
      res.json({
        success: false,
        error: `No recommendations received from ${provider}. Check API key.`,
      });
    }
  } catch (error) {
    logger.error('AI test failed', { error });
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'AI test failed' 
    });
  }
});

// Get AI recommendations (for testing/preview)
aiRouter.post('/recommendations', async (req, res) => {
  try {
    const { artists, maxRecommendations = 10 } = req.body;

    if (!artists || !Array.isArray(artists) || artists.length === 0) {
      res.status(400).json({ error: 'Artists array required' });
      return;
    }

    const recommendations = await aiService.getRecommendations(
      artists,
      Math.min(maxRecommendations, 50)
    );

    res.json({ recommendations });
  } catch (error) {
    logger.error('Failed to get AI recommendations', { error });
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Check AI availability
aiRouter.get('/status', async (_req, res) => {
  try {
    const available = await aiService.isAvailable();
    res.json({ available });
  } catch (error) {
    res.json({ available: false });
  }
});

// Get user's AI preferences (per-user settings)
aiRouter.get('/preferences', async (req, res) => {
  try {
    const userId = req.user!.id;
    
    // Get user-specific AI preferences
    const userSetting = await prisma.userSetting.findUnique({
      where: {
        userId_key: {
          userId,
          key: 'ai_preferences',
        },
      },
    });

    const defaults = {
      strategy: 'similar',
      maxRecommendations: 20,
      enabled: true,
    };

    if (!userSetting) {
      res.json({ preferences: defaults });
      return;
    }

    res.json({
      preferences: {
        ...defaults,
        ...(userSetting.value as Record<string, any>),
      },
    });
  } catch (error) {
    logger.error('Failed to get AI preferences', { error });
    res.status(500).json({ error: 'Failed to get AI preferences' });
  }
});

// Update user's AI preferences (per-user settings)
aiRouter.put('/preferences', async (req, res) => {
  try {
    const userId = req.user!.id;
    const { strategy, maxRecommendations, enabled } = req.body;

    const preferences: Record<string, any> = {};
    
    if (strategy && ['similar', 'genre_expansion', 'discovery'].includes(strategy)) {
      preferences.strategy = strategy;
    }
    if (typeof maxRecommendations === 'number' && maxRecommendations > 0 && maxRecommendations <= 50) {
      preferences.maxRecommendations = maxRecommendations;
    }
    if (typeof enabled === 'boolean') {
      preferences.enabled = enabled;
    }

    // Get existing preferences
    const existing = await prisma.userSetting.findUnique({
      where: {
        userId_key: {
          userId,
          key: 'ai_preferences',
        },
      },
    });

    const currentPrefs = existing?.value as Record<string, any> || {
      strategy: 'similar',
      maxRecommendations: 20,
      enabled: true,
    };

    const newPrefs = { ...currentPrefs, ...preferences };

    await prisma.userSetting.upsert({
      where: {
        userId_key: {
          userId,
          key: 'ai_preferences',
        },
      },
      update: { value: newPrefs },
      create: {
        userId,
        key: 'ai_preferences',
        value: newPrefs,
      },
    });

    res.json({ success: true, preferences: newPrefs });
  } catch (error) {
    logger.error('Failed to update AI preferences', { error });
    res.status(500).json({ error: 'Failed to update AI preferences' });
  }
});
