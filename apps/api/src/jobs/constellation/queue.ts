/**
 * Collaboration Constellation Job Queues
 *
 * BullMQ queues for the "Setting-ON" constellation pipeline:
 *  - `constellation-import`: stream-parse the Discogs releases dump into the
 *    local {@link DumpIndexService} index (Task 8).
 *  - `constellation-crawl`: OrbitCrawler expansion from a seed artist (Task 9).
 *  - `constellation-expand`: on-demand node expansion for the graph view.
 *
 * Mirrors the conventions in `jobs/queue.ts` (queue names, Redis connection via
 * {@link createRedisConnection}, and shared {@link defaultJobOptions}).
 */

import { Queue } from 'bullmq';
import { createRedisConnection } from '../../lib/redis.js';

// Queue names — kept as a const object so callers reference them by key.
export const CONSTELLATION_QUEUE_NAMES = {
  IMPORT: 'constellation-import',
  CRAWL: 'constellation-crawl',
  EXPAND: 'constellation-expand',
} as const;

// ---------------------------------------------------------------------------
// Job data interfaces
// ---------------------------------------------------------------------------

/** Payload for a dump-import job: the path to the gzipped Discogs releases dump. */
export interface ConstellationImportJobData {
  /** Absolute filesystem path to the `discogs_*_releases.xml.gz` dump. */
  filePath: string;
}

/**
 * Payload for a crawl job. The crawl queue serves two shapes:
 *  - a single-seed expansion outward from `seedArtistId` (Task 9); and
 *  - a per-user orbit warm keyed by `userId` (Task 10's orbit-crawl-worker),
 *    which collects the user's tiered seeds itself.
 * At least one of the two keys is present for a given job.
 */
export interface ConstellationCrawlJobData {
  /** Single-seed crawl: the artist to expand outward from. */
  seedArtistId?: number;
  /** Per-user orbit warm: the user whose taste orbit to crawl. */
  userId?: number;
  /** Maximum crawl depth (hops from the seed). */
  maxDepth?: number;
}

/** Payload for an on-demand node-expansion job. */
export interface ConstellationExpandJobData {
  artistId: number;
}

// Shared job options — mirror the throughput/retention posture of the existing
// import queue. Dump import is long-running and non-idempotent-ish, so keep
// attempts low to avoid re-parsing a 100GB file on transient failures.
const defaultJobOptions = {
  attempts: 1,
  removeOnComplete: { count: 50 },
  removeOnFail: { count: 50 },
} as const;

// ---------------------------------------------------------------------------
// Queues
// ---------------------------------------------------------------------------

export const constellationImportQueue = new Queue<ConstellationImportJobData>(
  CONSTELLATION_QUEUE_NAMES.IMPORT,
  {
    connection: createRedisConnection(),
    defaultJobOptions,
  },
);

export const constellationCrawlQueue = new Queue<ConstellationCrawlJobData>(
  CONSTELLATION_QUEUE_NAMES.CRAWL,
  {
    connection: createRedisConnection(),
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  },
);

export const constellationExpandQueue = new Queue<ConstellationExpandJobData>(
  CONSTELLATION_QUEUE_NAMES.EXPAND,
  {
    connection: createRedisConnection(),
    defaultJobOptions: {
      ...defaultJobOptions,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    },
  },
);
