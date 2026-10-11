/**
 * Expand a constellation person through the configured CreditSource, then read
 * and publish the materialized subgraph to the matching SSE token/generation.
 *
 * runExpandJob uses injected expansion, reader, and publisher functions.
 * Worker registration imports BullMQ and Redis lazily; importing this module
 * does not open a Redis connection.
 */

import type { Server as SocketIOServer } from 'socket.io';
import { createLogger } from '../../lib/logger.js';
import { isApiBudgetExhausted } from '../../services/constellation/DailyApiBudget.js';

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
  const { SettingsService } = await import('../../services/settings.service.js');
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
      let creditSource: Awaited<ReturnType<typeof resolveConfiguredCreditSource>> | undefined;
      try {
        creditSource = await resolveConfiguredCreditSource();
        const expansionService = new ExpansionService(creditSource, { strict: true });
        const graph = new GraphService();
        const result = await runExpandJob({
          artistId,
          tokenId,
          generation,
          expandService: expansionService,
          // Read the freshly-materialized subgraph around the expanded person.
          getNeighbors: async (id) => {
            const settings = await SettingsService.getConstellationSettings();
            const sub = await graph.subgraph(id, { topN: Math.min(settings.fanoutN, 49), maxNodes: 50 });
            return { nodes: sub.nodes, edges: sub.edges };
          },
          publish: publishToStream,
        });

        try { await job.updateProgress({ phase: 'expanded', ...result }); }
        catch (error) { logger.warn('Expand progress update failed', { error }); }
        return result;
      } catch (err) {
        const budgetExhausted = isApiBudgetExhausted(err);
        const status = budgetExhausted ? 'budget-exhausted' : 'source-unavailable';
        logger.warn(`Constellation expand for ${artistId} failed`, { error: err });
        const published = Boolean(tokenId);
        if (tokenId) publishToStream(tokenId, generation ?? 1, {
          focusId: artistId, nodes: [], edges: [], status,
          ...(budgetExhausted ? {} : { detail: 'Collaborator source is unavailable. Please retry.' }),
        });
        const result = { artistId, published, budgetExhausted, status };
        try { await job.updateProgress({ phase: status, ...result }); }
        catch (error) { logger.warn('Expand progress update failed', { error }); }
        return result;
      } finally {
        // The DumpIndexService (Setting-ON) opens a SQLite handle; release it when
        // we own one, even if expand/read throws. The live adapter is a no-op.
        const closable = creditSource as { close?: () => void } | undefined;
        try { closable?.close?.(); }
        catch (error) { logger.warn('Expand source cleanup failed', { error }); }
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
