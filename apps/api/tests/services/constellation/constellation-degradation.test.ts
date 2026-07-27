/**
 * DEGRADATION MATRIX — Collaboration Constellation graceful-degradation (Design §9).
 *
 * §9 promises the constellation DEGRADES (reduced data / a browsable-but-thinner
 * graph) rather than CRASHES when any single upstream dependency is unavailable.
 * This suite asserts one focused scenario per §9 row over the SAME in-memory
 * Prisma store the e2e test uses (real ExpansionService/GraphService/Identity-
 * Service compose; only the failing dependency is faked):
 *
 *   Row 1  Discogs dump not imported (index ON, empty)  -> getArtistReleases []
 *          => crawl no-ops, subgraph = just the focus node. (UI "warming".)
 *   Row 2  Discogs API down (credit source throws)      -> per-release AND
 *          per-expand resilience: the failing release/person is skipped, the
 *          reachable rest still materializes. Partial graph, no crash.
 *   Row 3  MusicBrainz down                             -> discogsToMbid needsManual,
 *          mbidToDiscogs null, buildOwnedSet skips unresolved. No throw.
 *   Row 4  Plex/Jellyfin/Lidarr absent                  -> owned set empty
 *          (nodes owned:false); /subscribe 400/409 (browsable, not a 500);
 *          /play still resolves to a YouTube link-out.
 *   Row 5  Last.fm down (popularity seam throws/absent) -> node size falls back
 *          to credit prominence. No crash.
 *   Row 6  Rate-limit contention                        -> the orbit crawl is
 *          enqueued at LOW priority (design-level; the one unit-testable bit).
 *
 * TWO SOURCE HARDENINGS were required for the promise to actually hold and are
 * covered here (see the row bodies):
 *   - Row 5: GraphService.subgraph now guards each `getPopularity` call, so a
 *     THROWING Last.fm seam degrades that node to credit prominence instead of
 *     rejecting the whole subgraph. (Previously `Promise.all(map(getPopularity))`
 *     would have propagated the rejection and crashed the subgraph.)
 *   - Row 2: ExpansionService.expandPerson now guards `getArtistReleases`, so a
 *     Discogs outage for ONE person skips that expansion cleanly (mirroring the
 *     pre-existing per-release `getReleaseCredits` guard) rather than aborting the
 *     surrounding orbit crawl.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.js is mocked to a bare object; beforeEach assigns a fresh in-memory store's
// delegates onto it (mirrors the e2e test). Both default and named exports point
// at the same object, so every constellation service resolves to the one store.
vi.mock('../../../src/lib/db.js', () => {
  const shared = {};
  return { default: shared, prisma: shared };
});

// Silence service loggers (the degradation paths intentionally log warn/debug).
vi.mock('../../../src/lib/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Queue module is mocked so importing the route module + orbit worker opens no
// Redis. Row 6 asserts on constellationCrawlQueue.add's priority option.
vi.mock('../../../src/jobs/constellation/queue.js', () => ({
  constellationCrawlQueue: { add: vi.fn().mockResolvedValue(undefined) },
  constellationExpandQueue: { add: vi.fn().mockResolvedValue(undefined) },
  CONSTELLATION_QUEUE_NAMES: {
    IMPORT: 'constellation-import',
    CRAWL: 'constellation-crawl',
    EXPAND: 'constellation-expand',
  },
}));

// subscribeToLidarrDefault resolves the user's Lidarr connection through this
// helper; mocked so the route module imports without a live connection layer.
vi.mock('../../../src/lib/connection-resolver.js', () => ({
  getLidarrServiceWithConfig: vi.fn(),
}));

import prisma from '../../../src/lib/db.js';
import { makeInMemoryConstellationPrisma, type InMemoryConstellationPrisma } from './constellation-store.js';
import { DumpIndexService } from '../../../src/services/constellation/DumpIndexService.js';
import { ExpansionService, type CreditSource } from '../../../src/services/constellation/ExpansionService.js';
import { OrbitCrawler, type OrbitDeps } from '../../../src/services/constellation/OrbitCrawler.js';
import { GraphService } from '../../../src/services/constellation/GraphService.js';
import { IdentityService, type OwnedSourceProvider } from '../../../src/services/constellation/IdentityService.js';
import { normalizeRole, type BaseRole } from '../../../src/services/constellation/RoleTaxonomy.js';
import {
  buildConstellationHandlers,
  LidarrNotConfiguredError,
  StreamRegistry,
  type ConstellationDeps,
} from '../../../src/routes/constellation.js';
import { enqueueOrbitCrawl } from '../../../src/jobs/constellation/orbit-crawl-worker.js';
import { constellationCrawlQueue } from '../../../src/jobs/constellation/queue.js';
import type { MusicBrainzService } from '../../../src/services/musicbrainz.js';

// ---------------------------------------------------------------------------
// Tiny synthetic collaboration graph (A—B via rel 10, A—C via rel 11).
// ---------------------------------------------------------------------------
const A = 1, B = 2, C = 3;
const NAMES: Record<number, string> = { [A]: 'A', [B]: 'B', [C]: 'C' };
const NOW_YEAR = 2021;

interface ReleaseSpec {
  releaseId: number;
  masterId: number | null;
  year: number | null;
  genres: string[];
  credits: Array<{ artistId: number; role: string }>;
}

const RELEASES: ReleaseSpec[] = [
  { releaseId: 10, masterId: 1000, year: 2020, genres: ['Jazz'],
    credits: [{ artistId: A, role: 'Bass' }, { artistId: B, role: 'Guitar' }] },
  { releaseId: 11, masterId: 1001, year: 2019, genres: ['Jazz'],
    credits: [{ artistId: A, role: 'Bass' }, { artistId: C, role: 'Drums' }] },
];

interface SourceFailOpts {
  /** releaseIds whose getReleaseCredits should throw (Discogs API down per-release). */
  failCreditsFor?: Set<number>;
  /** artistIds whose getArtistReleases should throw (Discogs API down per-person). */
  failReleasesFor?: Set<number>;
}

