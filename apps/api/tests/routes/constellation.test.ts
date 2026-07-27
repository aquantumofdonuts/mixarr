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

// subscribeToLidarrDefault resolves the user's Lidarr connection through this
// helper; mock it so the unit tests supply a fake LidarrService.
vi.mock('../../src/lib/connection-resolver.js', () => ({
  getLidarrServiceWithConfig: vi.fn(),
}));

import prisma from '../../src/lib/db.js';
import { getLidarrServiceWithConfig } from '../../src/lib/connection-resolver.js';
import {
  buildConstellationHandlers,
  createConstellationRouter,
  StreamRegistry,
  LidarrNotConfiguredError,
  AlbumNotFoundError,
  subscribeToLidarrDefault,
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
      discogsToMbid: vi.fn(),
    } as any,
    expandQueue: { add: vi.fn().mockResolvedValue(undefined) },
    getArtistReleases: vi.fn(),
    streams: new StreamRegistry(),
    subscribeToLidarr: vi.fn().mockResolvedValue({ added: true, target: 'artist' }),
    searchTrackPreview: vi.fn().mockResolvedValue(null),
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

  it('threads a roleMask query param into subgraph (server-side role filter)', async () => {
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 42, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { type: 'artist', id: '42', roleMask: '6' } });
    const res = mockRes();
    await h.seed(req, res);

    expect(deps.graph!.subgraph).toHaveBeenCalledWith(42, { userId: 7, roleMask: 6 });
    expect(res.statusCode).toBe(200);
  });

  it('passes roleMask=undefined (no filter) when the param is absent', async () => {
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 42, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { type: 'artist', id: '42' } });
    const res = mockRes();
    await h.seed(req, res);

    const call = (deps.graph!.subgraph as any).mock.calls[0];
    expect(call[0]).toBe(42);
    expect(call[1].userId).toBe(7);
    expect(call[1].roleMask).toBeUndefined();
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

  it('threads a roleMask query param into the expand subgraph (server-side role filter)', async () => {
    const deps = makeDeps();
    (deps.graph!.subgraph as any).mockResolvedValue({ focusId: 5, nodes: [], edges: [] });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, query: { roleMask: '3' } });
    const res = mockRes();
    await h.expand(req, res);

    expect(deps.graph!.subgraph).toHaveBeenCalledWith(5, { userId: 7, roleMask: 3 });
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

// ---- POST /person/:id/subscribe ---------------------------------------------

describe('POST /person/:personId/subscribe', () => {
  it('409s with needsManual when the person is not linked to MusicBrainz', async () => {
    const deps = makeDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({
      mbid: null,
      confidence: null,
      needsManual: true,
    });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, body: {} });
    const res = mockRes();
    await h.subscribe(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.needsManual).toBe(true);
    expect(res.body.message).toMatch(/musicbrainz/i);
    // Honest dead-end: no Lidarr add is attempted.
    expect(deps.subscribeToLidarr).not.toHaveBeenCalled();
  });

  it('resolves the MBID and adds the artist to Lidarr (200)', async () => {
    const deps = makeDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({
      mbid: 'mbid-abc',
      confidence: 'linked',
      needsManual: false,
    });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, body: { name: 'Nine Inch Nails' } });
    const res = mockRes();
    await h.subscribe(req, res);

    expect(deps.identity!.discogsToMbid).toHaveBeenCalledWith(5, 'Nine Inch Nails');
    expect(deps.subscribeToLidarr).toHaveBeenCalledWith({
      userId: 7,
      mbid: 'mbid-abc',
      releaseTitle: undefined,
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ added: true, mbid: 'mbid-abc' });
  });

  it('threads a releaseTitle through for the album grain', async () => {
    const deps = makeDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({
      mbid: 'mbid-abc',
      confidence: 'linked',
      needsManual: false,
    });
    (deps.subscribeToLidarr as any).mockResolvedValue({ added: true, target: 'album' });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, body: { releaseTitle: 'The Downward Spiral' } });
    const res = mockRes();
    await h.subscribe(req, res);

    expect(deps.subscribeToLidarr).toHaveBeenCalledWith({
      userId: 7,
      mbid: 'mbid-abc',
      releaseTitle: 'The Downward Spiral',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.target).toBe('album');
  });

  it('returns a clean 502 (not a crash) when the Lidarr add fails', async () => {
    const deps = makeDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({
      mbid: 'mbid-abc',
      confidence: 'linked',
      needsManual: false,
    });
    (deps.subscribeToLidarr as any).mockRejectedValue(new Error('Lidarr timed out'));
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, body: {} });
    const res = mockRes();
    await h.subscribe(req, res);

    expect(res.statusCode).toBe(502);
    expect(res.body.error).toMatch(/lidarr/i);
  });

  it('400s (not 502) when Lidarr is not configured', async () => {
    const deps = makeDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({
      mbid: 'mbid-abc',
      confidence: 'linked',
      needsManual: false,
    });
    (deps.subscribeToLidarr as any).mockRejectedValue(
      new LidarrNotConfiguredError('No active Lidarr connection'),
    );
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ params: { personId: '5' }, body: {} });
    const res = mockRes();
    await h.subscribe(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/lidarr/i);
  });

  it('400s on a non-numeric personId', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);
    const req = mockReq({ params: { personId: 'abc' }, body: {} });
    const res = mockRes();
    await h.subscribe(req, res);
    expect(res.statusCode).toBe(400);
    expect(deps.identity!.discogsToMbid).not.toHaveBeenCalled();
  });
});

