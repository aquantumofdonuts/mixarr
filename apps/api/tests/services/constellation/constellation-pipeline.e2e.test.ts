/**
 * END-TO-END INTEGRATION TEST — Collaboration Constellation backend pipeline.
 *
 * This proves the REAL constellation services compose across the whole pipeline,
 * in BOTH the index-ON and index-OFF data-source modes, over a single shared
 * in-memory Prisma store. Nothing here is re-mocked per service: ExpansionService
 * WRITES and OrbitCrawler / GraphService / IdentityService READ over the SAME
 * backing Maps, so a defect in how any two of them agree on the schema surfaces.
 *
 * The exact Prisma surface the constellation services touch (grepped from
 * apps/api/src/services/constellation/*.ts) — and therefore all the in-memory
 * store must implement — is:
 *   constellationEdge     upsert · findMany · updateMany
 *   constellationPerson   upsert · findUnique · findMany
 *   constellationGenre    upsert · findMany
 *   constellationOwned    upsert · findMany
 *   constellationIdentity findUnique · findFirst · upsert
 * (constellationOrbit is only touched by the job/worker layer, not by any of the
 * five services exercised here, so it is intentionally absent.)
 *
 * SHARED-STATE APPROACH: db.js is module-mocked to a bare object; beforeEach
 * builds a fresh `makeInMemoryConstellationPrisma()` and `Object.assign`s its
 * delegates onto that same object. Every service imports the default `prisma`
 * binding (the bare object), so after the assign they all resolve to the one
 * fresh store — module-level sharing without hoisting gymnastics, reset per test.
 *
 * ON vs OFF — what actually degrades: the OFF source mirrors the live Discogs
 * adapter (LiveDiscogsCreditSource), which returns `genres: []` on every release
 * because the artist-releases listing carries no per-release genre. Consequence:
 * ON produces ConstellationGenre rows (nodes get a dominant genre / colour); OFF
 * produces none (node.genre === null). EVERYTHING ELSE is identical — edges,
 * weights, master-dedup, bridge confidence, path, and owned all compute the same
 * in OFF, because none of them depend on genres (bridge needs neighbour SETS, not
 * genres). The difference between modes is genre presence, never a crash.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// db.js is mocked to a bare object; beforeEach assigns a fresh in-memory store's
// delegates onto it (see file header). Both default and named exports point at it.
vi.mock('../../../src/lib/db.js', () => {
  const shared = {};
  return { default: shared, prisma: shared };
});

// Silence service loggers (bridge/path warnings) but keep them observable.
vi.mock('../../../src/lib/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import prisma from '../../../src/lib/db.js';
import { makeInMemoryConstellationPrisma, type InMemoryConstellationPrisma } from './constellation-store.js';
import { DumpIndexService } from '../../../src/services/constellation/DumpIndexService.js';
import { ExpansionService, type CreditSource } from '../../../src/services/constellation/ExpansionService.js';
import { OrbitCrawler, type OrbitDeps } from '../../../src/services/constellation/OrbitCrawler.js';
import { GraphService } from '../../../src/services/constellation/GraphService.js';
import { IdentityService } from '../../../src/services/constellation/IdentityService.js';
import { normalizeRole, type BaseRole } from '../../../src/services/constellation/RoleTaxonomy.js';
import type { MusicBrainzService } from '../../../src/services/musicbrainz.js';

// ---------------------------------------------------------------------------
// Synthetic collaboration graph
//
// Person ids:  A=1  B=2  C=3   BR=100 (bridge)   D=4  E=5   G=7 (never expanded)
//
// Cluster 1: A—B, A—C                Cluster 2: D—E, D—G
// Bridge:    BR collaborates with A,B (cluster 1) AND D,E (cluster 2), so the
//            edges A—BR and BR—D/E are the only crossings between the clusters.
// Reissue:   B appears with A on rel 10 AND rel 11, which SHARE master 1000 —
//            so the A—B edge must have sharedMasterCount === 1 (not 2).
// Leaf G:    G collaborates only with D. Under a depth-2 crawl from A, D sits at
//            depth 2, so its neighbours are NOT enqueued — G is materialised (as
//            an edge/person, via D's expansion) but NEVER expanded, giving a clean
//            not-fully-expanded endpoint for the bridge-confidence gate.
// ---------------------------------------------------------------------------
const A = 1, B = 2, C = 3, BR = 100, D = 4, E = 5, G = 7;

const NAMES: Record<number, string> = {
  [A]: 'A', [B]: 'B', [C]: 'C', [BR]: 'BR', [D]: 'D', [E]: 'E', [G]: 'G',
};

interface CreditSpec { artistId: number; role: string }
interface ReleaseSpec {
  releaseId: number;
  masterId: number | null;
  year: number | null;
  genres: string[];
  credits: CreditSpec[];
}

const RELEASES: ReleaseSpec[] = [
  // Cluster 1 — Jazz
  { releaseId: 10, masterId: 1000, year: 2020, genres: ['Jazz'],
    credits: [{ artistId: A, role: 'Bass' }, { artistId: B, role: 'Guitar' }, { artistId: BR, role: 'Producer' }] },
  // rel 11 is a REISSUE of master 1000 — B collaborates with A again on the same master.
  { releaseId: 11, masterId: 1000, year: 2021, genres: ['Jazz'],
    credits: [{ artistId: A, role: 'Bass' }, { artistId: B, role: 'Guitar' }] },
  { releaseId: 12, masterId: 1001, year: 2019, genres: ['Jazz'],
    credits: [{ artistId: A, role: 'Bass' }, { artistId: C, role: 'Drums' }] },
  // Cluster 2 — Rock
  { releaseId: 20, masterId: 2000, year: 2018, genres: ['Rock'],
    credits: [{ artistId: D, role: 'Vocals' }, { artistId: E, role: 'Guitar' }, { artistId: BR, role: 'Producer' }] },
  { releaseId: 21, masterId: 2001, year: 2017, genres: ['Rock'],
    credits: [{ artistId: D, role: 'Vocals' }, { artistId: E, role: 'Guitar' }] },
  // rel 22 introduces leaf G, collaborating only with D — deliberately left unexpanded.
  { releaseId: 22, masterId: 2002, year: 2015, genres: ['Rock'],
    credits: [{ artistId: D, role: 'Vocals' }, { artistId: G, role: 'Keyboards' }] },
];

const NOW_YEAR = 2021; // deterministic recency: rel-11 (2021) => decay 1.0 for the A—B edge.

/** Seed a DumpIndexService (:memory:) with the synthetic data — the ON source. */
function seedDumpIndex(idx: DumpIndexService): void {
  idx.transaction((db) => {
    for (const [id, name] of Object.entries(NAMES)) db.upsertArtist(Number(id), name);
    for (const rel of RELEASES) {
      db.setReleaseMeta({ releaseId: rel.releaseId, masterId: rel.masterId, year: rel.year, genres: rel.genres });
      for (const c of rel.credits) {
        db.addCredit({ releaseId: rel.releaseId, artistId: c.artistId, role: c.role, masterId: rel.masterId });
      }
    }
  });
}

