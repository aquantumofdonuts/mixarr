/**
 * Constellation Orbit-Crawl Worker
 *
 * Warms one user's taste orbit into the constellation cache: it collects seed
 * artists (tiered by recency), records them into {@link ConstellationOrbit}, and
 * runs the breadth-first, edge-budget-bounded {@link OrbitCrawler} outward from
 * them — nearest tiers first, so the edge budget (Task 9) is spent on the music
 * closest to the user's recent listening. This is the perpetual low-priority
 * background crawler from design §4.2.
 *
 * TESTABLE CORE WITHOUT REDIS: the orchestration is {@link runOrbitCrawl}, a pure
 * function over injected seams — an {@link OrbitSeedCollector}, its
 * {@link SeedSource}s, an {@link OrbitCrawler} (built by the caller with the real
 * expand/isFull adapters), and a `markOrbit` upsert. It references no BullMQ, no
 * Redis, and no Prisma, so it is unit-tested with fakes. The BullMQ + socket.io
 * shell ({@link registerOrbitCrawlWorker}) dynamically imports bullmq/redis/queue
 * INSIDE the register function and is only ever called at app startup, so merely
 * importing this module opens no Redis connection (mirrors Task 8's worker).
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { OrbitCrawler } from '../../services/constellation/OrbitCrawler.js';
import type {
  OrbitSeedCollector,
  SeedSource,
  OrbitTier,
} from '../../services/constellation/OrbitSeedCollector.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('OrbitCrawlWorker');

/**
 * Default materialized-edge budget for a background orbit crawl (Task 9's hard
 * bound). Sized so a single crawl warms a meaningful neighbourhood without
 * running away on small-world collaboration graphs. Tunable per-job later.
 */
const DEFAULT_MAX_EDGES = 2_000;

/**
 * BullMQ job priority for a background orbit crawl. In BullMQ, priority is a
 * JOB option (higher number = LOWER priority), applied when the job is enqueued.
 * This large value keeps the perpetual background crawl behind interactive
 * on-demand expansions. {@link enqueueOrbitCrawl} stamps it onto every crawl job.
 */
const LOW_PRIORITY = 100;

export interface RunOrbitCrawlParams {
  userId: number;
  collector: OrbitSeedCollector;
  sources: SeedSource[];
  /** Built by the caller with the real expand/isFull adapters (see below). */
  crawler: OrbitCrawler;
  maxEdges: number;
  maxDepth?: number;
  /** Upsert one seed into ConstellationOrbit with its tier (injected -> testable). */
  markOrbit: (userId: number, personId: number, tier: OrbitTier) => Promise<void>;
}

export interface RunOrbitCrawlResult {
  personsExpanded: number;
  edgesMaterialized: number;
  seeds: number;
}

/**
 * Orchestrate a single orbit crawl:
 *   1. collect tiered, de-duplicated seeds (nearest tier first);
 *   2. mark each seed into ConstellationOrbit with its tier;
 *   3. crawl outward from the seeds in nearest-first order, bounded by maxEdges.
 *
 * The seed order handed to the crawler is exactly the collector's nearest-first
 * order, so the crawler's breadth-first traversal fills nearer tiers first within
 * the edge budget. Returns the crawl counts plus how many seeds were used.
 */
