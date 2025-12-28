/**
 * Notification Service Tests
 * 
 * Tests:
 * - Discord webhook integration
 * - Generic webhook support
 * - Event formatting
 * - Channel filtering
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NotificationService, NotificationEvent } from '../../src/services/notifications.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock Prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    notificationChannel: {
      findMany: vi.fn(),
    },
  },
}));

import prisma from '../../src/lib/db.js';

describe('NotificationService', () => {
  let service: NotificationService;
  const testUserId = 1;

  beforeEach(() => {
    service = new NotificationService();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('send', () => {
    it('should send notification to all matching channels', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['subscription.completed'],
          isActive: true,
        },
        {
          id: 2,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/456/def' },
          events: ['subscription.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'subscription.completed', {
        subscriptionName: 'My Subscription',
        artistCount: 10,
        queuedCount: 5,
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should not send to inactive channels', async () => {
      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue([]);

      await service.send(testUserId, 'subscription.completed', {});

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should continue sending to other channels if one fails', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['subscription.completed'],
          isActive: true,
        },
        {
          id: 2,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/456/def' },
          events: ['subscription.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ ok: true });

      await service.send(testUserId, 'subscription.completed', {});

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('sendDiscord', () => {
    it('should send subscription.completed notification with embed', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { 
            webhookUrl: 'https://discord.com/api/webhooks/123/abc',
            username: 'Mixarr Bot',
          },
          events: ['subscription.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'subscription.completed', {
        subscriptionName: 'My Subscription',
        artistCount: 10,
        queuedCount: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe('Mixarr Bot');
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0].title).toContain('Subscription Complete');
    });

    it('should send subscription.failed notification', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['subscription.failed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'subscription.failed', {
        subscriptionName: 'My Subscription',
        error: 'API rate limited',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].title).toContain('Subscription Failed');
      expect(body.embeds[0].color).toBe(0xff0000);
    });

    it('should send review.pending notification', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['review.pending'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'review.pending', {
        count: 15,
        sources: ['Spotify', 'Last.fm'],
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].title).toContain('Review Queue');
      expect(body.embeds[0].description).toContain('15');
    });

    it('should send artist.added notification with thumbnail', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['artist.added'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'artist.added', {
        artistName: 'Radiohead',
        imageUrl: 'https://example.com/radiohead.jpg',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].title).toContain('Artist Added');
      expect(body.embeds[0].thumbnail.url).toBe('https://example.com/radiohead.jpg');
    });

    it('should use default username when not specified', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['artist.added'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'artist.added', { artistName: 'Test' });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.username).toBe('Mixarr');
    });
  });

  describe('sendWebhook', () => {
    it('should send generic webhook with default format', async () => {
      const channels = [
        {
          id: 1,
          type: 'webhook',
          config: { 
            url: 'https://example.com/webhook',
            method: 'POST',
          },
          events: ['subscription.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'subscription.completed', {
        subscriptionName: 'My Sub',
        artistCount: 5,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
        })
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.event).toBe('subscription.completed');
      expect(body.subscriptionName).toBe('My Sub');
    });

    it('should include custom headers', async () => {
      const channels = [
        {
          id: 1,
          type: 'webhook',
          config: { 
            url: 'https://example.com/webhook',
            method: 'POST',
            headers: { 'Authorization': 'Bearer token123' },
          },
          events: ['subscription.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'subscription.completed', {});

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers['Authorization']).toBe('Bearer token123');
    });
  });

  describe('formatDiscordEmbed', () => {
    it('should format enrichment.completed event', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['enrichment.completed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'enrichment.completed', {
        artistCount: 25,
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].title).toContain('Enrichment');
      expect(body.embeds[0].description).toContain('25');
    });

    it('should format artist.failed event', async () => {
      const channels = [
        {
          id: 1,
          type: 'discord',
          config: { webhookUrl: 'https://discord.com/api/webhooks/123/abc' },
          events: ['artist.failed'],
          isActive: true,
        },
      ];

      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue(channels as any);

      await service.send(testUserId, 'artist.failed', {
        artistName: 'Unknown Artist',
        error: 'Artist not found in MusicBrainz',
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.embeds[0].title).toContain('Add Failed');
      expect(body.embeds[0].color).toBe(0xff0000);
    });
  });

  describe('event filtering', () => {
    it('should only query channels subscribed to the event', async () => {
      vi.mocked(prisma.notificationChannel.findMany).mockResolvedValue([]);

      await service.send(testUserId, 'subscription.completed', {});

      expect(prisma.notificationChannel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: testUserId,
            isActive: true,
          }),
        })
      );
    });
  });
});
