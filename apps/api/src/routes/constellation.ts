/**
 * Collaboration Constellation HTTP surface (Design §4.2, §7, §13).
 *
 * The read/traversal API the frontend (Tasks 17-22) consumes:
 *  - GET /seed                     seed the graph from an artist (discogs id or mbid)
 *  - GET /expand/:personId         optimistic cached neighbours + background expand
 *  - GET /path                     six-degrees path finding (shortest | interesting)
 *  - GET /person/:personId/releases  discography for the side panel
 *  - GET /stream/:token            SSE push channel for background-expanded nodes
 *  - GET /owned                    the user's owned person-id set (owned ring)
 *
 * ## Decisions
 * - **Auth**: every route sits behind `requireAuth`; the authenticated user id is
 *   read as `req.user!.id`, matching the other routers (see routes/dashboard.ts).
 * - **Album seeds**: NOT yet supported. `type=album` returns 400 with a clear
 *   message rather than guessing a primary artist — album→artist resolution needs
 *   a token-bearing Discogs lookup we deliberately keep out of this read surface.
 *   Documented simplification; artist seeds are the shipped path.
 * - **SSE push source**: an in-process {@link StreamRegistry} over Node's
 *   `EventEmitter`, keyed by opaque stream-token id. No Redis, no socket.io — the
 *   SSE endpoint is leak-free (listener removed + heartbeat cleared on close) and
 *   unit-testable. The expand worker publishes newly-expanded nodes by importing
 *   {@link publishToStream}. DEFERRED WORK (Task 16): the `constellation-expand`
 *   worker does not yet exist (this router only enqueues the job). Two things
 *   remain for that task: (1) BUILD the expand worker that consumes
 *   `constellation-expand` jobs, and (2) have it call
 *   `publishToStream(job.data.tokenId, job.data.generation, node)` for each
 *   newly-expanded node — using the `tokenId`/`generation` this router now threads
 *   through the job payload. Everything on this side (token minting + user-scoping,
 *   generation framing, the payload correlation fields, and the publish/subscribe
 *   primitive) is implemented here.
 * - **Generation (re-center race guard, §4.2)**: a stream token is `{id, generation}`.
 *   `/seed` mints a fresh token; re-centering with `?token=<id>` bumps that id's
 *   generation. Every SSE event carries the generation it was published with, so a
 *   client can discard events from a superseded (older) generation.
 * - **releases data source**: the public Discogs artist-releases endpoint
 *   (`fetchDiscogsArtistReleases`, injectable seam), mirroring IdentityService's
 *   public discography fetch — no per-user token needed for a read-only panel.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import prisma from '../lib/db.js';
import { requireAuth } from '../middleware/auth.js';
import { parseIntParam } from '../utils/params.js';
import { createLogger } from '../lib/logger.js';
import { GraphService } from '../services/constellation/GraphService.js';
import { IdentityService } from '../services/constellation/IdentityService.js';
import {
  constellationExpandQueue,
  CONSTELLATION_QUEUE_NAMES,
  type ConstellationExpandJobData,
} from '../jobs/constellation/queue.js';
import { rateLimit } from '../services/rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';

const log = createLogger('Constellation');

const DISCOGS_API_TIMEOUT = 15_000;
const DEFAULT_MAX_DEGREES = 6;
/** Hard ceiling on requested path degrees (DoS guard on traversal cost). */
const MAX_PATH_DEGREES = 10;
const HEARTBEAT_MS = 25_000;
const MBID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Stream registry — in-process SSE push channel keyed by stream-token id.
// ---------------------------------------------------------------------------

export interface StreamToken {
  id: string;
  generation: number;
}

/** Raised when a token is accessed by a user that does not own it. */
export class StreamTokenForbiddenError extends Error {
  constructor(tokenId: string) {
    super(`stream token ${tokenId} does not belong to this user`);
    this.name = 'StreamTokenForbiddenError';
  }
}

interface TokenState {
  generation: number;
  userId: number;
}

/**
 * In-process pub/sub over a single {@link EventEmitter}, keyed by opaque
 * stream-token id. `mint` issues a token bound to the minting user; `bump`
 * advances an existing token's generation on re-center; `subscribe` returns an
 * unsubscribe fn (leak-free SSE); `publish` fans a payload out to subscribers,
 * stamping the generation.
 *
 * Tokens are USER-SCOPED: a token remembers the userId that minted it, and
 * `bump`/`ownerOf` let the route layer reject cross-user access (IDOR/DoS guard).
 */
