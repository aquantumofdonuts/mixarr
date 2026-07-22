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
 * Soulseek 30-day / 60-day sweep job.
 *
 * When a Lidarr album's qBittorrent download is diverted to Soulseek (see
 * move_queue_to_soulseek.js / divert-album.ts and the soulseek_diversions
 * table they write to), the album is deliberately unmonitored in Lidarr so
 * its own periodic missing-album search doesn't immediately re-grab the
 * same album via qBittorrent and undo the diversion. That trial window is
 * two phases, not one:
 *
 *   Phase 1 (0-30 days, "Soulseek-only"): diversion sits with
 *     escalated_at/resolved_at both NULL. This job leaves it alone.
 *   At the 30-day mark: if Lidarr's file count shows the album fully
 *     present, Soulseek won — mark resolved_at (resolution
 *     'soulseek_success') and re-enable monitoring, done. Otherwise,
 *     escalate: re-enable monitoring, trigger a fresh Lidarr album search
 *     (handing it to qBittorrent/indexers), and set escalated_at = NOW()
 *     with resolution 'escalated_to_qbittorrent' — NOT resolved_at, since
 *     this isn't a terminal outcome yet, it's the start of a second timer.
 *   Phase 2 (30-60 days, "Lidarr/qBittorrent"): diversion has
 *     escalated_at set, resolved_at still NULL. This job leaves it alone
 *     until escalated_at is itself 30+ days old.
 *   At the 60-day-total mark: if the album is now fully present (delivered
 *     during the qBittorrent phase), mark resolved_at (resolution
 *     'delivered_after_escalation'), done. Otherwise nothing found it in
 *     60 days total — per Ryan's explicit call (2026-07-22), abandon it:
 *     remove any matching entries from Lidarr's download queue
 *     (blocklisted, so the same release doesn't get re-grabbed
 *     immediately), unmonitor the album again so Lidarr stops retrying,
 *     and mark resolved_at (resolution 'abandoned_not_found_60d'). These
 *     are things nothing could find anywhere in two months — treated as
 *     "don't want it clogging the queue," not as a bug to keep retrying.
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

async function ensureSoulseekEscalatedAtColumn(): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE soulseek_diversions ADD COLUMN IF NOT EXISTS escalated_at DATETIME NULL',
    );
  } catch (error) {
    logger.error('Failed to ensure soulseek_diversions.escalated_at column exists', { error });
  }
}

async function sweepPhase1ThirtyDayDiversions(lidarr: LidarrService): Promise<{ soulseekSuccess: number; escalated: number; errors: number }> {
  const staleDiversions = await prisma.$queryRaw<StaleDiversion[]>`
    SELECT id, lidarr_album_id, lidarr_artist_id, artist_name, album_title
    FROM soulseek_diversions
    WHERE diverted_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND resolved_at IS NULL AND escalated_at IS NULL
  `;

  let soulseekSuccess = 0;
  let escalated = 0;
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
          UPDATE soulseek_diversions SET escalated_at = NOW(), resolution = 'escalated_to_qbittorrent' WHERE id = ${diversion.id}
        `;
        escalated++;
        logger.info(`Soulseek sweep: 30 days up with no Soulseek delivery, escalated to Lidarr/qBittorrent for ${diversion.artist_name} - ${diversion.album_title}`);
      }
    } catch (err) {
      errors++;
      logger.error('Soulseek sweep: failed to process phase-1 diversion', {
        diversion,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { soulseekSuccess, escalated, errors };
}

async function sweepPhase2SixtyDayAbandon(lidarr: LidarrService): Promise<{ delivered: number; abandoned: number; errors: number }> {
  const escalatedDiversions = await prisma.$queryRaw<StaleDiversion[]>`
    SELECT id, lidarr_album_id, lidarr_artist_id, artist_name, album_title
    FROM soulseek_diversions
    WHERE escalated_at < DATE_SUB(NOW(), INTERVAL 30 DAY) AND resolved_at IS NULL
  `;

  let delivered = 0;
  let abandoned = 0;
  let errors = 0;

  for (const diversion of escalatedDiversions) {
    try {
      const albums = await lidarr.getAlbums(diversion.lidarr_artist_id);
      const album = albums.find((a) => a.id === diversion.lidarr_album_id);

      if (!album) {
        logger.warn('Soulseek sweep (60d): album no longer exists in Lidarr, marking resolved', { diversion });
        await prisma.$executeRaw`
          UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'album_removed' WHERE id = ${diversion.id}
        `;
        continue;
      }

      const fileCount = album.statistics?.trackFileCount ?? 0;
      const totalTracks = album.statistics?.totalTrackCount ?? 1;

      if (fileCount >= totalTracks) {
        await prisma.$executeRaw`
          UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'delivered_after_escalation' WHERE id = ${diversion.id}
        `;
        delivered++;
        logger.info(`Soulseek sweep (60d): delivered during qBittorrent phase for ${diversion.artist_name} - ${diversion.album_title}`);
        continue;
      }

      // 60 days total, still nothing anywhere — abandon it: pull it out of
      // Lidarr's queue (blocklisted so it isn't immediately re-grabbed) and
      // unmonitor so Lidarr stops retrying. Per Ryan's explicit 2026-07-22
      // call: nothing found in 60 days shouldn't keep clogging the queue.
      const queue = await lidarr.getQueue();
      const queueItems = queue.filter((item) => item.albumId === diversion.lidarr_album_id);
      for (const item of queueItems) {
        await lidarr.removeQueueItem(item.id, { blocklist: true });
      }

      album.monitored = false;
      await lidarr.updateAlbum(album);

      await prisma.$executeRaw`
        UPDATE soulseek_diversions SET resolved_at = NOW(), resolution = 'abandoned_not_found_60d' WHERE id = ${diversion.id}
      `;
      abandoned++;
      logger.info(`Soulseek sweep (60d): abandoned, not found anywhere in 60 days for ${diversion.artist_name} - ${diversion.album_title}`, {
        queueItemsRemoved: queueItems.length,
      });
    } catch (err) {
      errors++;
      logger.error('Soulseek sweep: failed to process phase-2 diversion', {
        diversion,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { delivered, abandoned, errors };
}

export function startSoulseekSweepJob(): void {
  if (soulseekSweepJob) {
    soulseekSweepJob.stop();
  }

  soulseekSweepJob = new CronJob(
    '0 4 * * *', // Daily at 4 AM UTC
    async () => {
      logger.info('Running Soulseek 30/60-day sweep...');
      try {
        await ensureSoulseekEscalatedAtColumn();

        const lidarrConn = await prisma.connection.findFirst({ where: { type: 'lidarr', isActive: true } });
        if (!lidarrConn) {
          logger.warn('Soulseek sweep: no active Lidarr connection configured, skipping');
          return;
        }
        const lidarr = new LidarrService(lidarrConn.config as unknown as { url: string; apiKey: string });

        const phase1 = await sweepPhase1ThirtyDayDiversions(lidarr);
        const phase2 = await sweepPhase2SixtyDayAbandon(lidarr);

        logger.info('Soulseek sweep completed', {
          soulseekSuccess: phase1.soulseekSuccess,
          escalatedToQbittorrent: phase1.escalated,
          deliveredAfterEscalation: phase2.delivered,
          abandonedNotFound60d: phase2.abandoned,
          errors: phase1.errors + phase2.errors,
        });
      } catch (error) {
        logger.error('Soulseek sweep job failed', { error });
      }
    },
    null,
    true,
    'UTC'
  );

  logger.info('Soulseek 30/60-day sweep job scheduled (daily at 4 AM UTC)');
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
