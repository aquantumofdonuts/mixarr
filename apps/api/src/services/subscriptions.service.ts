/**
 * Subscription Service
 * 
 * Business logic for subscription CRUD operations.
 * Extracted from routes/subscriptions.ts for better separation of concerns.
 */

import prisma from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { addScheduledJob, removeScheduledJob } from '../jobs/scheduler.js';
import { scheduleSubscriptionJob } from '../jobs/queue.js';
import { getArtistImages } from './artist-images.js';
import type { Subscription, SubscriptionType, ResultHandling, ConnectionType, Prisma } from '@prisma/client';

const logger = createLogger('SubscriptionService');

/**
 * Custom error for resources not found or unauthorized access
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Input type for creating a subscription
 */
export interface CreateSubscriptionInput {
  name: string;
  type: SubscriptionType;
  config?: Prisma.JsonValue;
  schedule?: string | null;
  resultHandling?: ResultHandling;
  resultLimit?: number;
  isActive?: boolean;
}

/**
 * Input type for updating a subscription
 */
export interface UpdateSubscriptionInput {
  name?: string;
  config?: Prisma.JsonValue;
  schedule?: string | null;
  resultHandling?: ResultHandling;
  resultLimit?: number;
  isActive?: boolean;
}

/**
 * Service class for subscription operations
 */
export class SubscriptionService {
  /**
   * Get all subscriptions for a user
   */
  async findAll(userId: number): Promise<Subscription[]> {
    logger.debug('Finding all subscriptions for user', { userId });
    
    const subscriptions = await prisma.subscription.findMany({
      where: { userId },
      include: {
        user: { select: { username: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    logger.debug('Found subscriptions', { userId, count: subscriptions.length });
    return subscriptions;
  }

  /**
   * Get a single subscription by ID with ownership check
   */
  async findById(id: number, userId: number): Promise<Subscription> {
    logger.debug('Finding subscription by ID', { id, userId });

    const subscription = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!subscription || subscription.userId !== userId) {
      logger.warn('Subscription not found or access denied', { id, userId });
      throw new NotFoundError('Subscription not found');
    }

    return subscription;
  }

  /**
   * Create a new subscription
   */
  async create(userId: number, input: CreateSubscriptionInput): Promise<Subscription> {
    logger.info('Creating subscription', { userId, name: input.name, type: input.type });

    // Auto-link the appropriate connection based on subscription type
    const connectionId = await this.findConnectionForType(userId, input.type);

    const subscription = await prisma.subscription.create({
      data: {
        userId,
        connectionId,
        name: input.name,
        type: input.type,
        config: input.config || {},
        schedule: input.schedule,
        resultHandling: input.resultHandling || 'preview',
        resultLimit: input.resultLimit ?? 50,
        isActive: input.isActive !== false,
      },
    });

    // Add to scheduler if has schedule and is active
    if (subscription.schedule && subscription.isActive) {
      addScheduledJob(subscription.id, userId, subscription.schedule);
      logger.debug('Added scheduled job', { subscriptionId: subscription.id, schedule: subscription.schedule });
    }

    logger.info('Created subscription', { subscriptionId: subscription.id, name: subscription.name });
    return subscription;
  }

  /**
   * Update an existing subscription with ownership check
   */
  async update(id: number, userId: number, input: UpdateSubscriptionInput): Promise<Subscription> {
    logger.debug('Updating subscription', { id, userId });

    // Verify ownership
    const existing = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      logger.warn('Subscription not found or access denied for update', { id, userId });
      throw new NotFoundError('Subscription not found');
    }

    const subscription = await prisma.subscription.update({
      where: { id },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.config && { config: input.config }),
        ...(input.schedule !== undefined && { schedule: input.schedule }),
        ...(input.resultHandling && { resultHandling: input.resultHandling }),
        ...(typeof input.resultLimit === 'number' && { resultLimit: input.resultLimit }),
        ...(typeof input.isActive === 'boolean' && { isActive: input.isActive }),
      },
    });

    // Update scheduler
    removeScheduledJob(id);
    if (subscription.schedule && subscription.isActive) {
      addScheduledJob(id, userId, subscription.schedule);
      logger.debug('Updated scheduled job', { subscriptionId: id, schedule: subscription.schedule });
    }

    logger.info('Updated subscription', { subscriptionId: id });
    return subscription;
  }

  /**
   * Delete a subscription with ownership check
   */
  async delete(id: number, userId: number): Promise<void> {
    logger.debug('Deleting subscription', { id, userId });

    // Verify ownership
    const existing = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      logger.warn('Subscription not found or access denied for delete', { id, userId });
      throw new NotFoundError('Subscription not found');
    }

    removeScheduledJob(id);
    await prisma.subscription.delete({ where: { id } });

    logger.info('Deleted subscription', { subscriptionId: id });
  }