/**
 * The OFF source — a fake CreditSource that returns the SAME synthetic data as
 * the dump index but with `genres: []` on every release, mirroring
 * LiveDiscogsCreditSource (the live Discogs listing carries no per-release genre).
 */
function makeOffSource(): CreditSource {
  return {
    async getArtistReleases(artistId) {
      return RELEASES.filter((r) => r.credits.some((c) => c.artistId === artistId)).map((r) => ({
        releaseId: r.releaseId,
        masterId: r.masterId,
        year: r.year,
        genres: [], // <-- the ONLY difference from the ON source
      }));
    },
    async getReleaseCredits(releaseId) {
      const rel = RELEASES.find((r) => r.releaseId === releaseId);
      if (!rel) return [];
      // Merge raw roles per artist, normalizing exactly as the live adapter would.
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

/**
 * Production-style OrbitCrawler adapter: expand a person with the REAL
 * ExpansionService, then read that person's freshly-materialized edges and
 * fullness straight back out of the shared in-memory store — exactly the wiring
 * documented in OrbitCrawler's header.
 */
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

/** Find a directed edge row in the store. */
async function edge(source: number, target: number) {
  const rows = await prisma.constellationEdge.findMany({ where: { sourcePersonId: source } });
  return rows.find((e: any) => e.targetPersonId === target);
}

describe.each([['ON'], ['OFF']] as const)('constellation e2e pipeline — index %s', (mode) => {
  let mem: InMemoryConstellationPrisma;
  let source: CreditSource;
  let dumpIndex: DumpIndexService | null;
  let expansion: ExpansionService;
  let graph: GraphService;

  beforeEach(() => {
    // Fresh in-memory store; wire its delegates onto the shared mocked `prisma`.
    mem = makeInMemoryConstellationPrisma();
    Object.assign(prisma as object, mem);

    if (mode === 'ON') {
      dumpIndex = new DumpIndexService(':memory:');
      seedDumpIndex(dumpIndex);
      source = dumpIndex;
    } else {
      dumpIndex = null;
      source = makeOffSource();
    }

    expansion = new ExpansionService(source, { nowYear: NOW_YEAR });
    graph = new GraphService();
  });

  afterEach(() => {
    dumpIndex?.close();
  });

  it('1. crawl is edge-budget bounded and materializes edges (bounded orbit)', async () => {
    const crawler = new OrbitCrawler(makeOrbitDeps(expansion));
    // A expands to 3 edges (B,C,BR); B then adds 2 (A,BR) => total 5 crosses the
    // budget of 4, so C/BR/D/E are NOT expanded. Proves the budget bounds the crawl.
    const result = await crawler.crawl([A], { maxEdges: 4 });

    expect(result.personsExpanded).toBe(2); // only A and B
    expect(result.edgesMaterialized).toBeGreaterThanOrEqual(4);
    expect(result.edgesMaterialized).toBeLessThanOrEqual(4 + 4); // overshoot <= one expansion
    // The far cluster was never reached.
    expect(await prisma.constellationPerson.findUnique({ where: { personId: D } })).toBeNull();
    expect(await prisma.constellationPerson.findUnique({ where: { personId: E } })).toBeNull();
    // But A's edges really were written.
    expect((await prisma.constellationEdge.findMany({ where: { sourcePersonId: A } })).length).toBe(3);
  });

  it('2-7. full pipeline composes: dedup, subgraph, bridge gate, path, identity/owned', async () => {
    const crawler = new OrbitCrawler(makeOrbitDeps(expansion));
    const userId = 42;

    // --- Expand + crawl (full budget) materializes the whole connected orbit ---
    // A single BFS crawl from A reaches every person except leaf G: G hangs off D
    // (depth 2), and with maxDepth 2 D's neighbours are not enqueued, so G is
    // materialised as an edge/person via D's expansion but is never expanded.
    const crawl = await crawler.crawl([A], { maxEdges: 1000, maxDepth: 2 });
    expect(crawl.personsExpanded).toBe(6); // A,B,C,BR,D,E
    expect(crawl.edgesMaterialized).toBeGreaterThan(0);
    // Terminates: the crawl returned. All six are marked fully expanded; G is not.
    for (const id of [A, B, C, BR, D, E]) {
      expect((await prisma.constellationPerson.findUnique({ where: { personId: id } }))?.fullyExpanded).toBe(true);
    }
    expect((await prisma.constellationPerson.findUnique({ where: { personId: G } }))?.fullyExpanded).toBe(false);

    // --- 2. Master-dedup end-to-end ---
    // B collaborates with A on rel 10 AND rel 11, which share master 1000.
    const ab = await edge(A, B);
    expect(ab).toBeDefined();
    expect(ab!.sharedMasterCount).toBe(1); // deduped to ONE master, not 2
    // weight = sharedMasterCount(1) * maxRoleWeight(performer=1.0) * recency(2021 vs 2021 => 1.0)
    expect(ab!.weight).toBe(1);

    // --- 3. Subgraph: focus + rings, genre (ON only), size, no dangling edges ---
    const sg = await graph.subgraph(A, { userId });
    expect(sg.focusId).toBe(A);
    const nodeIds = new Set(sg.nodes.map((n) => n.personId));
    expect(nodeIds.has(A)).toBe(true);
    for (const id of [B, C, BR]) expect(nodeIds.has(id)).toBe(true); // ring-1
    // No dangling edges: every edge endpoint is a node in the subgraph.
    for (const e of sg.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
    const nodeA = sg.nodes.find((n) => n.personId === A)!;
    expect(nodeA.size).toBeGreaterThan(0); // credit prominence = sum of outgoing weights
    if (mode === 'ON') {
      expect(nodeA.genre).toBe('Jazz'); // dominant genre present ON
    } else {
      expect(nodeA.genre).toBeNull(); // OFF: genres:[] => no colour
    }

    // --- 4. bridgeFill + confidence gate ---
    // A and BR are both fully expanded => their edge is confident with a score.
    // D and G: G is NOT fully expanded => that edge stays non-confident.
    await graph.bridgeFill([
      { source: A, target: BR },
      { source: D, target: G },
    ]);
    const aBr = await edge(A, BR);
    const brA = await edge(BR, A);
    expect(aBr!.bridgeConfident).toBe(true);
    expect(typeof aBr!.bridge).toBe('number');
    // bridgeScore = 1 - |N(A) ∩ N(BR)| / |N(A) ∪ N(BR)|
    //   N(A)={B,C,BR}, N(BR)={A,B,D,E}, intersection={B}=1, union=3+4-1=6 => 1-1/6.
    expect(aBr!.bridge!).toBeCloseTo(1 - 1 / 6, 10);
    expect(brA!.bridgeConfident).toBe(true); // both directed rows updated
    const dG = await edge(D, G);
    expect(dG!.bridgeConfident).toBe(false); // confidence gate holds: G not full
    expect(dG!.bridge).toBeNull();

    // --- 5. Path across the clusters (through the bridge BR) ---
    const shortest = await graph.path(A, E, { mode: 'shortest' });
    expect(shortest).not.toBeNull();
    expect(shortest!.nodes[0]).toBe(A);
    expect(shortest!.nodes.at(-1)).toBe(E);
    expect(shortest!.nodes).toContain(BR); // route crosses the bridge
    expect(shortest!.degrees).toBe(2); // A -> BR -> E
    const interesting = await graph.path(A, E, { mode: 'interesting' });
    expect(interesting).not.toBeNull();
    expect(interesting!.nodes[0]).toBe(A);
    expect(interesting!.nodes.at(-1)).toBe(E);

    // --- 6. Identity + owned ---
    // Mock MB: the Discogs artist page for A links to MBID 'mbid-A'.
    const mb = {
      lookupArtistMbidByUrl: vi.fn(async (url: string) => (url.endsWith(`/artist/${A}`) ? 'mbid-A' : null)),
      lookupArtistDiscogsId: vi.fn(async () => null),
      searchArtist: vi.fn(async () => []),
      getArtistReleases: vi.fn(async () => ({ releaseGroups: [] })),
    } as unknown as MusicBrainzService;
    const identity = new IdentityService({ mb });

    const fwd = await identity.discogsToMbid(A, 'A');
    expect(fwd.mbid).toBe('mbid-A');
    expect(fwd.confidence).toBe('linked');

    // buildOwnedSet resolves 'mbid-A' back to Discogs A via the cached identity.
    const lidarr = { source: 'lidarr' as const, getArtistMbids: async () => ['mbid-A'] };
    const ownedResult = await identity.buildOwnedSet(userId, [lidarr]);
    expect(ownedResult.owned).toBe(1);
    expect(ownedResult.skipped).toBe(0);

    // subgraph now flags A as owned for this user.
    const sgOwned = await graph.subgraph(A, { userId });
    expect(sgOwned.nodes.find((n) => n.personId === A)!.owned).toBe(true);
    // A different user does not see it owned.
    const sgOther = await graph.subgraph(A, { userId: 999 });
    expect(sgOther.nodes.find((n) => n.personId === A)!.owned).toBe(false);

    // --- 7. OFF degrades to null genre WITHOUT breaking anything else ---
    // Bridge does NOT depend on genres, so it is still confident+scored in OFF;
    // only the genre/colour channel degrades. Both modes yield a coherent graph.
    if (mode === 'OFF') {
      expect(sg.nodes.every((n) => n.genre === null)).toBe(true); // colour degraded
      expect(aBr!.bridgeConfident).toBe(true); // bridge still works
      expect(aBr!.bridge!).toBeCloseTo(1 - 1 / 6, 10); // same score as ON — bridge ignores genres
      expect(shortest!.degrees).toBe(2); // path still works
      expect(ownedResult.owned).toBe(1); // owned still works
      expect(ab!.sharedMasterCount).toBe(1); // dedup still works
    }
  });
});
