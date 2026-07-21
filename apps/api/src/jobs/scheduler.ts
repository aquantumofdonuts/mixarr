/**
 * Scheduler Service
 * 
 * Handles scheduled subscription runs using cron expressions.
 */

import { CronJob } from 'cron';
import prisma from '../lib/db.js';
import { ResultHandling } from '@prisma/client';
import { scheduleSubscriptionJob, scheduleImportJob } from './queue.js';
import { createLogger } from '../lib/logger.js';
import { pollSlskdDownloads } from './slskd-poll.js';
import { LidarrService } from '../services/lidarr.js';

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
    
    // Also update the subscription's last_run_status for these
    await prisma.$executeRaw`
      UPDATE subscriptions s
      SET s.last_run_status = 'failed'
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
  
  // Start slskd download polling job
  startSlskdPollJob();

  // Start the Soulseek 30-day sweep-back job
  startSoulseekSweepJob();
  
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
  resultHandling: ResultHandling
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

/**
 * Soulseek 30-day sweep-back job.
 *
 * When a Lidarr album's qBittorrent download is diverted to Soulseek (see
 * move_queue_to_soulseek.js and the soulseek_diversions table it writes
 * to), the album is deliberately unmonitored in Lidarr so its own periodic
 * missing-album search doesn't immediately re-grab the same album via
 * qBittorrent and undo the diversion. That's only meant to hold for a
 * limited trial window, not forever — this job runs daily, finds
 * diversions older than 30 days that haven't been resolved yet, and for
 * each one:
 *   - if Lidarr's own file count shows the album is now fully present
 *     (Soulseek delivered it), re-enables normal monitoring and marks the
 *     diversion resolved as a Soulseek success.
 *   - otherwise (Soulseek never delivered), re-enables monitoring AND
 *     triggers a fresh Lidarr album search, handing it back to Lidarr's
 *     normal qBittorrent/indexer flow — the "best chance at getting the
 *     music" fallback.
 *
 * soulseek_diversions is a hand-created table (see the script above), not
 * part of the Prisma schema, so this reads/writes it via raw SQL.
 */
let soulseekSweepJob: CronJob | null = null;

interface StaleDiversion {
  id: number;
  lidarr_album_id: number;
  lidarr_artist_id: number;
  artist_name: string;
  album_title: string;
}

export function startSoulseekSweepJob(): void {
  if (soulseekSweepJob) {
    soulseekSweepJob.stop();
  }

  soulseekSweepJob = new CronJob(
    '0 4 * * *', // Daily at 4 AM UTC
    async () => {
      logger.info('Running Soulseek 30-day sweep-back...');
      try {
        const staleDiversions = await prisma.$queryRaw<StaleDiversion[]>`
          SELECT id, lidarr_album_id, lidarr_artist_id, artist_name, album_title
          FROM soulseek_diversions
          WHERE diverted_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND resolved_at IS NULL
        `;

        if (!staleDiversions.length) {
          logger.info('No stale Soulseek diversions to sweep');
          return;
        }

        const lidarrConn = await prisma.connection.findFirst({ where: { type: 'lidarr', isActive: true } });
        if (!lidarrConn) {
          logger.warn('Soulseek sweep: no active Lidarr connection configured, skipping');
          return;
        }
        const lidarr = new LidarrService(lidarrConn.config as unknown as { url: string; apiKey: string });

        let soulseekSuccess = 0;
        let sweptBackToQbittorrent = 0;
        let errors = 0;

        for (const diversion of staleDiversions) {
          try {
            const albums = await lidarr.getAlbums(diversion.lidarr_artist_id);
            const album = albums.find((a) => a.id === diversion.lidarr_album_id);

            if (!album) {
              logger.warn('Soulseek sweep: album no longer exists in Lidarr, marking resolved', { diversion });
              await prisma.$executeRaw`
                UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'album_removed' WHERE id = ${diversion.id}
              `;
              continue;
            }

            const fileCount = album.statistics?.trackFileCount ?? 0;
            const totalTracks = album.statistics?.totalTrackCount ?? 1;
            const soulseekDelivered = fileCount >= totalTracks;

            album.monitored = true;
            await lidarr.updateAlbum(album);

            if (soulseekDelivered) {
              await prisma.$executeRaw`
                UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'soulseek_success' WHERE id = ${diversion.id}
              `;
              soulseekSuccess++;
              logger.info(`Soulseek sweep: confirmed success for ${diversion.artist_name} - ${diversion.album_title}`);
            } else {
              await lidarr.searchAlbumCommand([album.id]);
              await prisma.$executeRaw`
                UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'swept_back_to_qbittorrent' WHERE id = ${diversion.id}
              `;
              sweptBackToQbittorrent++;
              logger.info(`Soulseek sweep: 30 days up with no Soulseek delivery, back to Lidarr/qBittorrent for ${diversion.artist_name} - ${diversion.album_title}`);
            }
          } catch (err) {
            errors++;
            logger.error('Soulseek sweep: failed to process diversion', {
              diversion,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        logger.info('Soulseek sweep completed', {
          total: staleDiversions.length,
          soulseekSuccess,
          sweptBackToQbittorrent,
          errors,
        });
      } catch (error) {
        logger.error('Soulseek sweep job failed', { error });
      }
    },
    null,
    true,
    'UTC'
  );

  logger.info('Soulseek 30-day sweep job scheduled (daily at 4 AM UTC)');
}

/**
 * slskd download polling job
 * Runs every 5 minutes to check for completed downloads and trigger organization
 */
let slskdPollIntervalId: ReturnType<typeof setInterval> | null = null;
const SLSKD_POLL_INTERVAL = 2 * 60 * 1000; // 2 minutes

export function startSlskdPollJob(): void {
  if (slskdPollIntervalId) {
    clearInterval(slskdPollIntervalId);
  }

  // Run immediately once, then every 2 minutes
  pollSlskdDownloads().catch((err: Error) => 
    logger.error('Initial slskd poll failed', { error: err })
  );

  slskdPollIntervalId = setInterval(async () => {
    try {
      await pollSlskdDownloads();
    } catch (error) {
      logger.error('slskd poll job failed', { error });
    }
  }, SLSKD_POLL_INTERVAL);

  logger.info('slskd download poll job scheduled (every 2 minutes)');
}

export function stopSlskdPollJob(): void {
  if (slskdPollIntervalId) {
    clearInterval(slskdPollIntervalId);
    slskdPollIntervalId = null;
  }
}
