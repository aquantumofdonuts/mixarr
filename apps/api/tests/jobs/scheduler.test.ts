/**
 * Scheduler Service Tests
 *
 * Tests the ACTUAL exported functions from the scheduler module.
 * All dependencies (Prisma, queue, slskd-poll, cron) are mocked at the module level.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock all dependencies BEFORE importing scheduler ────────────────────────

vi.mock('../../src/lib/db.js', () => ({
  default: {
    subscriptionRun: { updateMany: vi.fn(), deleteMany: vi.fn() },
    subscription: { findMany: vi.fn(), update: vi.fn() },
    importSource: { findMany: vi.fn(), deleteMany: vi.fn() },
    subscriptionResult: { deleteMany: vi.fn() },
    logEntry: { deleteMany: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../../src/jobs/queue.js', () => ({
  scheduleSubscriptionJob: vi.fn(),
  scheduleImportJob: vi.fn(),
}));

vi.mock('../../src/jobs/slskd-poll.js', () => ({
  pollSlskdDownloads: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('cron', () => ({
  CronJob: vi.fn().mockImplementation(function (
    this: any,
    expression: string,
    onTick: Function,
    _onComplete: unknown,
    _start: boolean,
    _tz: string
  ) {
    this.expression = expression;
    this.onTick = onTick;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.nextDate = vi.fn(() => ({ toJSDate: () => new Date('2025-01-02T00:00:00Z') }));
  }),
}));

// ── Import module under test (uses mocked deps) ────────────────────────────

import {
  initializeScheduler,
  addScheduledJob,
  addImportScheduledJob,
  removeScheduledJob,
  removeImportScheduledJob,
  getScheduledJobCount,
  stopAllJobs,
  startDataRetentionJob,
  startSlskdPollJob,
  stopSlskdPollJob,
} from '../../src/jobs/scheduler.js';

// ── Import mocked dependencies for assertions ──────────────────────────────

import prisma from '../../src/lib/db.js';
import { CronJob } from 'cron';
import { scheduleSubscriptionJob, scheduleImportJob } from '../../src/jobs/queue.js';
import { pollSlskdDownloads } from '../../src/jobs/slskd-poll.js';

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Scheduler Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Safe default return values for all Prisma mocks
    vi.mocked(prisma.subscriptionRun.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.subscriptionRun.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.subscription.findMany).mockResolvedValue([]);
    vi.mocked(prisma.subscription.update).mockResolvedValue({} as any);
    vi.mocked(prisma.importSource.findMany).mockResolvedValue([]);
    vi.mocked(prisma.importSource.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.subscriptionResult.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.logEntry.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as any);
  });

  afterEach(() => {
    stopAllJobs();
    stopSlskdPollJob();
  });

  // ── cleanupStaleJobs (internal, tested via initializeScheduler) ─────────

  describe('cleanupStaleJobs (via initializeScheduler)', () => {
    it('should mark running jobs as failed on startup', async () => {
      vi.mocked(prisma.subscriptionRun.updateMany).mockResolvedValue({ count: 3 });

      await initializeScheduler();

      expect(prisma.subscriptionRun.updateMany).toHaveBeenCalledWith({
        where: { status: 'running' },
        data: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Job interrupted by server restart',
        }),
      });
    });

    it('should update subscription status when stale jobs are found', async () => {
      vi.mocked(prisma.subscriptionRun.updateMany).mockResolvedValue({ count: 2 });

      await initializeScheduler();

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('should NOT call $executeRaw when no stale jobs exist', async () => {
      vi.mocked(prisma.subscriptionRun.updateMany).mockResolvedValue({ count: 0 });

      await initializeScheduler();

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  // ── initializeScheduler ─────────────────────────────────────────────────

  describe('initializeScheduler', () => {
    it('should query active subscriptions with schedules', async () => {
      await initializeScheduler();

      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          schedule: { not: null },
        },
      });
    });

    it('should query active import sources with schedules', async () => {
      await initializeScheduler();

      expect(prisma.importSource.findMany).toHaveBeenCalledWith({
        where: {
          isActive: true,
          schedule: { not: null },
        },
      });
    });

    it('should create a CronJob for each subscription with a schedule', async () => {
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([
        { id: 1, userId: 1, schedule: '0 0 * * *', isActive: true },
        { id: 2, userId: 1, schedule: '0 12 * * *', isActive: true },
      ] as any);

      await initializeScheduler();

      // Filter out the data-retention CronJob ('0 3 * * *')
      const subscriptionCronCalls = vi.mocked(CronJob).mock.calls.filter(
        (call) => call[0] === '0 0 * * *' || call[0] === '0 12 * * *'
      );
      expect(subscriptionCronCalls).toHaveLength(2);
    });

    it('should report correct job count after initialization', async () => {
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([
        { id: 1, userId: 1, schedule: '0 0 * * *', isActive: true },
        { id: 2, userId: 2, schedule: '0 6 * * *', isActive: true },
      ] as any);
      vi.mocked(prisma.importSource.findMany).mockResolvedValue([
        { id: 1, userId: 1, schedule: '0 3 * * 1', isActive: true, resultHandling: 'preview' },
      ] as any);

      await initializeScheduler();

      // 2 subscriptions + 1 import source = 3
      expect(getScheduledJobCount()).toBe(3);
    });

    it('should skip subscriptions with null schedule', async () => {
      vi.mocked(prisma.subscription.findMany).mockResolvedValue([
        { id: 1, userId: 1, schedule: null, isActive: true },
        { id: 2, userId: 1, schedule: '0 0 * * *', isActive: true },
      ] as any);

      await initializeScheduler();

      // Only 1 subscription has a non-null schedule
      expect(getScheduledJobCount()).toBe(1);
    });
  });

  // ── addScheduledJob ─────────────────────────────────────────────────────

  describe('addScheduledJob', () => {
    it('should create a CronJob with the given cron expression', () => {
      addScheduledJob(1, 1, '0 0 * * *');

      expect(CronJob).toHaveBeenCalledWith(
        '0 0 * * *',
        expect.any(Function),
        null,
        true,
        'UTC'
      );
    });

    it('should remove existing job before adding a new one for the same subscriptionId', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      const firstInstance = vi.mocked(CronJob).mock.instances[0];

      addScheduledJob(1, 1, '0 12 * * *');

      expect(firstInstance.stop).toHaveBeenCalled();
      expect(getScheduledJobCount()).toBe(1);
    });

    it('should update subscription nextRun after adding job', () => {
      addScheduledJob(1, 1, '0 0 * * *');

      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { nextRun: new Date('2025-01-02T00:00:00Z') },
      });
    });

    it('should handle invalid cron expression gracefully without throwing', () => {
      vi.mocked(CronJob).mockImplementationOnce(() => {
        throw new Error('Invalid cron pattern');
      });

      expect(() => addScheduledJob(1, 1, 'not-a-cron')).not.toThrow();
      expect(getScheduledJobCount()).toBe(0);
    });

    it('should increment job count for different subscriptionIds', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      addScheduledJob(2, 1, '0 6 * * *');

      expect(getScheduledJobCount()).toBe(2);
    });
  });

  // ── removeScheduledJob ──────────────────────────────────────────────────

  describe('removeScheduledJob', () => {
    it('should stop and remove an existing job', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      const jobInstance = vi.mocked(CronJob).mock.instances[0];
      expect(getScheduledJobCount()).toBe(1);

      removeScheduledJob(1);

      expect(jobInstance.stop).toHaveBeenCalled();
      expect(getScheduledJobCount()).toBe(0);
    });

    it('should handle non-existent job gracefully', () => {
      expect(() => removeScheduledJob(999)).not.toThrow();
      expect(getScheduledJobCount()).toBe(0);
    });
  });

  // ── addImportScheduledJob ───────────────────────────────────────────────

  describe('addImportScheduledJob', () => {
    it('should use 10000 + importSourceId as key to avoid collision with subscriptions', () => {
      addScheduledJob(1, 1, '0 0 * * *');                          // key = 1
      addImportScheduledJob(1, 1, '0 6 * * *', 'preview' as any);  // key = 10001

      // Both coexist without collision
      expect(getScheduledJobCount()).toBe(2);
    });

    it('should create a CronJob with the given expression', () => {
      addImportScheduledJob(5, 2, '*/30 * * * *', 'preview' as any);

      expect(CronJob).toHaveBeenCalledWith(
        '*/30 * * * *',
        expect.any(Function),
        null,
        true,
        'UTC'
      );
    });
  });

  // ── removeImportScheduledJob ────────────────────────────────────────────

  describe('removeImportScheduledJob', () => {
    it('should use 10000 + importSourceId as key', () => {
      addImportScheduledJob(5, 1, '0 6 * * *', 'preview' as any);
      expect(getScheduledJobCount()).toBe(1);

      removeImportScheduledJob(5);
      expect(getScheduledJobCount()).toBe(0);
    });

    it('should not affect subscription jobs with the same base ID', () => {
      addScheduledJob(5, 1, '0 0 * * *');                          // key = 5
      addImportScheduledJob(5, 1, '0 6 * * *', 'preview' as any);  // key = 10005
      expect(getScheduledJobCount()).toBe(2);

      removeImportScheduledJob(5);

      expect(getScheduledJobCount()).toBe(1); // subscription job still present
    });
  });

  // ── getScheduledJobCount ────────────────────────────────────────────────

  describe('getScheduledJobCount', () => {
    it('should return 0 when no jobs are scheduled', () => {
      expect(getScheduledJobCount()).toBe(0);
    });

    it('should return the correct count after adding jobs', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      addScheduledJob(2, 1, '0 12 * * *');
      addImportScheduledJob(1, 1, '0 6 * * *', 'preview' as any);

      expect(getScheduledJobCount()).toBe(3);
    });
  });

  // ── stopAllJobs ─────────────────────────────────────────────────────────

  describe('stopAllJobs', () => {
    it('should stop all scheduled jobs and clear the map', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      addScheduledJob(2, 1, '0 12 * * *');
      const job1 = vi.mocked(CronJob).mock.instances[0];
      const job2 = vi.mocked(CronJob).mock.instances[1];

      stopAllJobs();

      expect(job1.stop).toHaveBeenCalled();
      expect(job2.stop).toHaveBeenCalled();
      expect(getScheduledJobCount()).toBe(0);
    });

    it('should result in zero job count after stopping', () => {
      addScheduledJob(1, 1, '0 0 * * *');
      addScheduledJob(2, 1, '0 6 * * *');
      addImportScheduledJob(1, 1, '0 3 * * *', 'preview' as any);
      expect(getScheduledJobCount()).toBe(3);

      stopAllJobs();

      expect(getScheduledJobCount()).toBe(0);
    });
  });

  // ── startDataRetentionJob ───────────────────────────────────────────────

  describe('startDataRetentionJob', () => {
    it('should create a CronJob for daily data retention cleanup', () => {
      startDataRetentionJob();

      expect(CronJob).toHaveBeenCalledWith(
        '0 3 * * *',
        expect.any(Function),
        null,
        true,
        'UTC'
      );
    });
  });

  // ── startSlskdPollJob / stopSlskdPollJob ────────────────────────────────

  describe('startSlskdPollJob', () => {
    it('should call pollSlskdDownloads immediately', () => {
      startSlskdPollJob();

      expect(pollSlskdDownloads).toHaveBeenCalled();
    });
  });

  describe('stopSlskdPollJob', () => {
    it('should handle being called when no poll job is active', () => {
      expect(() => stopSlskdPollJob()).not.toThrow();
    });
  });

  // ── Cron job callbacks ──────────────────────────────────────────────────

  describe('cron job callbacks', () => {
    it('should call scheduleSubscriptionJob when subscription cron triggers', async () => {
      addScheduledJob(42, 7, '0 0 * * *');

      // Grab the onTick callback passed to CronJob
      const cronCall = vi.mocked(CronJob).mock.calls.find(
        (call) => call[0] === '0 0 * * *'
      );
      expect(cronCall).toBeDefined();
      const onTick = cronCall![1] as () => Promise<void>;

      // Clear the initial update call from addScheduledJob
      vi.mocked(prisma.subscription.update).mockClear();

      await onTick();

      expect(scheduleSubscriptionJob).toHaveBeenCalledWith(42, 7);
      // Callback also updates nextRun
      expect(prisma.subscription.update).toHaveBeenCalledWith({
        where: { id: 42 },
        data: { nextRun: new Date('2025-01-02T00:00:00Z') },
      });
    });

    it('should call scheduleImportJob when import cron triggers', async () => {
      addImportScheduledJob(3, 5, '0 6 * * *', 'preview' as any);

      const cronCall = vi.mocked(CronJob).mock.calls.find(
        (call) => call[0] === '0 6 * * *'
      );
      expect(cronCall).toBeDefined();
      const onTick = cronCall![1] as () => Promise<void>;

      await onTick();

      expect(scheduleImportJob).toHaveBeenCalledWith(3, 5, 'preview');
    });
  });
});