export class StreamRegistry {
  private readonly emitter = new EventEmitter();
  private readonly tokens = new Map<string, TokenState>();

  constructor() {
    // SSE fan-out can attach many short-lived listeners; lift the warn ceiling.
    this.emitter.setMaxListeners(0);
  }

  /** Issue a brand-new stream token (generation 1) bound to `userId`. */
  mint(userId: number): StreamToken {
    const id = randomUUID();
    this.tokens.set(id, { generation: 1, userId });
    return { id, generation: 1 };
  }

  /**
   * Advance an existing token's generation (re-center). Returns the new token;
   * if the id is unknown (e.g. process restart), it is minted at generation 1 for
   * `userId`. Throws {@link StreamTokenForbiddenError} if the token exists but
   * belongs to a different user.
   */
  bump(id: string, userId: number): StreamToken {
    const existing = this.tokens.get(id);
    if (!existing) {
      // Unknown id (e.g. process restart) — mint fresh for this caller.
      return this.mint(userId);
    }
    if (existing.userId !== userId) throw new StreamTokenForbiddenError(id);
    existing.generation += 1;
    return { id, generation: existing.generation };
  }

  /** The userId that owns a token, or undefined if the token was never minted. */
  ownerOf(id: string): number | undefined {
    return this.tokens.get(id)?.userId;
  }

  /** Current generation for a token id, or undefined if never minted. */
  currentGeneration(id: string): number | undefined {
    return this.tokens.get(id)?.generation;
  }

  /** Subscribe to a token's events; returns an unsubscribe function. */
  subscribe(id: string, listener: (data: unknown) => void): () => void {
    this.emitter.on(id, listener);
    return () => {
      this.emitter.off(id, listener);
    };
  }

  /** Number of active subscribers for a token (used to assert leak-free close). */
  listenerCount(id: string): number {
    return this.emitter.listenerCount(id);
  }

  /** Publish a payload to a token's subscribers, stamping the generation. */
  publish(id: string, generation: number, payload: Record<string, unknown>): void {
    this.emitter.emit(id, { generation, ...payload });
  }
}

/** Process-wide default registry backing the exported {@link publishToStream}. */
const defaultStreams = new StreamRegistry();

/**
 * Publish a newly-expanded node (or any payload) to an SSE stream. This is the
 * integration seam the `constellation-expand` worker calls once it exists:
 *   publishToStream(token, generation, { personId, node, edges })
 */
export function publishToStream(
  tokenId: string,
  generation: number,
  payload: Record<string, unknown>,
): void {
  defaultStreams.publish(tokenId, generation, payload);
}

// ---------------------------------------------------------------------------
// Releases (side-panel discography) — public Discogs artist-releases fetch.
// ---------------------------------------------------------------------------

export interface ReleaseItem {
  releaseId: number;
  title: string;
  year: number | null;
  master: number | null;
}

export type GetArtistReleases = (artistId: number) => Promise<ReleaseItem[]>;

/**
 * Default releases source: the public Discogs artist-releases endpoint (no token
 * required, behind the shared `discogs` rate limiter). Degrades to an empty list
 * on any failure so the panel simply shows nothing rather than erroring.
 */