// ---- subscribeToLidarrDefault (real add path, mocked LidarrService) ----------

describe('subscribeToLidarrDefault', () => {
  function fakeLidarr() {
    return {
      getQualityProfiles: vi.fn().mockResolvedValue([]),
      getMetadataProfiles: vi.fn().mockResolvedValue([]),
      getRootFolders: vi.fn().mockResolvedValue([]),
      searchAlbum: vi.fn().mockResolvedValue([]),
      addAlbumWithCacheWarm: vi.fn().mockResolvedValue({}),
      addArtistWithCacheWarm: vi.fn().mockResolvedValue({}),
    };
  }

  it('adds the exact-title album belonging to the resolved artist', async () => {
    const lidarr = fakeLidarr();
    lidarr.searchAlbum.mockResolvedValue([
      // A same-titled album by a DIFFERENT artist must be ignored.
      { foreignAlbumId: 'wrong-album', title: 'Greatest Hits', artist: { foreignArtistId: 'other-mbid' } },
      { foreignAlbumId: 'right-album', title: 'Greatest Hits', artist: { foreignArtistId: 'artist-mbid' } },
    ]);
    (getLidarrServiceWithConfig as any).mockResolvedValue({
      service: lidarr,
      config: { qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music' },
    });

    const outcome = await subscribeToLidarrDefault({
      userId: 7,
      mbid: 'artist-mbid',
      releaseTitle: 'Greatest Hits',
    });

    expect(outcome).toEqual({ added: true, target: 'album' });
    expect(lidarr.addAlbumWithCacheWarm).toHaveBeenCalledWith(
      'artist-mbid',
      'right-album',
      1,
      2,
      '/music',
    );
  });

  it('fails cleanly (no wrong-artist add) when no album under the artist matches', async () => {
    const lidarr = fakeLidarr();
    // Only a same-titled album by a DIFFERENT artist exists.
    lidarr.searchAlbum.mockResolvedValue([
      { foreignAlbumId: 'wrong-album', title: 'Greatest Hits', artist: { foreignArtistId: 'other-mbid' } },
    ]);
    (getLidarrServiceWithConfig as any).mockResolvedValue({
      service: lidarr,
      config: { qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music' },
    });

    await expect(
      subscribeToLidarrDefault({ userId: 7, mbid: 'artist-mbid', releaseTitle: 'Greatest Hits' }),
    ).rejects.toBeInstanceOf(AlbumNotFoundError);
    expect(lidarr.addAlbumWithCacheWarm).not.toHaveBeenCalled();
  });

  it('falls back to the first available profile/metadata/root-folder when config omits them', async () => {
    const lidarr = fakeLidarr();
    lidarr.getQualityProfiles.mockResolvedValue([{ id: 11 }]);
    lidarr.getMetadataProfiles.mockResolvedValue([{ id: 22 }]);
    lidarr.getRootFolders.mockResolvedValue([{ path: '/fallback' }]);
    (getLidarrServiceWithConfig as any).mockResolvedValue({
      service: lidarr,
      config: {}, // no profile ids / root folder configured
    });

    const outcome = await subscribeToLidarrDefault({ userId: 7, mbid: 'artist-mbid' });

    expect(outcome).toEqual({ added: true, target: 'artist' });
    expect(lidarr.addArtistWithCacheWarm).toHaveBeenCalledWith(
      'artist-mbid',
      11,
      22,
      '/fallback',
      true,
      expect.any(Boolean),
      false,
      expect.any(String),
      expect.any(String),
    );
  });

  it('throws LidarrNotConfiguredError when the user has no Lidarr connection', async () => {
    (getLidarrServiceWithConfig as any).mockResolvedValue(null);
    await expect(
      subscribeToLidarrDefault({ userId: 7, mbid: 'artist-mbid' }),
    ).rejects.toBeInstanceOf(LidarrNotConfiguredError);
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

// ---- /play (playback resolution) --------------------------------------------

describe('GET /play', () => {
  it('returns source=deezer with the preview + cover when Deezer has a preview', async () => {
    const deps = makeDeps({
      searchTrackPreview: vi.fn().mockResolvedValue({
        previewUrl: 'https://cdn.deezer.com/preview.mp3',
        title: 'Closer',
        artist: 'Nine Inch Nails',
        coverUrl: 'https://cdn.deezer.com/cover_big.jpg',
      }),
    });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { artist: 'Nine Inch Nails', track: 'Closer' } });
    const res = mockRes();
    await h.play(req, res);

    expect(deps.searchTrackPreview).toHaveBeenCalledWith('Nine Inch Nails', 'Closer');
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      source: 'deezer',
      previewUrl: 'https://cdn.deezer.com/preview.mp3',
      title: 'Closer',
      artist: 'Nine Inch Nails',
      coverUrl: 'https://cdn.deezer.com/cover_big.jpg',
    });
  });

  it('falls through to source=youtube with a correct search URL when there is no preview', async () => {
    const deps = makeDeps({ searchTrackPreview: vi.fn().mockResolvedValue(null) });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { artist: 'Some Session Player', track: 'Deep Cut' } });
    const res = mockRes();
    await h.play(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('youtube');
    expect(res.body.youtubeUrl).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent('Some Session Player Deep Cut')}`,
    );
    // A link-out, never an embed / Data API.
    expect(res.body.youtubeUrl).toContain('youtube.com/results?search_query=');
  });

  it('degrades to youtube (never 500s) when the Deezer search throws', async () => {
    const deps = makeDeps({
      searchTrackPreview: vi.fn().mockRejectedValue(new Error('Deezer API error: 503')),
    });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { artist: 'Radiohead' } });
    const res = mockRes();
    await h.play(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('youtube');
    // No track -> no trailing separator in the query.
    expect(res.body.youtubeUrl).toBe(
      `https://www.youtube.com/results?search_query=${encodeURIComponent('Radiohead')}`,
    );
  });

  it('passes the owned flag through as an owned:true hint (badge, not a stream)', async () => {
    const deps = makeDeps({ searchTrackPreview: vi.fn().mockResolvedValue(null) });
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: { artist: 'Aphex Twin', owned: 'true' } });
    const res = mockRes();
    await h.play(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.owned).toBe(true);
  });

  it('400s when the artist is missing', async () => {
    const deps = makeDeps();
    const h = buildConstellationHandlers(deps);

    const req = mockReq({ query: {} });
    const res = mockRes();
    await h.play(req, res);

    expect(res.statusCode).toBe(400);
    expect(deps.searchTrackPreview).not.toHaveBeenCalled();
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
