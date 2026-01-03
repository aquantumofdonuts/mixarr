/**
 * Notification Service
 * 
 * Handles sending notifications to various channels:
 * - Discord webhooks
 * - Generic webhooks
 * - Telegram (future)
 * - Pushover (future)
 * - Email (future)
 */

import prisma from '../lib/db.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('Notifications');

// Notification event types
export type NotificationEvent =
  | 'subscription.completed'
  | 'subscription.failed'
  | 'review.pending'
  | 'artist.added'
  | 'artist.failed'
  | 'enrichment.completed';

// Discord embed structure
interface DiscordEmbed {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  thumbnail?: { url: string };
  timestamp?: string;
}

// Channel configuration types
interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
}

interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  template?: string;
}

interface NotificationChannel {
  id: number;
  type: string;
  config: DiscordConfig | WebhookConfig | Record<string, any>;
  events: string[];
  isActive: boolean;
}

export class NotificationService {
  /**
   * Send a notification to all matching channels for a user
   */
  async send(
    userId: number,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    // Get active channels for this user that subscribe to this event
    const channels = await prisma.notificationChannel.findMany({
      where: {
        userId,
        isActive: true,
      },
    });

    // Filter channels that subscribe to this event
    const matchingChannels = channels.filter((channel) => {
      const events = channel.events as string[];
      return Array.isArray(events) && events.includes(event);
    });

    // Send to each channel (don't fail if one fails)
    for (const channel of matchingChannels) {
      try {
        await this.sendToChannel(channel as unknown as NotificationChannel, event, payload);
      } catch (error) {
        log.error(`Notification failed for channel ${channel.id}:`, error);
      }
    }
  }

  /**
   * Route notification to appropriate handler based on channel type
   */
  private async sendToChannel(
    channel: NotificationChannel,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    switch (channel.type) {
      case 'discord':
        return this.sendDiscord(channel.config as DiscordConfig, event, payload);
      case 'webhook':
        return this.sendWebhook(channel.config as WebhookConfig, event, payload);
      case 'telegram':
        // Future: implement Telegram
        log.warn('Telegram notifications not yet implemented');
        break;
      case 'pushover':
        // Future: implement Pushover
        log.warn('Pushover notifications not yet implemented');
        break;
      case 'email':
        // Future: implement email
        log.warn('Email notifications not yet implemented');
        break;
      default:
        log.warn(`Unknown notification channel type: ${channel.type}`);
    }
  }

  /**
   * Send notification to Discord webhook
   */
  private async sendDiscord(
    config: DiscordConfig,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    const embed = this.formatDiscordEmbed(event, payload);

    await fetch(config.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: config.username || 'Mixarr',
        avatar_url: config.avatarUrl,
        embeds: [embed],
      }),
    });
  }

  /**
   * Send notification to generic webhook
   */
  private async sendWebhook(
    config: WebhookConfig,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    const body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    });

    await fetch(config.url, {
      method: config.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...config.headers,
      },
      body,
    });
  }

  /**
   * Format Discord embed based on event type
   */
  private formatDiscordEmbed(
    event: NotificationEvent,
    payload: Record<string, any>
  ): DiscordEmbed {
    const timestamp = new Date().toISOString();

    switch (event) {
      case 'subscription.completed':
        return {
          title: 'Subscription Complete',
          description: `**${payload.subscriptionName}** finished`,
          fields: [
            { name: 'Artists Found', value: String(payload.artistCount || 0), inline: true },
            { name: 'Added to Queue', value: String(payload.queuedCount || 0), inline: true },
          ],
          color: 0x00ff00, // Green
          timestamp,
        };

      case 'subscription.failed':
        return {
          title: 'Subscription Failed',
          description: `**${payload.subscriptionName}** encountered an error`,
          fields: [
            { name: 'Error', value: payload.error || 'Unknown error' },
          ],
          color: 0xff0000, // Red
          timestamp,
        };

      case 'review.pending':
        return {
          title: 'Review Queue',
          description: `${payload.count} artists pending review`,
          fields: payload.sources?.length
            ? [{ name: 'Sources', value: payload.sources.join(', ') }]
            : undefined,
          color: 0xffaa00, // Orange
          timestamp,
        };

      case 'artist.added':
        return {
          title: 'Artist Added',
          description: `**${payload.artistName}** added to Lidarr`,
          color: 0x00aaff, // Blue
          thumbnail: payload.imageUrl ? { url: payload.imageUrl } : undefined,
          timestamp,
        };

      case 'artist.failed':
        return {
          title: 'Artist Add Failed',
          description: `Failed to add **${payload.artistName}**`,
          fields: [
            { name: 'Error', value: payload.error || 'Unknown error' },
          ],
          color: 0xff0000, // Red
          timestamp,
        };

      case 'enrichment.completed':
        return {
          title: 'Enrichment Complete',
          description: `Metadata enriched for ${payload.artistCount} artists`,
          color: 0x9b59b6, // Purple
          timestamp,
        };

      default:
        return {
          title: 'Mixarr Notification',
          description: JSON.stringify(payload),
          color: 0x808080, // Gray
          timestamp,
        };
    }
  }
}

// Singleton instance for easy import
export const notificationService = new NotificationService();