/** A live-shaped CreditSource over RELEASES with injectable per-call failures. */
function makeSource(opts: SourceFailOpts = {}): CreditSource {
  const failCredits = opts.failCreditsFor ?? new Set<number>();
  const failReleases = opts.failReleasesFor ?? new Set<number>();
  return {
    async getArtistReleases(artistId) {
      if (failReleases.has(artistId)) {
        throw new Error(`Discogs API down: getArtistReleases(${artistId})`);
      }
      return RELEASES.filter((r) => r.credits.some((c) => c.artistId === artistId)).map((r) => ({
        releaseId: r.releaseId,
        masterId: r.masterId,
        year: r.year,
        genres: [],
      }));
    },
    async getReleaseCredits(releaseId) {
      if (failCredits.has(releaseId)) {
        throw new Error(`Discogs API down: getReleaseCredits(${releaseId})`);
      }
      const rel = RELEASES.find((r) => r.releaseId === releaseId);
      if (!rel) return [];
      const byArtist = new Map<number, { name: string; roles: Set<BaseRole> }>();
      for (const c of rel.credits) {
        let entry = byArtist.get(c.artistId);
        if (!entry) byArtist.set(c.artistId, (entry = { name: NAMES[c.artistId] ?? '', roles: new Set() }));
        for (const role of normalizeRole(c.role)) entry.roles.add(role);
      }
      return [...byArtist.entries()].map(([artistId, { name, roles }]) => ({
        artistId,
        name,
        roles: [...roles],
        masterId: rel.masterId,
      }));
    },
  };
}

/** Production-style OrbitCrawler adapter over the real ExpansionService + store. */
function makeOrbitDeps(expansion: ExpansionService): OrbitDeps {
  return {
    async expand(personId) {
      await expansion.expandPerson(personId);
      const edges = await prisma.constellationEdge.findMany({ where: { sourcePersonId: personId } });
      return { neighborIds: edges.map((e: any) => e.targetPersonId), edgesCreated: edges.length };
    },
    async isFull(personId) {
      const p = await prisma.constellationPerson.findUnique({ where: { personId } });
      return p?.fullyExpanded ?? false;
    },
  };
}

