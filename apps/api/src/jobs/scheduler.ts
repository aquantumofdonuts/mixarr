/**
 * Scheduler Service
 * 
 * Handles scheduled subscription runs using cron expressions.
 */

import { CronJob } from 'cron';
import prisma from '../lib/db.js';
import { scheduleSubscriptionJob, scheduleImportJob } from './queue.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Scheduler');

const scheduledJobs = new Map<number, CronJob>();

/**
 * Clean up stale "running" jobs that were interrupted by container restart
 */
async function cleanupStaleJobs(): Promise<void> {
  logger.info('Checking for stale running jobs...');
  
  // Find subscription runs stuck in "running" state
  const staleRuns = await prisma.subscriptionRun.updateMany({
    where: {
      status: 'running',
    },
    data: {
      status: 'failed',
      errorMessage: 'Job interrupted by server restart',
      completedAt: new Date(),
    },
  });
  
  if (staleRuns.count > 0) {
    logger.info(`Marked ${staleRuns.count} stale subscription runs as failed`);
    
    // Also update the subscription's lastRunStatus for these
    await prisma.$executeRaw`
      UPDATE subscriptions s
      SET s.lastRunStatus = 'failed'
      WHERE EXISTS (
        SELECT 1 FROM subscription_runs r
        WHERE r.subscription_id = s.id
        AND r.error_message = 'Job interrupted by server restart'
        AND r.completed_at >= DATE_SUB(NOW(), INTERVAL 1 MINUTE)
      )
    `;
  }
}

export async function initializeScheduler(): Promise<void> {
  logger.info('Initializing scheduler...');
  
  // Clean up any jobs stuck in running state from previous container
  await cleanupStaleJobs();
  
  // Start data retention cleanup job
  startDataRetentionJob();
  
  // Load all active subscriptions with schedules
  const subscriptions = await prisma.subscription.findMany({
    where: {
      isActive: true,
      schedule: { not: null },
    },
  });

  for (const sub of subscriptions) {
    if (sub.schedule) {
      addScheduledJob(sub.id, sub.userId, sub.schedule);
    }
  }

  // Load all active import sources with schedules
  const importSources = await prisma.importSource.findMany({
    where: {
      isActive: true,
      schedule: { not: null },
    },
  });

  for (const source of importSources) {
    if (source.schedule) {
      addImportScheduledJob(source.id, source.userId, source.schedule, source.resultHandling);
    }
  }

  logger.info(`Scheduled ${scheduledJobs.size} jobs`);
}

export function addScheduledJob(
  subscriptionId: number,
  userId: number,
  cronExpression: string
): void {
  // Remove existing job if any
  removeScheduledJob(subscriptionId);

  try {
    const job = new CronJob(
      cronExpression,
      async () => {
        logger.info(`Running scheduled subscription ${subscriptionId}`);
        await scheduleSubscriptionJob(subscriptionId, userId);
        
        // Update next run time
        await prisma.subscription.update({
          where: { id: subscriptionId },
          data: { nextRun: job.nextDate().toJSDate() },
        });
      },
      null,
      true,
      'UTC'
    );

    scheduledJobs.set(subscriptionId, job);

    // Update next run time
    prisma.subscription.update({
      where: { id: subscriptionId },
      data: { nextRun: job.nextDate().toJSDate() },
    }).catch((err: Error) => logger.error('Failed to update next run time', { error: err }));

  } catch (error) {
    logger.error(`Failed to schedule subscription ${subscriptionId}`, { error });
  }
}

export function addImportScheduledJob(
  importSourceId: number,
  userId: number,
  cronExpression: string,
  resultHandling: 'preview' | 'queue' | 'auto'
): void {
  const key = 10000 + importSourceId; // Offset to avoid collision with subscription IDs
  
  // Remove existing job if any
  const existing = scheduledJobs.get(key);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(key);
  }

  try {
    const job = new CronJob(
      cronExpression,
      async () => {
        logger.info(`Running scheduled import ${importSourceId}`);
        await scheduleImportJob(importSourceId, userId, resultHandling);
      },
      null,
      true,
      'UTC'
    );

    scheduledJobs.set(key, job);

  } catch (error) {
    logger.error(`Failed to schedule import ${importSourceId}`, { error });
  }
}

export function removeScheduledJob(subscriptionId: number): void {
  const existing = scheduledJobs.get(subscriptionId);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(subscriptionId);
  }
}

export function removeImportScheduledJob(importSourceId: number): void {
  const key = 10000 + importSourceId;
  const existing = scheduledJobs.get(key);
  if (existing) {
    existing.stop();
    scheduledJobs.delete(key);
  }
}

export function getScheduledJobCount(): number {
  return scheduledJobs.size;
}

export function stopAllJobs(): void {
  for (const job of scheduledJobs.values()) {
    job.stop();
  }
  scheduledJobs.clear();
}

/**
 * Data retention cleanup job
 * Runs daily at 3 AM UTC to clean up old subscription results and runs
 */
let cleanupJob: CronJob | null = null;

export function startDataRetentionJob(): void {
  if (cleanupJob) {
    cleanupJob.stop();
  }

  cleanupJob = new CronJob(
    '0 3 * * *', // Daily at 3 AM UTC
    async () => {
      logger.info('Running data retention cleanup...');
      try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Delete old subscription results
        const deletedResults = await prisma.subscriptionResult.deleteMany({
          where: { createdAt: { lt: thirtyDaysAgo } },
        });

        // Delete old subscription runs (keep last 30 days)
        const deletedRuns = await prisma.subscriptionRun.deleteMany({
          where: { startedAt: { lt: thirtyDaysAgo } },
        });

        // Delete old import sources (keep last 30 days)
        const deletedImportSources = await prisma.importSource.deleteMany({
          where: { createdAt: { lt: thirtyDaysAgo } },
        });

        // Delete old logs (keep last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const deletedLogs = await prisma.logEntry.deleteMany({
          where: { createdAt: { lt: sevenDaysAgo } },
        });

        logger.info('Data retention cleanup completed', {
          subscriptionResults: deletedResults.count,
          subscriptionRuns: deletedRuns.count,
          importSources: deletedImportSources.count,
          logs: deletedLogs.count,
        });
      } catch (error) {
        logger.error('Data retention cleanup failed', { error });
      }
    },
    null,
    true,
    'UTC'
  );

  logger.info('Data retention cleanup job scheduled (daily at 3 AM UTC)');
}
