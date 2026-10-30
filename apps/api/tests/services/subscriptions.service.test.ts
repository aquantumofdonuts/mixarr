/**
 * SubscriptionService Tests
 * 
 * Tests for the subscription service.
 * Tests cover:
 * - CRUD operations (findAll, findById, create, update, delete)
 * - Ownership verification
 * - Error handling (NotFoundError)
 * - Execute functionality
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockPrisma, createMockSubscription, resetIdCounter } from '../utils/fixtures.js';

// Mock the db module
vi.mock('../../src/lib/db.js', () => ({
  default: createMockPrisma(),
}));

// Mock the logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock the scheduler
vi.mock('../../src/jobs/scheduler.js', () => ({
  addScheduledJob: vi.fn(),
  removeScheduledJob: vi.fn(),
}));

// Mock the queue
vi.mock('../../src/jobs/queue.js', () => ({
  scheduleSubscriptionJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
}));

// Import after mocks are set up
import { SubscriptionService, NotFoundError } from '../../src/services/subscriptions.service.js';
import prisma from '../../src/lib/db.js';
import { addScheduledJob, removeScheduledJob } from '../../src/jobs/scheduler.js';
import { scheduleSubscriptionJob } from '../../src/jobs/queue.js';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = prisma as unknown as ReturnType<typeof createMockPrisma>;
    service = new SubscriptionService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('findAll', () => {
    it('should return all subscriptions for a user', async () => {
      const userId = 1;
      const mockSubscriptions = [
        createMockSubscription({ id: 1, userId, name: 'Subscription 1' }),
        createMockSubscription({ id: 2, userId, name: 'Subscription 2' }),
      ];

      mockPrisma.subscription.findMany.mockResolvedValue(mockSubscriptions);

      const result = await service.findAll(userId);

      expect(result).toEqual(mockSubscriptions);
      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: {
          user: { select: { username: true, displayName: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when user has no subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const result = await service.findAll(999);

      expect(result).toEqual([]);
    });
  });

  describe('findById', () => {
    it('should return subscription when user owns it', async () => {
      const userId = 1;
      const subscription = createMockSubscription({ id: 1, userId });

      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.findById(1, userId);

      expect(result).toEqual(subscription);
      expect(mockPrisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('should throw NotFoundError when subscription not found', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.findById(999, 1)).rejects.toThrow(NotFoundError);
      await expect(service.findById(999, 1)).rejects.toThrow('Subscription not found');
    });

    it('should throw NotFoundError when user does not own subscription', async () => {
      const subscription = createMockSubscription({ id: 1, userId: 2 }); // Different user
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      await expect(service.findById(1, 1)).rejects.toThrow(NotFoundError);
      await expect(service.findById(1, 1)).rejects.toThrow('Subscription not found');
    });
  });

  describe('create', () => {
    it('should create subscription with correct data', async () => {
      const userId = 1;
      const input = {
        name: 'New Subscription',
        type: 'lastfm_chart' as const,
        config: { limit: 50 },
        schedule: '0 0 * * *',
        resultHandling: 'preview' as const,
        isActive: true,
      };

      const createdSubscription = createMockSubscription({
        id: 1,
        userId,
        ...input,
      });

      mockPrisma.connection.findFirst.mockResolvedValue(null); // No connection needed for lastfm
      mockPrisma.subscription.create.mockResolvedValue(createdSubscription);

      const result = await service.create(userId, input);

      expect(result).toEqual(createdSubscription);
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith({
        data: {
          userId,
          connectionId: null,
          name: input.name,
          type: input.type,
          config: input.config,
          schedule: input.schedule,
          resultHandling: input.resultHandling,
          resultLimit: 50,
          isActive: input.isActive,
        },
      });
    });

    it('should add scheduled job when subscription has schedule and is active', async () => {
      const userId = 1;
      const input = {
        name: 'Scheduled Subscription',
        type: 'lastfm_chart' as const,
        config: {},
        schedule: '0 0 * * *',
        resultHandling: 'preview' as const,
        isActive: true,
      };

      const createdSubscription = createMockSubscription({
        id: 5,
        userId,
        ...input,
      });

      mockPrisma.connection.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue(createdSubscription);

      await service.create(userId, input);

      expect(addScheduledJob).toHaveBeenCalledWith(5, userId, '0 0 * * *');
    });

    it('should not add scheduled job when subscription is inactive', async () => {
      const userId = 1;
      const input = {
        name: 'Inactive Subscription',
        type: 'lastfm_chart' as const,
        config: {},
        schedule: '0 0 * * *',
        resultHandling: 'preview' as const,
        isActive: false,
      };

      const createdSubscription = createMockSubscription({
        id: 6,
        userId,
        ...input,
      });

      mockPrisma.connection.findFirst.mockResolvedValue(null);
      mockPrisma.subscription.create.mockResolvedValue(createdSubscription);

      await service.create(userId, input);

      expect(addScheduledJob).not.toHaveBeenCalled();
    });

    it('should auto-link connection for spotify subscription type', async () => {
      const userId = 1;
      const spotifyConnection = { id: 10, type: 'spotify', userId, isActive: true };
      const input = {
        name: 'Spotify Subscription',
        type: 'spotify_playlist' as const,
        config: { playlistId: 'abc123' },
        resultHandling: 'preview' as const,
        isActive: true,
      };

      mockPrisma.connection.findFirst.mockResolvedValue(spotifyConnection);
      mockPrisma.subscription.create.mockResolvedValue(
        createMockSubscription({ id: 7, userId, connectionId: 10, ...input })
      );

      await service.create(userId, input);

      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            connectionId: 10,
          }),
        })
      );
    });
  });

  describe('update', () => {
    it('should update subscription when user owns it', async () => {
      const userId = 1;
      const existingSubscription = createMockSubscription({ id: 1, userId });
      const updateInput = { name: 'Updated Name' };
      const updatedSubscription = { ...existingSubscription, ...updateInput };

      mockPrisma.subscription.findUnique.mockResolvedValue(existingSubscription);
      mockPrisma.subscription.update.mockResolvedValue(updatedSubscription);

      const result = await service.update(1, userId, updateInput);

      expect(result).toEqual(updatedSubscription);
      expect(mockPrisma.subscription.update).toHaveBeenCalled();
    });

    it('should throw NotFoundError when subscription not found', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.update(999, 1, { name: 'Test' })).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when user does not own subscription', async () => {
      const subscription = createMockSubscription({ id: 1, userId: 2 });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      await expect(service.update(1, 1, { name: 'Test' })).rejects.toThrow(NotFoundError);
    });

    it('should update scheduler when schedule changes', async () => {
      const userId = 1;
      const existingSubscription = createMockSubscription({ 
        id: 1, 
        userId, 
        schedule: '0 0 * * *',
        isActive: true,
      });
      const updateInput = { schedule: '0 12 * * *' };
      const updatedSubscription = { ...existingSubscription, ...updateInput };

      mockPrisma.subscription.findUnique.mockResolvedValue(existingSubscription);
      mockPrisma.subscription.update.mockResolvedValue(updatedSubscription);

      await service.update(1, userId, updateInput);

      expect(removeScheduledJob).toHaveBeenCalledWith(1);
      expect(addScheduledJob).toHaveBeenCalledWith(1, userId, '0 12 * * *');
    });
  });

  describe('delete', () => {
    it('should delete subscription when user owns it', async () => {
      const userId = 1;
      const subscription = createMockSubscription({ id: 1, userId });

      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscription.delete.mockResolvedValue(subscription);

      await service.delete(1, userId);

      expect(removeScheduledJob).toHaveBeenCalledWith(1);
      expect(mockPrisma.subscription.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });

    it('should throw NotFoundError when subscription not found', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.delete(999, 1)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when user does not own subscription', async () => {
      const subscription = createMockSubscription({ id: 1, userId: 2 });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      await expect(service.delete(1, 1)).rejects.toThrow(NotFoundError);
    });
  });

  describe('execute', () => {
    it('should execute subscription when user owns it', async () => {
      const userId = 1;
      const subscription = createMockSubscription({ id: 1, userId, isActive: true });

      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.execute(1, userId);

      expect(result).toEqual({ jobId: 'job-1' });
      expect(scheduleSubscriptionJob).toHaveBeenCalledWith(1, userId);
    });

    it('should throw NotFoundError when subscription not found', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.execute(999, 1)).rejects.toThrow(NotFoundError);
    });

    it('should throw NotFoundError when user does not own subscription', async () => {
      const subscription = createMockSubscription({ id: 1, userId: 2 });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      await expect(service.execute(1, 1)).rejects.toThrow(NotFoundError);
    });
  });
});
