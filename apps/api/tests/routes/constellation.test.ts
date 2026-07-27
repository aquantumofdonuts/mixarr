import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The /owned handler reads prisma directly; mock the db client so importing the
// route module needs no generated Prisma client / live DB.
vi.mock('../../src/lib/db.js', () => ({
  default: {
    constellationOwned: { findMany: vi.fn() },
  },
}));

// The route module instantiates the expand queue at import (default dep). Mock
// BullMQ so tests never require Redis.
vi.mock('../../src/jobs/constellation/queue.js', () => ({
  constellationExpandQueue: { add: vi.fn() },
  CONSTELLATION_QUEUE_NAMES: { EXPAND: 'constellation-expand' },
}));

// Silence the logger.
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import prisma from '../../src/lib/db.js';
import {
  buildConstellationHandlers,
  createConstellationRouter,
  StreamRegistry,
  type ConstellationDeps,
} from '../../src/routes/constellation.js';

// ---- test doubles -----------------------------------------------------------

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    writes: [] as string[],
    ended: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(obj: unknown) {
      this.body = obj;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    flushHeaders() {},
    write(chunk: unknown) {
      this.writes.push(String(chunk));
      return true;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
  return res;
}

function mockReq(overrides: Record<string, unknown> = {}): any {
  const closeHandlers: Array<() => void> = [];
  return {
    user: { id: 7 },
    query: {},
    params: {},
    on(event: string, cb: () => void) {
      if (event === 'close') closeHandlers.push(cb);
    },
    emitClose() {
      for (const h of closeHandlers) h();
    },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ConstellationDeps> = {}): ConstellationDeps {
  return {
    graph: {
      subgraph: vi.fn(),
      path: vi.fn(),
    } as any,
    identity: {
      mbidToDiscogs: vi.fn(),
    } as any,
    expandQueue: { add: vi.fn().mockResolvedValue(undefined) },
    getArtistReleases: vi.fn(),
    streams: new StreamRegistry(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---- /seed ------------------------------------------------------------------

describe('GET /seed', () => {
  it('resolves a numeric discogs id and returns subgraph + stream token', async () => {
    const subgraph = { focusId: 42, nodes: [{ personId: 42 }], edges: [] };
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue(subgraph);
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { type: 'artist', id: '42' } });
    const res = mockRes();
    await h.seed(req, res);

    expect(deps.graph!.subgraph).toHaveBeenCalledWith(42, { userId: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.body.subgraph).toEqual(subgraph);
    expect(res.body.streamToken.id).toBeTypeOf('string');
    expect(res.body.streamToken.generation).toBeTypeOf('number');
    // identity resolution must NOT be used for a plain numeric id
    expect(deps.identity!.mbidToDiscogs).not.toHaveBeenCalled();
  });

  it('resolves an mbid-shaped id via IdentityService.mbidToDiscogs', async () => {
    const deps = makeDeps();
    (deps.identity!.mbidToDiscogs as any).mockResolvedValue(99);
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 99, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const mbid = 'f27ec8db-af05-4f36-916e-3d57f91ecf5e';
    const req = mockReq({ query: { type: 'artist', id: mbid } });
    const res = mockRes();
    await h.seed(req, res);

    expect(deps.identity!.mbidToDiscogs).toHaveBeenCalledWith(mbid);
    expect(deps.graph!.subgraph).toHaveBeenCalledWith(99, { userId: 7 });
    expect(res.statusCode).toBe(200);
  });

  it('404s when an mbid cannot be resolved to a discogs id', async () => {
    const deps = makeDeps();
    (deps.identity!.mbidToDiscogs as any).mockResolvedValue(null);
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { id: 'f27ec8db-af05-4f36-916e-3d57f91ecf5e' } });
    const res = mockRes();
    await h.seed(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/resolve/i);
  });

  it('400s for album seeds (documented simplification)', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ query: { type: 'album', id: '42' } });
    const res = mockRes();
    await h.seed(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/album/i);
  });
});

// ---- /expand ----------------------------------------------------------------

