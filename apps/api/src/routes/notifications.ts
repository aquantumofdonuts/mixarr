/**
 * Notification Channels API Routes
 * 
 * CRUD operations for notification channel management:
 * - GET /api/notifications/channels - List channels
 * - POST /api/notifications/channels - Create channel
 * - PUT /api/notifications/channels/:id - Update channel
 * - DELETE /api/notifications/channels/:id - Delete channel
 * - POST /api/notifications/channels/:id/test - Send test notification
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { requireAuth } from '../middleware/auth.js';
import { parseIntParam } from '../utils/params.js';
import { NotificationEvent } from '../services/notifications.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('NotificationsRoute');

const router = Router();

// Validation schemas
const CreateChannelSchema = z.object({
  type: z.enum(['discord', 'webhook', 'telegram', 'pushover', 'email']),
  name: z.string().min(1).max(100),
  config: z.record(z.any()),
  events: z.array(z.string()),
  isActive: z.boolean().optional().default(true),
});

const UpdateChannelSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.any()).optional(),
  events: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

// Valid notification events
const VALID_EVENTS: NotificationEvent[] = [
  'subscription.completed',
  'subscription.failed',
  'review.pending',
  'artist.added',
  'artist.failed',
  'enrichment.completed',
];

/** Sentinel value for masked secrets — detected in PUT to preserve existing values */
const SECRET_MASK = '••••••••';

/** Keys containing secrets per channel type */
const SENSITIVE_KEYS: Record<string, string[]> = {
  discord: ['webhookUrl'],
  telegram: ['botToken'],
  pushover: ['appToken', 'userKey'],
  email: ['password'],
  webhook: ['headers'],
};

/** Mask sensitive fields in channel config for API responses */
function sanitizeChannelConfig(type: string, config: Record<string, any>): Record<string, any> {
  const sanitized = { ...config };
  for (const key of SENSITIVE_KEYS[type] || []) {
    if (sanitized[key] != null) {
      sanitized[key] = SECRET_MASK;
    }
  }
  return sanitized;
}

/**
 * GET /api/notifications/channels
 * List all notification channels for the current user
 */
router.get('/channels', requireAuth, async (req: Request, res: Response) => {
  try {
    const channels = await prisma.notificationChannel.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json(channels.map(ch => ({
      ...ch,
      config: sanitizeChannelConfig(ch.type, ch.config as Record<string, any>),
    })));
  } catch (error) {
    logger.error('Failed to fetch notification channels', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id },
    });
    res.status(500).json({ error: 'Failed to fetch notification channels' });
  }
});

/**
 * GET /api/notifications/events
 * List available notification events
 * Returns raw event strings - frontend handles formatting
 */
router.get('/events', requireAuth, async (_req: Request, res: Response) => {
  res.json(VALID_EVENTS);
});

/**
 * POST /api/notifications/channels
 * Create a new notification channel
 */
router.post('/channels', requireAuth, async (req: Request, res: Response) => {
  try {
    const data = CreateChannelSchema.parse(req.body);

    // Validate events
    const invalidEvents = data.events.filter(e => !VALID_EVENTS.includes(e as NotificationEvent));
    if (invalidEvents.length > 0) {
      return res.status(400).json({ 
        error: `Invalid events: ${invalidEvents.join(', ')}`,
        validEvents: VALID_EVENTS,
      });
    }

    // Validate config based on type
    const configError = validateConfig(data.type, data.config);
    if (configError) {
      return res.status(400).json({ error: configError });
    }

    const channel = await prisma.notificationChannel.create({
      data: {
        userId: req.user!.id,
        type: data.type,
        name: data.name,
        config: data.config,
        events: data.events,
        isActive: data.isActive,
      },
    });

    res.status(201).json({
      ...channel,
      config: sanitizeChannelConfig(channel.type, channel.config as Record<string, any>),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error('Failed to create notification channel', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, type: req.body?.type },
    });
    res.status(500).json({ error: 'Failed to create notification channel' });
  }
});

/**
 * PUT /api/notifications/channels/:id
 * Update a notification channel
 */