// ---- route-handler test doubles (mirrors tests/routes/constellation.test.ts) ---
function mockRes(): any {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: unknown) { this.body = obj; return this; },
    setHeader() {},
    flushHeaders() {},
    write() { return true; },
    end() { return this; },
  };
}
function mockReq(overrides: Record<string, unknown> = {}): any {
  return { user: { id: USER }, query: {}, params: {}, body: {}, on() {}, ...overrides };
}
function makeHandlerDeps(overrides: Partial<ConstellationDeps> = {}): ConstellationDeps {
  return {
    graph: { subgraph: vi.fn(), path: vi.fn() } as any,
    identity: { mbidToDiscogs: vi.fn(), discogsToMbid: vi.fn() } as any,
    expandQueue: { add: vi.fn().mockResolvedValue(undefined) },
    getArtistReleases: vi.fn(),
    streams: new StreamRegistry(),
    subscribeToLidarr: vi.fn().mockResolvedValue({ added: true, target: 'artist' }),
    searchTrackPreview: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

const USER = 42;

let mem: InMemoryConstellationPrisma;
beforeEach(() => {
  vi.clearAllMocks();
  // Fresh isolated store per test.
  mem = makeInMemoryConstellationPrisma();
  Object.assign(prisma as object, mem);
});

// ===========================================================================
// Row 1 — Discogs dump not yet imported (index ON, empty index).
// ===========================================================================
describe('§9 Row 1 — Discogs dump not yet imported (empty index)', () => {
  it('empty DumpIndexService: getArtistReleases []; crawl no-ops; subgraph is just the focus node; no crash', async () => {
    const idx = new DumpIndexService(':memory:'); // ON mode — NOTHING imported.
    try {
      // The empty index returns [] for every artist (warming state).
      expect(await idx.getArtistReleases(A)).toEqual([]);

      const expansion = new ExpansionService(idx, { nowYear: NOW_YEAR });
      const crawler = new OrbitCrawler(makeOrbitDeps(expansion));

      // Crawling over the empty index must not throw and must materialize nothing.
      const result = await crawler.crawl([A], { maxEdges: 100 });
      expect(result.edgesMaterialized).toBe(0);
      expect(await prisma.constellationEdge.findMany({ where: { sourcePersonId: A } })).toEqual([]);

      // subgraph on the unexpanded seed => just the focus node, no edges, no crash.
      const sg = await new GraphService().subgraph(A, {});
      expect(sg.focusId).toBe(A);
      expect(sg.nodes.map((n) => n.personId)).toEqual([A]);
      expect(sg.edges).toEqual([]);
    } finally {
      idx.close();
    }
  });
});

// ===========================================================================
// Row 2 — Discogs API down (credit source throws).
// ===========================================================================
describe('§9 Row 2 — Discogs API down (expand source throws)', () => {
  it('per-release resilience: getReleaseCredits throwing for ONE release skips it, materializes the rest', async () => {
    // rel 11 (A—C) is down; rel 10 (A—B) is fine.
    const expansion = new ExpansionService(makeSource({ failCreditsFor: new Set([11]) }), { nowYear: NOW_YEAR });

    await expect(expansion.expandPerson(A)).resolves.toBeUndefined(); // no throw

    const targets = new Set(
      (await prisma.constellationEdge.findMany({ where: { sourcePersonId: A } })).map((e: any) => e.targetPersonId),
    );
    expect(targets.has(B)).toBe(true); // reachable collaborator materialized
    expect(targets.has(C)).toBe(false); // the failing release's collaborator is skipped
    // A single bad release does not deny A its fully-expanded flag.
    expect((await prisma.constellationPerson.findUnique({ where: { personId: A } }))?.fullyExpanded).toBe(true);
  });

  it('per-expand resilience: getArtistReleases throwing for ONE person mid-crawl is skipped; reachable rest materializes', async () => {
    // Discogs is down for B only. Crawl from A: expand A (edges to B,C), skip B, expand C.
    const expansion = new ExpansionService(makeSource({ failReleasesFor: new Set([B]) }), { nowYear: NOW_YEAR });
    const crawler = new OrbitCrawler(makeOrbitDeps(expansion));

    const result = await crawler.crawl([A], { maxEdges: 100, maxDepth: 2 }); // must not throw
    expect(result.personsExpanded).toBeGreaterThan(0);

    // A materialized its edges (already-materialized graph is served).
    expect((await prisma.constellationEdge.findMany({ where: { sourcePersonId: A } })).length).toBeGreaterThan(0);

    // A and C fully expanded; B was skipped (getArtistReleases threw) so never marked full.
    expect((await prisma.constellationPerson.findUnique({ where: { personId: A } }))?.fullyExpanded).toBe(true);
    expect((await prisma.constellationPerson.findUnique({ where: { personId: C } }))?.fullyExpanded).toBe(true);
    expect((await prisma.constellationPerson.findUnique({ where: { personId: B } }))?.fullyExpanded).toBe(false);

    // The graph is still coherent and browsable (partial, not crashed).
    const sg = await new GraphService().subgraph(A, {});
    expect(sg.nodes.some((n) => n.personId === B)).toBe(true); // B present as a materialized edge target
    expect(sg.nodes.length).toBeGreaterThan(1);
    for (const e of sg.edges) {
      const ids = new Set(sg.nodes.map((n) => n.personId));
      expect(ids.has(e.source)).toBe(true);
      expect(ids.has(e.target)).toBe(true);
    }
  });
});

// ===========================================================================
// Row 3 — MusicBrainz down.
// ===========================================================================
describe('§9 Row 3 — MusicBrainz down', () => {
  // Faithful "MB down" seam: the real MusicBrainzService catches network errors
  // in lookupArtistMbidByUrl / lookupArtistDiscogsId and returns null; searchArtist
  // propagates (and discogsToMbid catches it). We reproduce exactly that shape.
  const mbDown = () =>
    ({
      lookupArtistMbidByUrl: vi.fn(async () => null),
      lookupArtistDiscogsId: vi.fn(async () => null),
      searchArtist: vi.fn(async () => {
        throw new Error('MusicBrainz 503');
      }),
      getArtistReleases: vi.fn(async () => ({ releaseGroups: [] })),
    }) as unknown as MusicBrainzService;

  it('discogsToMbid -> needsManual (no throw)', async () => {
    const identity = new IdentityService({ mb: mbDown() });
    const res = await identity.discogsToMbid(A, 'A');
    expect(res.needsManual).toBe(true);
    expect(res.mbid).toBeNull();
  });

  it('mbidToDiscogs -> null (no throw)', async () => {
    const identity = new IdentityService({ mb: mbDown() });
    await expect(identity.mbidToDiscogs('11111111-1111-1111-1111-111111111111')).resolves.toBeNull();
  });

  it('buildOwnedSet completes with unresolved MBIDs skipped (no throw)', async () => {
    const identity = new IdentityService({ mb: mbDown() });
    const lidarr: OwnedSourceProvider = {
      source: 'lidarr',
      getArtistMbids: async () => ['mbid-1', 'mbid-2'],
    };
    const r = await identity.buildOwnedSet(USER, [lidarr]);
    expect(r.owned).toBe(0);
    expect(r.skipped).toBe(2); // both MBIDs unresolved -> skipped, not thrown
    expect(r.sourcesFailed).toBe(0); // the source itself answered; MB just can't resolve
  });
});

// ===========================================================================
// Row 4 — Plex/Jellyfin/Lidarr absent.
// ===========================================================================
describe('§9 Row 4 — Plex/Jellyfin/Lidarr absent', () => {
  const anyMb = () =>
    ({
      lookupArtistMbidByUrl: vi.fn(async () => null),
      lookupArtistDiscogsId: vi.fn(async () => null),
      searchArtist: vi.fn(async () => []),
      getArtistReleases: vi.fn(async () => ({ releaseGroups: [] })),
    }) as unknown as MusicBrainzService;

  it('empty library source -> owned set empty -> subgraph nodes owned:false', async () => {
    await new ExpansionService(makeSource(), { nowYear: NOW_YEAR }).expandPerson(A); // materialize a graph

    const emptyLidarr: OwnedSourceProvider = { source: 'lidarr', getArtistMbids: async () => [] };
    const r = await new IdentityService({ mb: anyMb() }).buildOwnedSet(USER, [emptyLidarr]);
    expect(r.owned).toBe(0);

    const sg = await new GraphService().subgraph(A, { userId: USER });
    expect(sg.nodes.length).toBeGreaterThan(0);
    expect(sg.nodes.every((n) => n.owned === false)).toBe(true); // browsable, nothing owned
  });

  it('library source that THROWS -> sourcesFailed counted, owned empty, no throw', async () => {
    const deadLidarr: OwnedSourceProvider = {
      source: 'lidarr',
      getArtistMbids: async () => {
        throw new Error('Lidarr unreachable');
      },
    };
    const r = await new IdentityService({ mb: anyMb() }).buildOwnedSet(USER, [deadLidarr]);
    expect(r.sourcesFailed).toBe(1);
    expect(r.owned).toBe(0);
  });

  it('/subscribe -> 400 (not a 500 crash) when Lidarr is not configured; the node stays browsable', async () => {
    const deps = makeHandlerDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({ mbid: 'mbid-abc', confidence: 'linked', needsManual: false });
    (deps.subscribeToLidarr as any).mockRejectedValue(new LidarrNotConfiguredError('No active Lidarr connection'));
    const h = buildConstellationHandlers(deps);

    const res = mockRes();
    await h.subscribe(mockReq({ params: { personId: '5' }, body: {} }), res);

    expect(res.statusCode).toBe(400); // configuration problem, mapped cleanly — not a 500
    expect(res.body.error).toMatch(/lidarr/i);
  });

  it('/subscribe -> 409 needsManual when the person is not linked to MusicBrainz (browsable dead-end)', async () => {
    const deps = makeHandlerDeps();
    (deps.identity!.discogsToMbid as any).mockResolvedValue({ mbid: null, confidence: null, needsManual: true });
    const h = buildConstellationHandlers(deps);

    const res = mockRes();
    await h.subscribe(mockReq({ params: { personId: '5' }, body: {} }), res);

    expect(res.statusCode).toBe(409);
    expect(res.body.needsManual).toBe(true);
    expect(deps.subscribeToLidarr).not.toHaveBeenCalled(); // honest dead-end, no add attempted
  });

  it('/play still resolves to a YouTube link-out (never a dead button) with no library/Deezer', async () => {
    const deps = makeHandlerDeps({ searchTrackPreview: vi.fn().mockResolvedValue(null) });
    const h = buildConstellationHandlers(deps);

    const res = mockRes();
    await h.play(mockReq({ query: { artist: 'A' } }), res);

    expect(res.statusCode).toBe(200);
    expect(res.body.source).toBe('youtube');
    expect(res.body.youtubeUrl).toMatch(/youtube\.com/);
  });
});

// ===========================================================================
// Row 5 — Last.fm down (popularity seam throws / absent).
// ===========================================================================
describe('§9 Row 5 — Last.fm down (popularity seam)', () => {
  it('a THROWING getPopularity seam degrades to credit prominence; subgraph does not crash', async () => {
    await new ExpansionService(makeSource(), { nowYear: NOW_YEAR }).expandPerson(A);

    const throwingPopularity = vi.fn(async () => {
      throw new Error('Last.fm 500');
    });
    const sg = await new GraphService({ getPopularity: throwingPopularity }).subgraph(A, {}); // must not throw
    expect(throwingPopularity).toHaveBeenCalled();

    const nodeA = sg.nodes.find((n) => n.personId === A)!;
    expect(nodeA.size).toBeGreaterThan(0); // fell back to credit prominence (sum of outgoing weights)

    // Identical to the no-seam baseline — the Last.fm outage changes nothing else.
    const baseline = await new GraphService().subgraph(A, {});
    expect(nodeA.size).toBe(baseline.nodes.find((n) => n.personId === A)!.size);
  });

  it('an ABSENT popularity seam is fine too (size = credit prominence)', async () => {
    await new ExpansionService(makeSource(), { nowYear: NOW_YEAR }).expandPerson(A);
    const sg = await new GraphService().subgraph(A, {}); // no seam injected
    expect(sg.nodes.find((n) => n.personId === A)!.size).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Row 6 — Rate-limit contention (design-level; the enqueue-priority is the
// one unit-testable invariant).
// ===========================================================================
describe('§9 Row 6 — Rate-limit contention', () => {
  // Live rate-limit contention between the background crawl and interactive
  // expansions is a runtime/queue-scheduling property, not a pure-unit behavior.
  // The one asserted invariant that makes graceful degradation hold under
  // contention: the perpetual orbit crawl is enqueued at LOW priority (100), so
  // BullMQ serves interactive on-demand expansions ahead of it.
  it('enqueueOrbitCrawl stamps LOW priority (100) so the background crawl sits behind interactive work', async () => {
    await enqueueOrbitCrawl(123);
    expect(constellationCrawlQueue.add).toHaveBeenCalledWith(
      'orbit-crawl',
      { userId: 123 },
      expect.objectContaining({ priority: 100 }),
    );
  });
});