describe('GET /expand/:personId', () => {
  it('enqueues an expand job and returns the cached subgraph immediately', async () => {
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 5, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' } });
    const res = mockRes();
    await h.expand(req, res);

    expect(deps.expandQueue!.add).toHaveBeenCalledWith('constellation-expand', { artistId: 5 });
    expect(deps.graph!.subgraph).toHaveBeenCalledWith(5, { userId: 7 });
    expect(res.statusCode).toBe(200);
    expect(res.body.enqueued).toBe(true);
    expect(res.body.subgraph).toBeDefined();
  });

  it('still returns the cached subgraph when the enqueue fails (guarded, no Redis)', async () => {
    const deps = makeDeps({ expandQueue: { add: vi.fn().mockRejectedValue(new Error('no redis')) } });
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 5, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' } });
    const res = mockRes();
    await h.expand(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.enqueued).toBe(false);
    expect(res.body.subgraph).toBeDefined();
  });
});

// ---- /path ------------------------------------------------------------------

describe('GET /path', () => {
  it('returns a PathResult', async () => {
    const result = { nodes: [1, 2, 3], degrees: 2, mode: 'shortest' };
    const deps = makeDeps();
    (deps.graph!.path as any).mockResolvedValue(result);
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { from: '1', to: '3', mode: 'shortest' } });
    const res = mockRes();
    await h.path(req, res);

    // Unspecified max falls back to the default degree bound (6).
    expect(deps.graph!.path).toHaveBeenCalledWith(1, 3, { mode: 'shortest', max: 6 });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(result);
  });

  it('clamps an excessive max to the degree ceiling (10)', async () => {
    const deps = makeDeps();
    (deps.graph!.path as any).mockResolvedValue({ nodes: [1, 2], degrees: 1, mode: 'shortest' });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { from: '1', to: '2', max: '999' } });
    const res = mockRes();
    await h.path(req, res);

    expect(deps.graph!.path).toHaveBeenCalledWith(1, 2, { mode: 'shortest', max: 10 });
  });

  it('404s when no path is found', async () => {
    const deps = makeDeps();
    (deps.graph!.path as any).mockResolvedValue(null);
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { from: '1', to: '3', max: '4' } });
    const res = mockRes();
    await h.path(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/no path/i);
  });
});

// ---- /person/:id/releases ---------------------------------------------------

describe('GET /person/:personId/releases', () => {
  it('returns the discography for the side panel', async () => {
    const releases = [{ releaseId: 1, title: 'Album', year: 2001, master: 10 }];
    const deps = makeDeps();
    (deps.getArtistReleases as any).mockResolvedValue(releases);
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' } });
    const res = mockRes();
    await h.releases(req, res);

    expect(deps.getArtistReleases).toHaveBeenCalledWith(5);
    expect(res.statusCode).toBe(200);
    expect(res.body.releases).toEqual(releases);
  });
});

// ---- /owned -----------------------------------------------------------------

describe('GET /owned', () => {
  it("returns the user's owned person-id array", async () => {
    vi.mocked(prisma.constellationOwned.findMany).mockResolvedValue([
      { personId: 3 },
      { personId: 7 },
      { personId: 3 },
    ] as any);
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);

    const req = mockReq();
    const res = mockRes();
    await h.owned(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.owned).toEqual([3, 7]); // distinct
  });
});

// ---- /stream/:token (SSE) ---------------------------------------------------

describe('GET /stream/:token (SSE)', () => {
  it('sets SSE headers, forwards published events with generation, and cleans up on close', async () => {
    const streams = new StreamRegistry();
    const deps = makeDeps({ streams });
    const h = buildConstellationHandlers(deps);

    const token = 'tok-123';
    const req = mockReq({ params: { token } });
    const res = mockRes();
    await h.stream(req, res);

    // SSE headers
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Connection']).toBe('keep-alive');

    // a subscriber is registered
    expect(streams.listenerCount(token)).toBe(1);

    // publishing forwards a data event carrying the generation
    streams.publish(token, 4, { personId: 88 });
    const dataFrame = res.writes.find((w: string) => w.startsWith('data:'));
    expect(dataFrame).toBeDefined();
    const payload = JSON.parse(dataFrame!.replace(/^data: /, '').trim());
    expect(payload.generation).toBe(4);
    expect(payload.personId).toBe(88);

    // close -> cleanup, no dangling listener
    req.emitClose();
    expect(streams.listenerCount(token)).toBe(0);
  });
});

