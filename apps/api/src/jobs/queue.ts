/**
 * Job Queue System
 * 
 * BullMQ-based job queue for subscription runs and import jobs.
 */

import { Queue, Job, QueueEvents } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import type { Server as SocketIOServer } from 'socket.io';

// Queue names
export const QUEUE_NAMES = {
  SUBSCRIPTION: 'subscription',
  IMPORT: 'import',
} as const;

// Job types
export interface SubscriptionJobData {
  subscriptionId: number;
  userId: number;
}

export interface ImportJobData {
  importSourceId: number;
  userId: number;
  mode: 'preview' | 'queue' | 'auto';
}

// Create queues
export const subscriptionQueue = new Queue<SubscriptionJobData>(QUEUE_NAMES.SUBSCRIPTION, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

export const importQueue = new Queue<ImportJobData>(QUEUE_NAMES.IMPORT, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'fixed',
      delay: 10000,
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  },
});

// Queue events for real-time updates
const subscriptionQueueEvents = new QueueEvents(QUEUE_NAMES.SUBSCRIPTION, {
  connection: createRedisConnection(),
});

const importQueueEvents = new QueueEvents(QUEUE_NAMES.IMPORT, {
  connection: createRedisConnection(),
});

// Setup WebSocket broadcasting for job events
export function setupJobEventBroadcasting(io: SocketIOServer): void {
  subscriptionQueueEvents.on('progress', ({ jobId, data }) => {
    io.emit('job:progress', {
      type: 'subscription',
      jobId,
      progress: data,
      timestamp: new Date().toISOString(),
    });
  });

  subscriptionQueueEvents.on('completed', ({ jobId }) => {
    io.emit('job:completed', {
      type: 'subscription',
      jobId,
      timestamp: new Date().toISOString(),
    });
  });

  subscriptionQueueEvents.on('failed', ({ jobId, failedReason }) => {
    io.emit('job:failed', {
      type: 'subscription',
      jobId,
      error: failedReason,
      timestamp: new Date().toISOString(),
    });
  });

  importQueueEvents.on('progress', ({ jobId, data }) => {
    io.emit('job:progress', {
      type: 'import',
      jobId,
      progress: data,
      timestamp: new Date().toISOString(),
    });
  });

  importQueueEvents.on('completed', ({ jobId }) => {
    io.emit('job:completed', {
      type: 'import',
      jobId,
      timestamp: new Date().toISOString(),
    });
  });

  importQueueEvents.on('failed', ({ jobId, failedReason }) => {
    io.emit('job:failed', {
      type: 'import',
      jobId,
      error: failedReason,
      timestamp: new Date().toISOString(),
    });
  });
}

// Schedule a subscription job (with deduplication - only one active job per subscription)
export async function scheduleSubscriptionJob(
  subscriptionId: number,
  userId: number,
  delay?: number
): Promise<Job<SubscriptionJobData>> {
  // Use fixed job ID to prevent duplicate jobs for same subscription
  const jobId = `sub-${subscriptionId}`;
  
  // Check if job already exists and is active
  const existingJob = await subscriptionQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      console.log(`Subscription ${subscriptionId} already has an active job, skipping`);
      return existingJob;
    }
    // Remove completed/failed job to allow new one
    await existingJob.remove();
  }
  
  return subscriptionQueue.add(
    'run-subscription',
    { subscriptionId, userId },
    {
      jobId,
      delay,
    }
  );
}

// Schedule an import job (with deduplication)
export async function scheduleImportJob(
  importSourceId: number,
  userId: number,
  mode: 'preview' | 'queue' | 'auto'
): Promise<Job<ImportJobData>> {
  const jobId = `import-${importSourceId}`;
  
  // Check if job already exists and is active
  const existingJob = await importQueue.getJob(jobId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      console.log(`Import source ${importSourceId} already has an active job, skipping`);
      return existingJob;
    }
    await existingJob.remove();
  }
  
  return importQueue.add(
    'run-import',
    { importSourceId, userId, mode },
    { jobId }
  );
}

// Get job status
export async function getJobStatus(queueName: string, jobId: string) {
  const queue = queueName === QUEUE_NAMES.SUBSCRIPTION ? subscriptionQueue : importQueue;
  const job = await queue.getJob(jobId);
  
  if (!job) {
    return null;
  }

  const state = await job.getState();
  const progress = job.progress;

  return {
    id: job.id,
    state,
    progress,
    data: job.data,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason,
    timestamp: job.timestamp,
    finishedOn: job.finishedOn,
  };
}

// Get recent jobs (enriched with subscription/import names)
export async function getRecentJobs(queueName: string, limit: number = 20) {
  const { prisma } = await import('../lib/db.js');
  const queue = queueName === QUEUE_NAMES.SUBSCRIPTION ? subscriptionQueue : importQueue;
  
  const [completed, failed, active, waiting] = await Promise.all([
    queue.getCompleted(0, limit),
    queue.getFailed(0, limit),
    queue.getActive(0, limit),
    queue.getWaiting(0, limit),
  ]);

  const allJobs = [...completed, ...failed, ...active, ...waiting]
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
    .slice(0, limit);

  // Collect all subscription/import IDs to look up names
  const subscriptionIds = new Set<number>();
  const importSourceIds = new Set<number>();
  
  for (const job of allJobs) {
    if ('subscriptionId' in job.data) {
      subscriptionIds.add(job.data.subscriptionId);
    }
    if ('importSourceId' in job.data) {
      importSourceIds.add(job.data.importSourceId);
    }
  }

  // Batch lookup names
  const [subscriptions, importSources] = await Promise.all([
    subscriptionIds.size > 0
      ? prisma.subscription.findMany({
          where: { id: { in: Array.from(subscriptionIds) } },
          select: { id: true, name: true },
        })
      : [],
    importSourceIds.size > 0
      ? prisma.importSource.findMany({
          where: { id: { in: Array.from(importSourceIds) } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const subscriptionNameMap = new Map(subscriptions.map((s) => [s.id, s.name]));
  const importSourceNameMap = new Map(importSources.map((s) => [s.id, s.name]));

  return Promise.all(
    allJobs.map(async (job) => {
      const data = job.data as SubscriptionJobData | ImportJobData;
      const enrichedData: Record<string, unknown> = { ...data };
      
      if ('subscriptionId' in data) {
        enrichedData.subscriptionName = subscriptionNameMap.get(data.subscriptionId) || `Subscription ${data.subscriptionId}`;
      }
      if ('importSourceId' in data) {
        enrichedData.importSourceName = importSourceNameMap.get(data.importSourceId) || `Import ${data.importSourceId}`;
      }
      
      return {
        id: job.id,
        state: await job.getState(),
        progress: job.progress,
        data: enrichedData,
        timestamp: job.timestamp,
        finishedOn: job.finishedOn,
      };
    })
  );
}
