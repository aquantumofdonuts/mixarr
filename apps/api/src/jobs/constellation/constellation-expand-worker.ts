/**
 * Constellation On-Demand Expand Worker
 *
 * Consumes `constellation-expand` jobs `{ artistId, tokenId?, generation? }`
 * (enqueued by GET /constellation/expand/:personId, Task 15). For each job it
 * expands the person through the configured {@link CreditSource} (SQLite dump
 * index or live Discogs adapter), materializing ConstellationEdge/Person rows,
 * then reads that person's freshly-materialized subgraph and — when the job
 * carries a stream token — pushes it to the matching SSE stream via
 * {@link publishToStream} so the client that requested the re-center receives the
 * new nodes/edges.
 *
 * TESTABLE CORE WITHOUT REDIS: the orchestration is {@link runExpandJob}, a pure
 * function over injected seams (an expand service, a `getNeighbors` reader, and a
 * `publish` fn). It references no BullMQ, Redis, or Prisma. The BullMQ + socket.io
 * shell ({@link registerConstellationExpandWorker}) dynamically imports
 * bullmq/redis/queue INSIDE the register function and is only ever called at app
 * startup, so merely importing this module opens no Redis connection (mirrors the
 * dump-import / orbit-crawl workers).
 */

import type { Server as SocketIOServer } from 'socket.io';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('ConstellationExpandWorker');

/** The neighbours payload pushed to the SSE stream after an expand. */
export interface ExpandNeighbors {
  nodes: unknown[];
  edges: unknown[];
}

export interface RunExpandJobParams {
  artistId: number;
  tokenId?: string;
  generation?: number;
  /** Materializes the person's edges/nodes (real {@link ExpansionService}). */
  expandService: { expandPerson(id: number): Promise<void> };
  /** Reads the person's freshly-materialized subgraph (nodes + edges). */
  getNeighbors: (artistId: number) => Promise<ExpandNeighbors>;
  /** Publishes a payload to an SSE stream ({@link publishToStream}). */
  publish: (tokenId: string, generation: number, payload: Record<string, unknown>) => void;
}

export interface RunExpandJobResult {
  artistId: number;
  published: boolean;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Orchestrate one expand job: materialize the person, read its neighbours, and —
 * only when a stream token is present — publish them to the correlated SSE stream.
 *
 * The ordering is expand -> read -> publish so the client only ever receives
 * already-materialized nodes/edges. When no token is present (e.g. a background
 * warm that isn't tied to an open stream) nothing is published.
 *
 * Generation default: when a token is present but the job omitted a generation,
 * we stamp generation 1 — the generation of a freshly-minted (never re-centered)
 * token — so the event still frames correctly for a first-generation client.
 */
export async function runExpandJob(p: RunExpandJobParams): Promise<RunExpandJobResult> {
  await p.expandService.expandPerson(p.artistId);

  const { nodes, edges } = await p.getNeighbors(p.artistId);

  let published = false;
  if (p.tokenId) {
    p.publish(p.tokenId, p.generation ?? 1, { focusId: p.artistId, nodes, edges });
    published = true;
  }

  return { artistId: p.artistId, published, nodeCount: nodes.length, edgeCount: edges.length };
}

/**
 * Register the BullMQ worker for the `constellation-expand` queue. Called at app
 * startup — NOT at module import time — so tests never open a Redis connection.
 *
 * bullmq/redis/queue and the Prisma-backed services are dynamically imported HERE
 * so they stay out of the module graph until the app wires workers.
 */
export async function registerConstellationExpandWorker(io?: SocketIOServer): Promise<void> {
  const { Worker } = await import('bullmq');
  const { createRedisConnection } = await import('../../lib/redis.js');
  const { CONSTELLATION_QUEUE_NAMES } = await import('./queue.js');
  const { ExpansionService } = await import('../../services/constellation/ExpansionService.js');
  const { GraphService } = await import('../../services/constellation/GraphService.js');
  const { resolveConfiguredCreditSource } = await import(
    '../../services/constellation/resolveCreditSource.js'
  );
  const { publishToStream } = await import('../../routes/constellation.js');

  const worker = new Worker(
    CONSTELLATION_QUEUE_NAMES.EXPAND,
    async (job) => {
      const { artistId, tokenId, generation } = job.data as {
        artistId?: number;
        tokenId?: string;
        generation?: number;
      };
      if (artistId == null) throw new Error('Constellation expand job is missing artistId');

      // Resolve the configured backend (index or live Discogs). This job is not
      // user-scoped, so the live path uses the global Discogs connection.
      const creditSource = await resolveConfiguredCreditSource();
      const expansionService = new ExpansionService(creditSource);
      const graph = new GraphService();

      try {
        const result = await runExpandJob({
          artistId,
          tokenId,
          generation,
          expandService: expansionService,
          // Read the freshly-materialized subgraph around the expanded person.
          getNeighbors: async (id) => {
            const sub = await graph.subgraph(id);
            return { nodes: sub.nodes, edges: sub.edges };
          },
          publish: publishToStream,
        });

        void job.updateProgress({ phase: 'expanded', ...result });
        return result;
      } finally {
        // The DumpIndexService (Setting-ON) opens a SQLite handle; release it when
        // we own one, even if expand/read throws. The live adapter is a no-op.
        const closable = creditSource as { close?: () => void };
        if (typeof closable.close === 'function') closable.close();
      }
    },
    {
      connection: createRedisConnection(),
      // On-demand expansions are interactive; allow a few in parallel.
      concurrency: 4,
    },
  );

  worker.on('completed', (job) => {
    logger.info(`Constellation expand job ${job.id} completed`);
    io?.emit('constellation:expand:completed', { jobId: job.id, result: job.returnvalue });
  });
  worker.on('failed', (job, error) => {
    logger.error(`Constellation expand job ${job?.id} failed`, { error });
    io?.emit('constellation:expand:failed', { jobId: job?.id, error: error?.message });
  });
}