// ---- invalid params (400) ---------------------------------------------------

describe('invalid params', () => {
  it('400s on non-numeric personId for /expand', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ params: { personId: 'abc' } });
    const res = mockRes();
    await h.expand(req, res);
    expect(res.statusCode).toBe(400);
    expect(deps.expandQueue!.add).not.toHaveBeenCalled();
  });

  it('400s on non-numeric personId for /releases', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ params: { personId: 'abc' } });
    const res = mockRes();
    await h.releases(req, res);
    expect(res.statusCode).toBe(400);
    expect(deps.getArtistReleases).not.toHaveBeenCalled();
  });

  it('400s when from or to is missing on /path', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ query: { from: '1' } }); // no `to`
    const res = mockRes();
    await h.path(req, res);
    expect(res.statusCode).toBe(400);
    expect(deps.graph!.path).not.toHaveBeenCalled();
  });

  it('400s on an invalid mode on /path', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ query: { from: '1', to: '2', mode: 'sideways' } });
    const res = mockRes();
    await h.path(req, res);
    expect(res.statusCode).toBe(400);
    expect(deps.graph!.path).not.toHaveBeenCalled();
  });
});

// ---- token threading through /expand ---------------------------------------

describe('GET /expand with a stream token', () => {
  it('threads tokenId + generation into the enqueued job payload', async () => {
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 5, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, query: { token: 'tok-9', generation: '3' } });
    const res = mockRes();
    await h.expand(req, res);

    expect(deps.expandQueue!.add).toHaveBeenCalledWith('constellation-expand', {
      artistId: 5,
      tokenId: 'tok-9',
      generation: 3,
    });
  });
});

// ---- token user-scoping (IDOR) ----------------------------------------------

describe('stream token user-scoping', () => {
  it('403s when user B opens a stream for a token minted by user A', async () => {
    const streams = new StreamRegistry();
    const deps = makeDeps({ streams });
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 1, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    // User A (id 7, the mockReq default) seeds and mints a token.
    const seedReq = mockReq({ query: { id: '1' } });
    const seedRes = mockRes();
    await h.seed(seedReq, seedRes);
    const tokenA = seedRes.body.streamToken.id as string;

    // User B (id 99) tries to open that stream.
    const streamReq = mockReq({ user: { id: 99 }, params: { token: tokenA } });
    const streamRes = mockRes();
    await h.stream(streamReq, streamRes);

    expect(streamRes.statusCode).toBe(403);
    expect(streams.listenerCount(tokenA)).toBe(0); // never attached
  });

  it("403s when user B re-centers (/seed?token=) with user A's token", async () => {
    const streams = new StreamRegistry();
    const deps = makeDeps({ streams });
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 1, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const seedReq = mockReq({ query: { id: '1' } }); // user A (id 7)
    const seedRes = mockRes();
    await h.seed(seedReq, seedRes);
    const tokenA = seedRes.body.streamToken.id as string;

    const bumpReq = mockReq({ user: { id: 99 }, query: { id: '2', token: tokenA } });
    const bumpRes = mockRes();
    await h.seed(bumpReq, bumpRes);

    expect(bumpRes.statusCode).toBe(403);
    // user A's token generation is untouched
    expect(streams.currentGeneration(tokenA)).toBe(1);
  });
});

// ---- auth -------------------------------------------------------------------

describe('auth', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const deps = makeDeps();
    const router = createConstellationRouter(deps);
    const app = express();
    // Simulate passport's isAuthenticated() returning false.
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => false;
      next();
    });
    app.use('/api/constellation', router);

    const resp = await request(app).get('/api/constellation/owned');
    expect(resp.status).toBe(401);
  });
});