router.put('/channels/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (channelId === null) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Check ownership
    const existing = await prisma.notificationChannel.findFirst({
      where: { id: channelId, userId: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Notification channel not found' });
    }

    const data = UpdateChannelSchema.parse(req.body);

    // Validate events if provided
    if (data.events) {
      const invalidEvents = data.events.filter(e => !VALID_EVENTS.includes(e as NotificationEvent));
      if (invalidEvents.length > 0) {
        return res.status(400).json({ 
          error: `Invalid events: ${invalidEvents.join(', ')}`,
          validEvents: VALID_EVENTS,
        });
      }
    }

    // Validate config if provided
    if (data.config) {
      const configError = validateConfig(existing.type, data.config);
      if (configError) {
        return res.status(400).json({ error: configError });
      }
    }

    // Preserve secrets when frontend sends back masked values
    if (data.config) {
      const existingConfig = existing.config as Record<string, any>;
      for (const [key, value] of Object.entries(data.config)) {
        if (value === SECRET_MASK) {
          data.config[key] = existingConfig[key];
        }
      }
    }

    const channel = await prisma.notificationChannel.update({
      where: { id: channelId },
      data: {
        name: data.name,
        config: data.config,
        events: data.events,
        isActive: data.isActive,
      },
    });

    res.json({
      ...channel,
      config: sanitizeChannelConfig(channel.type, channel.config as Record<string, any>),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: error.errors });
    }
    logger.error('Failed to update notification channel', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, channelId: req.params?.id },
    });
    res.status(500).json({ error: 'Failed to update notification channel' });
  }
});

/**
 * DELETE /api/notifications/channels/:id
 * Delete a notification channel
 */
router.delete('/channels/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (channelId === null) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Check ownership
    const existing = await prisma.notificationChannel.findFirst({
      where: { id: channelId, userId: req.user!.id },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Notification channel not found' });
    }

    await prisma.notificationChannel.delete({
      where: { id: channelId },
    });

    res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete notification channel', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, channelId: req.params?.id },
    });
    res.status(500).json({ error: 'Failed to delete notification channel' });
  }
});

/**
 * POST /api/notifications/channels/:id/test
 * Send a test notification to a channel
 */
router.post('/channels/:id/test', requireAuth, async (req: Request, res: Response) => {
  try {
    const channelId = parseIntParam(req.params.id);
    if (channelId === null) {
      return res.status(400).json({ error: 'Invalid channel ID' });
    }

    // Check ownership
    const channel = await prisma.notificationChannel.findFirst({
      where: { id: channelId, userId: req.user!.id },
    });

    if (!channel) {
      return res.status(404).json({ error: 'Notification channel not found' });
    }

    // Send test notification directly (bypass event filtering)
    await sendTestNotification(channel);

    res.json({ success: true, message: 'Test notification sent' });
  } catch (error) {
    logger.error('Failed to send test notification', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context: { userId: req.user?.id, channelId: req.params?.id },
    });
    res.status(500).json({ 
      error: 'Failed to send test notification',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Send a test notification directly to a channel
 */
async function sendTestNotification(channel: any): Promise<void> {
  const config = channel.config as Record<string, any>;
  
  switch (channel.type) {
    case 'discord': {
      const embed = {
        title: '🧪 Test Notification',
        description: 'This is a test notification from Mixarr.',
        color: 0x00ff00,
        fields: [
          { name: 'Channel', value: channel.name, inline: true },
          { name: 'Status', value: 'Working!', inline: true },
        ],
        timestamp: new Date().toISOString(),
      };

      const response = await fetchWithTimeout(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: config.username || 'Mixarr',
          avatar_url: config.avatarUrl,
          embeds: [embed],
        }),
        timeout: 15_000,
      });

      if (!response.ok) {
        throw new Error(`Discord webhook failed: ${response.status} ${response.statusText}`);
      }
      break;
    }
    
    case 'webhook': {
      const response = await fetchWithTimeout(config.url, {
        method: config.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...config.headers,
        },
        body: JSON.stringify({
          event: 'test',
          timestamp: new Date().toISOString(),
          message: 'Test notification from Mixarr',
          channel: channel.name,
        }),
        timeout: 15_000,
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status} ${response.statusText}`);
      }
      break;
    }

    default:
      throw new Error(`Test notification not implemented for type: ${channel.type}`);
  }
}

/**
 * Validate channel config based on type
 */
function validateConfig(type: string, config: Record<string, any>): string | null {
  switch (type) {
    case 'discord':
      if (!config.webhookUrl) {
        return 'Discord webhook URL is required';
      }
      if (!config.webhookUrl.startsWith('https://discord.com/api/webhooks/')) {
        return 'Invalid Discord webhook URL format';
      }
      break;
      
    case 'webhook':
      if (!config.url) {
        return 'Webhook URL is required';
      }
      if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
        return 'Webhook URL must start with http:// or https://';
      }
      break;
      
    case 'telegram':
      if (!config.botToken || !config.chatId) {
        return 'Telegram bot token and chat ID are required';
      }
      break;
      
    case 'pushover':
      if (!config.userKey || !config.appToken) {
        return 'Pushover user key and app token are required';
      }
      break;
      
    case 'email':
      if (!config.smtpHost || !config.from || !config.to) {
        return 'SMTP host, from, and to addresses are required';
      }
      break;
  }
  
  return null;
}

export default router;