export async function runOrbitCrawl(p: RunOrbitCrawlParams): Promise<RunOrbitCrawlResult> {
  const seeds = await p.collector.collect(p.sources);

  // Mark every seed into the orbit with its (nearest) tier before crawling. A
  // single bookkeeping-upsert failure must not reject the whole warm before it
  // even runs — log and continue (mirrors the collector's per-source resilience).
  for (const { personId, tier } of seeds) {
    try {
      await p.markOrbit(p.userId, personId, tier);
    } catch (err) {
      logger.warn(
        `markOrbit failed for user ${p.userId} person ${personId} (${tier}), continuing: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Seeds already carry nearest-first tier order from the collector; preserve it.
  const seedIds = seeds.map((s) => s.personId);

  if (seedIds.length === 0) {
    // Nothing resolved — no crawl to run.
    return { personsExpanded: 0, edgesMaterialized: 0, seeds: 0 };
  }

  const { personsExpanded, edgesMaterialized } = await p.crawler.crawl(seedIds, {
    maxEdges: p.maxEdges,
    maxDepth: p.maxDepth,
  });

  return { personsExpanded, edgesMaterialized, seeds: seedIds.length };
}

// ---------------------------------------------------------------------------
// Production adapters (thin) — composed by registerOrbitCrawlWorker.
//
// These are the ONLY places that touch Prisma / the real ExpansionService. They
// are kept out of runOrbitCrawl so the orchestration stays Redis/Prisma-free.
// ---------------------------------------------------------------------------

/**
 * Build the OrbitCrawler `expand` adapter around the real {@link ExpansionService}.
 *
 * It expands the person (materializing ConstellationEdge/ConstellationPerson
 * rows), then reads that person's outgoing edges to report the discovered
 * neighbours.
 *
 * edgesCreated APPROXIMATION: we report the person's TOTAL outgoing-edge count
 * after expansion as `edgesCreated`, not strictly the number of NEW rows this
 * call inserted. For a fresh expand (the common case in a cold orbit warm) every
 * edge is new, so total == new. On a re-expand of an already-materialized person
 * this over-counts against the budget — that is the safe direction (it makes the
 * crawl stop SOONER, never later), and {@link OrbitCrawler} already skips
 * fully-expanded persons via `isFull`, so re-expands are rare. Computing exact
 * new-row deltas would require a pre-count/post-count around expandPerson; the
 * approximation is documented and intentional.
 */
export function makeExpandAdapter(
  expansionService: { expandPerson(id: number): Promise<void> },
  prisma: { constellationEdge: { findMany(args: unknown): Promise<Array<{ targetPersonId: number }>> } },
): (personId: number) => Promise<{ neighborIds: number[]; edgesCreated: number }> {
  return async (personId: number) => {
    // OrbitCrawler awaits expand() UNGUARDED, so a throw here would abort the
    // whole crawl. expandPerson is already hardened against per-release errors,
    // but a total getArtistReleases failure (source down) can still throw — treat
    // one unreachable/failing person as a dead end (no neighbours, no edges) so
    // the rest of the warm proceeds.
    try {
      await expansionService.expandPerson(personId);
      const edges = await prisma.constellationEdge.findMany({
        where: { sourcePersonId: personId },
        select: { targetPersonId: true },
      });
      const neighborIds = edges.map((e) => e.targetPersonId);
      return { neighborIds, edgesCreated: neighborIds.length };
    } catch (err) {
      logger.warn(
        `expand failed for person ${personId}, skipping: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { neighborIds: [], edgesCreated: 0 };
    }
  };
}

/** Build the `isFull` adapter: reads ConstellationPerson.fullyExpanded. */
function makeIsFullAdapter(prisma: {
  constellationPerson: { findUnique(args: unknown): Promise<{ fullyExpanded: boolean } | null> };
}): (personId: number) => Promise<boolean> {
  return async (personId: number) =>
    (await prisma.constellationPerson.findUnique({ where: { personId } }))?.fullyExpanded ?? false;
}

/** Build the `markOrbit` adapter: upsert a ConstellationOrbit row for a seed. */
function makeMarkOrbitAdapter(prisma: {
  constellationOrbit: { upsert(args: unknown): Promise<unknown> };
}): (userId: number, personId: number, tier: OrbitTier) => Promise<void> {
  return async (userId: number, personId: number, tier: OrbitTier) => {
    await prisma.constellationOrbit.upsert({
      where: { userId_personId: { userId, personId } },
      create: { userId, personId, tier, status: 'crawling', lastCrawledAt: new Date() },
      update: { tier, status: 'crawling', lastCrawledAt: new Date() },
    });
  };
}

/**
 * Injectable resolvers for {@link buildSeedSources} so the seed wiring is
 * unit-testable without the connections table / live services.
 */
export interface SeedSourceDeps {
  /** The user's Lidarr library artists (each carries its MusicBrainz `foreignArtistId`). */
  getLidarrArtists?: (userId: number) => Promise<Array<{ foreignArtistId: string }>>;
  /** The user's Last.fm recent top artists (name + optional MBID). */
  getLastfmTopArtists?: (userId: number) => Promise<Array<{ mbid?: string; name: string }>>;
}

/**
 * Build the tiered {@link SeedSource}s for a user.
 *
 * WIRED (this task):
 *   - `lib`     <- the user's Lidarr library artists, keyed by MBID
 *                  (`foreignArtistId`); the collector resolves each MBID to a
 *                  Discogs person id via IdentityService.mbidToDiscogs.
 *   - `hist30d` <- the user's Last.fm top artists over the last month
 *                  (a readily-available listening-history signal), as mbid/name
 *                  refs; name-only refs are skipped by the collector (name→discogs
 *                  resolution is out of scope), MBID-bearing refs resolve.
 *
 * DEFERRED (documented TODO): finer recency windows and the other backends still
 * need per-connection config / windowed queries not cleanly surfaced here:
 *   - hist1d / hist7d  <- Tautulli / ListenBrainz recent-play windows, and
 *                         Last.fm 7day; wire once those connections expose the
 *                         windowed queries + username config uniformly.
 *   - libtop           <- "top" slice of the library (Lidarr play stats /
 *                         Jellyfin favourites) — no per-artist play-rank is
 *                         exposed by the Lidarr artist list today.
 *
 * Every source is a lazy `getArtists` closure that resolves its connection at
 * call time and returns [] when the connection is absent, so a crawl for a user
 * with no configured sources is a well-defined no-op.
 */
export function buildSeedSources(userId: number, deps: SeedSourceDeps = {}): SeedSource[] {
  const getLidarrArtists = deps.getLidarrArtists ?? defaultGetLidarrArtists;
  const getLastfmTopArtists = deps.getLastfmTopArtists ?? defaultGetLastfmTopArtists;

  return [
    {
      tier: 'hist30d',
      getArtists: async () => {
        const artists = await getLastfmTopArtists(userId);
        return artists.map((a) => ({ mbid: a.mbid || undefined, name: a.name }));
      },
    },
    {
      tier: 'lib',
      getArtists: async () => {
        const artists = await getLidarrArtists(userId);
        return artists
          .filter((a) => !!a.foreignArtistId)
          .map((a) => ({ mbid: a.foreignArtistId }));
      },
    },
  ];
}

/** Default `lib` supplier: the user's Lidarr library artists. */
async function defaultGetLidarrArtists(userId: number): Promise<Array<{ foreignArtistId: string }>> {
  const { ConnectionResolver } = await import('../../lib/connection-resolver.js');
  const lidarr = await ConnectionResolver.getLidarrService(userId);
  if (!lidarr) return [];
  return lidarr.getArtists();
}

/** Default `hist30d` supplier: the user's Last.fm top artists over the last month. */
async function defaultGetLastfmTopArtists(
  userId: number,
): Promise<Array<{ mbid?: string; name: string }>> {
  const { ConnectionResolver } = await import('../../lib/connection-resolver.js');
  const conn = await ConnectionResolver.getConnection('lastfm', userId);
  if (!conn) return [];
  const cfg = conn.config as { apiKey?: string; username?: string };
  if (!cfg.apiKey || !cfg.username) return [];

  const { LastfmService } = await import('../../services/lastfm.js');
  const service = new LastfmService({ apiKey: cfg.apiKey });
  const { artists } = await service.getUserTopArtists(cfg.username, '1month', 100);
  return artists.map((a) => ({ mbid: a.mbid || undefined, name: a.name }));
}

/**
 * Enqueue a background orbit-crawl job for a user at LOW priority. Guarded
 * (dynamic import of the crawl queue) so importing this module opens no Redis
 * connection; call it from the future idle/re-wake scheduler. A fixed jobId
 * de-duplicates concurrent warms for the same user.
 */
export async function enqueueOrbitCrawl(userId: number): Promise<void> {
  const { constellationCrawlQueue } = await import('./queue.js');
  await constellationCrawlQueue.add(
    'orbit-crawl',
    { userId },
    { jobId: `orbit-${userId}`, priority: LOW_PRIORITY },
  );
}

/**
 * Register the BullMQ worker for the `constellation-crawl` queue. Called at app
 * startup — NOT at module import time — so tests never open a Redis connection.
 *
 * bullmq/redis/queue and the Prisma-backed services are dynamically imported
 * HERE so they stay out of the module graph until the app wires workers. The
 * worker runs at LOW priority (higher `priority` number = lower priority in
 * BullMQ) so interactive expansions preempt this perpetual background crawl.
 *
 * TODO(constellation): a scheduler enqueues crawl jobs for idle users and
 * re-wakes stale orbits (design §4.2). That scheduling is out of scope here; this
 * worker owns only the RUN logic once a {userId} job is dequeued.
 */
export async function registerOrbitCrawlWorker(io?: SocketIOServer): Promise<void> {
  const { Worker } = await import('bullmq');
  const { createRedisConnection } = await import('../../lib/redis.js');
  const { CONSTELLATION_QUEUE_NAMES } = await import('./queue.js');
  const { default: prisma } = await import('../../lib/db.js');
  const { ExpansionService } = await import('../../services/constellation/ExpansionService.js');
  const { IdentityService } = await import('../../services/constellation/IdentityService.js');
  const { OrbitCrawler } = await import('../../services/constellation/OrbitCrawler.js');
  const { OrbitSeedCollector } = await import('../../services/constellation/OrbitSeedCollector.js');
  const { resolveConfiguredCreditSource } = await import(
    '../../services/constellation/resolveCreditSource.js'
  );

  const worker = new Worker(
    CONSTELLATION_QUEUE_NAMES.CRAWL,
    async (job) => {
      const { userId } = job.data as { userId?: number };
      if (userId == null) {
        // This worker owns only per-user orbit warms; a seed-only crawl job
        // (Task 9 shape) is not ours to process.
        throw new Error('Orbit crawl job is missing userId');
      }

      // The CreditSource for ExpansionService is supplied by the data-source
      // layer per the user's "Setting-ON/OFF" configuration (SQLite dump index or
      // live Discogs adapter). The live path uses the user's (else global) Discogs
      // connection.
      const creditSource = await resolveConfiguredCreditSource(userId);
      const expansionService = new ExpansionService(creditSource);
      const identity = new IdentityService();

      const collector = new OrbitSeedCollector((mbid) => identity.mbidToDiscogs(mbid));
      const sources = buildSeedSources(userId);
      const crawler = new OrbitCrawler({
        expand: makeExpandAdapter(expansionService, prisma),
        isFull: makeIsFullAdapter(prisma),
      });

      try {
        const result = await runOrbitCrawl({
          userId,
          collector,
          sources,
          crawler,
          maxEdges: DEFAULT_MAX_EDGES,
          markOrbit: makeMarkOrbitAdapter(prisma),
        });

        // Settle every crawled seed's orbit status to 'crawled'.
        await prisma.constellationOrbit.updateMany({
          where: { userId, status: 'crawling' },
          data: { status: 'crawled', lastCrawledAt: new Date() },
        });

        void job.updateProgress({ phase: 'crawled', ...result });
        return result;
      } finally {
        // The DumpIndexService (Setting-ON) opens a SQLite handle; release it when
        // we own one. The live adapter has no handle (no-op).
        const closable = creditSource as { close?: () => void };
        if (typeof closable.close === 'function') closable.close();
      }
    },
    {
      connection: createRedisConnection(),
      // Single-slot consumer: this is a slow perpetual background crawl, and job
      // PRIORITY (stamped at enqueue by enqueueOrbitCrawl) orders the queue so
      // interactive on-demand expansions run ahead of it.
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    logger.info(`Orbit crawl job ${job.id} completed`);
    io?.emit('constellation:crawl:completed', { jobId: job.id, result: job.returnvalue });
  });
  worker.on('failed', (job, error) => {
    logger.error(`Orbit crawl job ${job?.id} failed`, { error });
    io?.emit('constellation:crawl:failed', { jobId: job?.id, error: error?.message });
  });
}