export async function fetchDiscogsArtistReleases(artistId: number): Promise<ReleaseItem[]> {
  await rateLimit('discogs');
  try {
    const response = await fetchWithTimeout(
      `https://api.discogs.com/artists/${artistId}/releases?per_page=100&sort=year&sort_order=desc`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mixarr/2.0.0 (https://github.com/aquantumofdonuts/mixarr)',
        },
        timeout: DISCOGS_API_TIMEOUT,
      },
    );
    if (!response.ok) return [];
    const data = (await response.json()) as {
      releases?: Array<{ id?: number; title?: string; year?: number; master_id?: number }>;
    };
    return (data.releases ?? [])
      .filter((r): r is { id: number; title?: string; year?: number; master_id?: number } =>
        typeof r.id === 'number',
      )
      .map((r) => ({
        releaseId: r.id,
        title: r.title ?? '',
        year: typeof r.year === 'number' && r.year > 0 ? r.year : null,
        master: typeof r.master_id === 'number' && r.master_id > 0 ? r.master_id : null,
      }));
  } catch (error) {
    log.debug(`Discogs releases fetch failed for artist ${artistId}: ${error}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Handlers (dependency-injected so they are unit-testable without Redis/DB).
// ---------------------------------------------------------------------------

/** Minimal shape the router needs off the expand queue (mock-friendly). */
export interface ExpandQueueLike {
  add(name: string, data: ConstellationExpandJobData): Promise<unknown>;
}

export interface ConstellationDeps {
  graph?: GraphService;
  identity?: IdentityService;
  expandQueue?: ExpandQueueLike;
  getArtistReleases?: GetArtistReleases;
  streams?: StreamRegistry;
}

export interface ConstellationHandlers {
  seed(req: Request, res: Response): Promise<void>;
  expand(req: Request, res: Response): Promise<void>;
  path(req: Request, res: Response): Promise<void>;
  releases(req: Request, res: Response): Promise<void>;
  stream(req: Request, res: Response): Promise<void>;
  owned(req: Request, res: Response): Promise<void>;
}

export function buildConstellationHandlers(deps: ConstellationDeps = {}): ConstellationHandlers {
  const graph = deps.graph ?? new GraphService();
  const identity = deps.identity ?? new IdentityService();
  const expandQueue = deps.expandQueue ?? constellationExpandQueue;
  const getArtistReleases = deps.getArtistReleases ?? fetchDiscogsArtistReleases;
  const streams = deps.streams ?? defaultStreams;

  return {
    /**
     * GET /seed?type=artist&id=<discogsId|mbid>[&token=<id>]
     * Resolve the seed to a Discogs person id, return its subgraph + a stream
     * token. `type=album` is not supported (400). Re-center via `?token=` bumps
     * that token's generation instead of minting a new one.
     */
    async seed(req: Request, res: Response): Promise<void> {
      try {
        const userId = req.user!.id;
        const type = (typeof req.query.type === 'string' ? req.query.type : 'artist').toLowerCase();
        const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
        const existingToken = typeof req.query.token === 'string' ? req.query.token : undefined;

        if (type === 'album') {
          res.status(400).json({ error: 'album seeds not yet supported' });
          return;
        }
        if (type !== 'artist') {
          res.status(400).json({ error: `unsupported seed type: ${type}` });
          return;
        }
        if (!id) {
          res.status(400).json({ error: 'seed id is required' });
          return;
        }

        // Resolve focus: numeric -> Discogs id; mbid-shaped -> IdentityService.
        let focusId: number | null;
        if (/^[0-9]+$/.test(id)) {
          focusId = Number(id);
        } else if (MBID_RE.test(id)) {
          focusId = await identity.mbidToDiscogs(id);
          if (focusId === null) {
            res.status(404).json({ error: `could not resolve MBID ${id} to a Discogs artist` });
            return;
          }
        } else {
          res.status(400).json({ error: 'seed id must be a Discogs artist id or an MBID' });
          return;
        }

        const subgraph = await graph.subgraph(focusId, { userId });

        // User-scoped tokens: a re-center (?token=) may only bump the caller's own
        // token; a token owned by another user is rejected (IDOR/DoS guard).
        let streamToken: StreamToken;
        try {
          streamToken = existingToken ? streams.bump(existingToken, userId) : streams.mint(userId);
        } catch (error) {
          if (error instanceof StreamTokenForbiddenError) {
            res.status(403).json({ error: 'stream token belongs to another user' });
            return;
          }
          throw error;
        }

        res.json({ focusId, subgraph, streamToken });
      } catch (error) {
        log.error('seed failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : 'seed failed' });
      }
    },

    /**
     * GET /expand/:personId[?token=<id>&generation=<n>]
     * Optimistic: enqueue a background expand job (guarded so a missing Redis in
     * tests never throws) and return the currently-cached subgraph immediately.
     * When a stream token is supplied it is threaded into the job payload so the
     * expand worker (Task 16) can push results to the correct SSE stream.
     */
    async expand(req: Request, res: Response): Promise<void> {
      try {
        const userId = req.user!.id;
        const personId = parseIntParam(req.params.personId);
        if (personId === null) {
          res.status(400).json({ error: 'invalid person id' });
          return;
        }

        const tokenId = typeof req.query.token === 'string' ? req.query.token : undefined;
        const generation =
          parseIntParam(typeof req.query.generation === 'string' ? req.query.generation : undefined) ??
          undefined;

        const jobData: ConstellationExpandJobData = { artistId: personId };
        if (tokenId) {
          jobData.tokenId = tokenId;
          if (generation !== undefined) jobData.generation = generation;
        }

        let enqueued = false;
        try {
          await expandQueue.add(CONSTELLATION_QUEUE_NAMES.EXPAND, jobData);
          enqueued = true;
        } catch (error) {
          // Redis down / queue unavailable must not fail the optimistic read.
          log.warn('expand enqueue failed (returning cached subgraph only)', {
            personId,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const subgraph = await graph.subgraph(personId, { userId });
        res.json({ personId, enqueued, subgraph });
      } catch (error) {
        log.error('expand failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : 'expand failed' });
      }
    },

    /**
     * GET /path?from=<id>&to=<id>&mode=shortest|interesting&max=<n>
     * Six-degrees path finding; 404 when no path exists within the degree bound.
     */
    async path(req: Request, res: Response): Promise<void> {
      try {
        const from = parseIntParam(typeof req.query.from === 'string' ? req.query.from : undefined);
        const to = parseIntParam(typeof req.query.to === 'string' ? req.query.to : undefined);
        if (from === null || to === null) {
          res.status(400).json({ error: 'from and to must be valid person ids' });
          return;
        }

        const rawMode = typeof req.query.mode === 'string' ? req.query.mode : 'shortest';
        if (rawMode !== 'shortest' && rawMode !== 'interesting') {
          res.status(400).json({ error: "mode must be 'shortest' or 'interesting'" });
          return;
        }
        // Clamp the degree bound so a caller can't request an expensive
        // huge-degree traversal.
        const parsedMax = parseIntParam(typeof req.query.max === 'string' ? req.query.max : undefined);
        const max = Math.min(parsedMax ?? DEFAULT_MAX_DEGREES, MAX_PATH_DEGREES);

        const result = await graph.path(from, to, { mode: rawMode, max });
        if (result === null) {
          res.status(404).json({ error: `no path within ${max} degrees` });
          return;
        }
        res.json(result);
      } catch (error) {
        log.error('path failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : 'path failed' });
      }
    },

    /**
     * GET /person/:personId/releases
     * The person's discography for the side panel.
     */
    async releases(req: Request, res: Response): Promise<void> {
      try {
        const personId = parseIntParam(req.params.personId);
        if (personId === null) {
          res.status(400).json({ error: 'invalid person id' });
          return;
        }
        const releases = await getArtistReleases(personId);
        res.json({ personId, releases });
      } catch (error) {
        log.error('releases failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : 'releases failed' });
      }
    },

    /**
     * GET /stream/:token  (SSE)
     * Subscribe to background-expand events for a stream token. Each event is a
     * `data:` frame carrying the generation it was published with. Cleans up
     * (listener + heartbeat) on client close — leak-free.
     */
    async stream(req: Request, res: Response): Promise<void> {
      const userId = req.user!.id;
      const token = req.params.token;
      if (!token) {
        res.status(400).json({ error: 'stream token is required' });
        return;
      }

      // User-scoped: an existing token owned by a different user is rejected. A
      // not-yet-minted token id is allowed (the SSE may connect before /seed's
      // response is processed; the owner check only fires for a known mismatch).
      const owner = streams.ownerOf(token);
      if (owner !== undefined && owner !== userId) {
        res.status(403).json({ error: 'stream token belongs to another user' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders?.();

      // Announce the current generation so a late-connecting client can sync.
      const generation = streams.currentGeneration(token);
      res.write(`event: open\ndata: ${JSON.stringify({ token, generation })}\n\n`);

      const unsubscribe = streams.subscribe(token, (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      });

      // Heartbeat keeps intermediaries from closing an idle connection.
      const heartbeat = setInterval(() => {
        res.write(': ping\n\n');
      }, HEARTBEAT_MS);
      // Do not let the heartbeat hold the event loop / test process open.
      (heartbeat as { unref?: () => void }).unref?.();

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end?.();
      });
    },

    /**
     * GET /owned
     * The user's owned person-id set (distinct), for the frontend owned ring.
     */
    async owned(req: Request, res: Response): Promise<void> {
      try {
        const userId = req.user!.id;
        const rows = (await prisma.constellationOwned.findMany({
          where: { userId },
          select: { personId: true },
        })) as Array<{ personId: number }>;
        const owned = [...new Set(rows.map((r) => r.personId))];
        res.json({ owned });
      } catch (error) {
        log.error('owned failed', { error: error instanceof Error ? error.message : String(error) });
        res.status(500).json({ error: error instanceof Error ? error.message : 'owned failed' });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createConstellationRouter(deps: ConstellationDeps = {}): Router {
  const router = Router();
  router.use(requireAuth);

  const h = buildConstellationHandlers(deps);

  router.get('/seed', h.seed);
  router.get('/expand/:personId', h.expand);
  router.get('/path', h.path);
  router.get('/person/:personId/releases', h.releases);
  router.get('/stream/:token', h.stream);
  router.get('/owned', h.owned);

  return router;
}

export const constellationRouter = createConstellationRouter();