  /**
   * Execute a subscription (trigger the download workflow)
   */
  async execute(id: number, userId: number): Promise<{ jobId: string }> {
    logger.debug('Executing subscription', { id, userId });

    // Verify ownership
    const existing = await prisma.subscription.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      logger.warn('Subscription not found or access denied for execute', { id, userId });
      throw new NotFoundError('Subscription not found');
    }

    const job = await scheduleSubscriptionJob(id, userId);
    logger.info('Scheduled subscription execution', { subscriptionId: id, jobId: job.id });

    return { jobId: job.id as string };
  }

  /**
   * Get run history for a subscription with pagination
   */
  async getRunHistory(
    subscriptionId: number,
    userId: number,
    limit: number = 20,
    offset: number = 0
  ): Promise<{ runs: any[]; total: number }> {
    // Verify access
    await this.findById(subscriptionId, userId);

    const [runs, total] = await Promise.all([
      prisma.subscriptionRun.findMany({
        where: { subscriptionId },
        orderBy: { startedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.subscriptionRun.count({ where: { subscriptionId } }),
    ]);

    return { runs, total };
  }

  /**
   * Get run details with results
   */
  async getRunDetails(
    subscriptionId: number,
    runId: number,
    userId: number
  ): Promise<{ run: any; results: any[] } | null> {
    // Verify access
    await this.findById(subscriptionId, userId);

    const run = await prisma.subscriptionRun.findFirst({
      where: { id: runId, subscriptionId },
    });

    if (!run) {
      return null;
    }

    const results = await prisma.subscriptionResult.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch artist images from Deezer
    const artistNames = results.map(r => r.name);
    const imageMap = await getArtistImages(artistNames);

    // Add images to results
    const resultsWithImages = results.map(r => ({
      ...r,
      imageUrl: imageMap.get(r.name),
    }));

    return { run, results: resultsWithImages };
  }

  /**
   * Find the appropriate connection ID for a subscription type
   */
  private async findConnectionForType(userId: number, type: SubscriptionType): Promise<number | null> {
    // Determine required connection type from subscription type
    let requiredConnType: ConnectionType | null = null;
    
    if (type.startsWith('spotify_')) requiredConnType = 'spotify';
    else if (type.startsWith('lastfm_')) requiredConnType = 'lastfm';
    else if (type.startsWith('deezer_')) requiredConnType = 'deezer';
    else if (type.startsWith('tidal_')) requiredConnType = 'tidal';
    else if (type === 'tautulli_similar') requiredConnType = 'tautulli';

    if (!requiredConnType) {
      return null;
    }

    // Find user's connection of that type (or global fallback)
    const conn = await prisma.connection.findFirst({
      where: {
        OR: [
          { userId, type: requiredConnType, isActive: true },
          { userId: null, type: requiredConnType, isActive: true },
        ],
      },
      orderBy: { userId: 'desc' }, // Prefer user's own
    });

    return conn?.id || null;
  }
}

// Export a singleton instance for convenience
export const subscriptionService = new SubscriptionService();
