# Collaboration Constellation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a LivePlasma-style force-directed constellation of credited album personnel, sourced from Discogs liner-note credits, wired to Lidarr for library expansion.

**Architecture:** A global collaboration graph lives in MariaDB (`CollabEdge` in Discogs artist-ID space), materialized either from a local credit-only Discogs dump index (Setting ON) or lazily from the live Discogs/MusicBrainz APIs (Setting OFF), warmed around each user's listening-history "orbit" by a budget-bounded background crawler. An Express API serves subgraphs/paths over SSE; a Next.js `react-force-graph-2d` view renders a dense re-centering field; identity is resolved edge-only (Discogs→MBID) for the Lidarr add-path.

**Tech Stack:** TypeScript (ESM, NodeNext `.js` imports), Express, Prisma/MySQL, BullMQ + Redis, socket.io/SSE, Vitest, Next.js (React), `react-force-graph-2d`. Design source of truth: [2026-07-27-collaboration-constellation-design.md](2026-07-27-collaboration-constellation-design.md).

**Definition of Done:** After implementing this plan, perform an audit using the "full-review" skill. The plan is "done" when such an audit passes cleanly.

**Conventions (match existing code):**
- Services in `apps/api/src/services/`, tests in `apps/api/tests/`, run with `npm test -w @mixarr/api` (vitest) or `cd apps/api && npx vitest run tests/<path>`.
- Import with `.js` extensions. Mock Prisma via `vi.mock('../../src/lib/db.js', ...)`, `prisma from '../lib/db.js'`.
- Use `rateLimit('discogs'|'musicbrainz')` from `services/rate-limiter.js` and `fetchWithTimeout` from `lib/fetch-with-timeout.js` for all external calls.
- Register routers in `apps/api/src/index.ts`; guard with `requireAuth`.
- Follow @test-driven-development for every task; commit after each green task.

---

## Milestone M1 — Data model & role/dedup primitives

### Task 1: Prisma models for the graph

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (append models)
- Command: `cd apps/api && npm run db:migrate`

**Step 1:** Append these models to `schema.prisma` (snake_case columns via `@map`, matching existing style):

```prisma
model ConstellationPerson {
  personId    Int      @id @map("person_id")            // = Discogs artist id
  displayName String   @map("display_name") @db.VarChar(512)
  type        String   @default("person") @db.VarChar(16) // person|group|blacklisted
  createdAt   DateTime @default(now()) @map("created_at")
  @@map("constellation_person")
}

model ConstellationIdentity {
  personId   Int    @map("person_id")
  source     String @db.VarChar(16)                     // mb|lidarr|plex|jellyfin|lastfm
  externalId String @map("external_id") @db.VarChar(255)
  confidence String @default("linked") @db.VarChar(16)  // linked|corroborated|manual
  @@id([personId, source])
  @@map("constellation_identity")
}

model ConstellationEdge {
  sourcePersonId    Int      @map("source_person_id")
  targetPersonId    Int      @map("target_person_id")
  weight            Float    @default(0)
  bridge            Float?   // null until both endpoints full
  bridgeConfident   Boolean  @default(false) @map("bridge_confident")
  roleBitmask       Int      @default(0) @map("role_bitmask")
  sharedMasterCount Int      @default(0) @map("shared_master_count")
  bothEndpointsFull Boolean  @default(false) @map("both_endpoints_full")
  sampleMasterId    Int?     @map("sample_master_id")
  indexVersion      Int      @default(0) @map("index_version")
  fetchedAt         DateTime @default(now()) @map("fetched_at")
  @@id([sourcePersonId, targetPersonId])
  @@index([sourcePersonId])
  @@map("constellation_edge")
}

model ConstellationGenre {
  personId Int    @map("person_id")
  genre    String @db.VarChar(64)
  weight   Float  @default(0)
  @@id([personId, genre])
  @@map("constellation_genre")
}

model ConstellationOrbit {
  userId       Int      @map("user_id")
  personId     Int      @map("person_id")
  tier         String   @db.VarChar(16)                  // hist1d|hist7d|hist30d|libtop|lib|frontier
  lastCrawledAt DateTime? @map("last_crawled_at")
  status       String   @default("queued") @db.VarChar(16)
  @@id([userId, personId])
  @@map("constellation_orbit")
}

model ConstellationOwned {
  userId   Int    @map("user_id")
  personId Int    @map("person_id")
  source   String @db.VarChar(16)                        // lidarr|plex|jellyfin
  @@id([userId, personId, source])
  @@map("constellation_owned")
}
```

**Step 2:** Run `cd apps/api && npm run db:migrate` — name it `constellation_graph`. Expected: migration applies, `prisma generate` succeeds.

**Step 3:** Commit.
```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(constellation): add graph data model"
```

---

### Task 2: RoleTaxonomy — normalize Discogs role strings

Discogs roles are messy (`"Producer, Mixed By"`, `"Bass [Fretless]"`, `"Performer [Uncredited]"`, multilingual). Normalize to a role enum + weight + bitmask.

**Files:**
- Create: `apps/api/src/services/constellation/RoleTaxonomy.ts`
- Test: `apps/api/tests/services/constellation/RoleTaxonomy.test.ts`

**Step 1: Write the failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { normalizeRole, roleWeight, ROLE_BITS } from '../../../src/services/constellation/RoleTaxonomy.js';

describe('RoleTaxonomy', () => {
  it('strips bracket detail and maps to a base role', () => {
    expect(normalizeRole('Bass [Fretless]')).toEqual(['performer']);
    expect(normalizeRole('Engineer [Assistant]')).toEqual(['engineer']);
  });
  it('splits multi-role join strings', () => {
    expect(normalizeRole('Producer, Mixed By, Written-By').sort())
      .toEqual(['composer', 'engineer', 'producer']);
  });
  it('ignores uncredited/non-person noise but keeps the role', () => {
    expect(normalizeRole('Performer [Uncredited]')).toEqual(['performer']);
  });
  it('maps unknown roles to "other" with near-zero weight', () => {
    expect(normalizeRole('Artwork')).toEqual(['artwork']);
    expect(roleWeight('artwork')).toBeLessThan(roleWeight('performer'));
  });
  it('builds a bitmask from roles', () => {
    const mask = ROLE_BITS.performer | ROLE_BITS.producer;
    expect(mask & ROLE_BITS.performer).toBeTruthy();
    expect(mask & ROLE_BITS.engineer).toBeFalsy();
  });
});
```

**Step 2:** Run `cd apps/api && npx vitest run tests/services/constellation/RoleTaxonomy.test.ts` — Expected: FAIL (module missing).

**Step 3: Implement**
```typescript
export type BaseRole = 'performer' | 'producer' | 'composer' | 'engineer' | 'artwork' | 'other';

export const ROLE_BITS: Record<BaseRole, number> = {
  performer: 1 << 0, producer: 1 << 1, composer: 1 << 2,
  engineer: 1 << 3, artwork: 1 << 4, other: 1 << 5,
};

const WEIGHTS: Record<BaseRole, number> = {
  performer: 1.0, producer: 1.0, composer: 0.6, engineer: 0.3, artwork: 0.02, other: 0.05,
};
export const roleWeight = (r: BaseRole) => WEIGHTS[r];

// Base token (lowercased, bracket-stripped) -> BaseRole. Extend over time.
const MAP: Record<string, BaseRole> = {
  bass: 'performer', guitar: 'performer', drums: 'performer', vocals: 'performer',
  performer: 'performer', piano: 'performer', keyboards: 'performer', saxophone: 'performer',
  producer: 'producer', 'produced by': 'producer',
  'written-by': 'composer', 'written by': 'composer', composer: 'composer', lyricist: 'composer',
  'mixed by': 'engineer', 'recorded by': 'engineer', 'mastered by': 'engineer', engineer: 'engineer',
  artwork: 'artwork', 'design': 'artwork', photography: 'artwork', 'liner notes': 'artwork',
};

export function normalizeRole(raw: string): BaseRole[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const roles = new Set<BaseRole>();
  for (const part of parts) {
    const base = part.replace(/\[[^\]]*\]/g, '').trim().toLowerCase();
    roles.add(MAP[base] ?? (/(bass|guitar|drum|vocal|violin|cello|flute|horn|synth)/.test(base) ? 'performer' : 'other'));
  }
  return [...roles];
}

export function rolesToBitmask(roles: BaseRole[]): number {
  return roles.reduce((m, r) => m | ROLE_BITS[r], 0);
}
```

**Step 4:** Run the test — Expected: PASS.

**Step 5:** Commit `feat(constellation): role taxonomy normalization`.

---

### Task 3: MasterDedup — collapse reissues before counting

**Files:**
- Create: `apps/api/src/services/constellation/MasterDedup.ts`
- Test: `apps/api/tests/services/constellation/MasterDedup.test.ts`

**Step 1: Failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { dedupToMasters, sharedMasterCount } from '../../../src/services/constellation/MasterDedup.js';

describe('MasterDedup', () => {
  it('collapses many releases of the same master to one', () => {
    const releases = [
      { releaseId: 1, masterId: 100 }, { releaseId: 2, masterId: 100 },
      { releaseId: 3, masterId: 200 }, { releaseId: 4, masterId: null },
    ];
    // master 100 (x2 releases), master 200, and a null-master release kept as its own release-id key
    expect(dedupToMasters(releases).size).toBe(3);
  });
  it('counts shared masters between two credit lists, not shared releases', () => {
    const a = [{ releaseId: 1, masterId: 100 }, { releaseId: 2, masterId: 100 }];
    const b = [{ releaseId: 9, masterId: 100 }];
    expect(sharedMasterCount(a, b)).toBe(1); // same master via different pressings
  });
});
```

**Step 2:** Run — Expected FAIL.

**Step 3: Implement**
```typescript
export interface ReleaseRef { releaseId: number; masterId: number | null; }

// A stable key per master; null-master releases key on their own release id.
const masterKey = (r: ReleaseRef) => (r.masterId != null ? `m${r.masterId}` : `r${r.releaseId}`);

export function dedupToMasters(releases: ReleaseRef[]): Set<string> {
  return new Set(releases.map(masterKey));
}

export function sharedMasterCount(a: ReleaseRef[], b: ReleaseRef[]): number {
  const setA = dedupToMasters(a);
  const setB = dedupToMasters(b);
  let n = 0;
  for (const k of setA) if (setB.has(k)) n++;
  return n;
}
```

**Step 4:** Run — Expected PASS.

**Step 5:** Commit `feat(constellation): master-release dedup`.

---

### Task 4: BridgeScore — neighbor-overlap with confidence gate

**Files:**
- Create: `apps/api/src/services/constellation/BridgeScore.ts`
- Test: `apps/api/tests/services/constellation/BridgeScore.test.ts`

**Step 1: Failing test**
```typescript
import { describe, it, expect } from 'vitest';
import { bridgeScore } from '../../../src/services/constellation/BridgeScore.js';

describe('BridgeScore', () => {
  it('is high when collaborator sets barely overlap (a real bridge)', () => {
    const r = bridgeScore(new Set([1,2,3]), new Set([4,5,6]), true, true);
    expect(r.confident).toBe(true);
    expect(r.score).toBeGreaterThan(0.9);
  });
  it('is low when they share most collaborators (same scene)', () => {
    const r = bridgeScore(new Set([1,2,3,4]), new Set([1,2,3,5]), true, true);
    expect(r.score).toBeLessThan(0.5);
  });
  it('is NOT confident unless both endpoints are fully materialized', () => {
    const r = bridgeScore(new Set([1]), new Set([2]), true, false);
    expect(r.confident).toBe(false);
    expect(r.score).toBeNull();
  });
});
```

**Step 2:** Run — Expected FAIL.

**Step 3: Implement**
```typescript
export function bridgeScore(
  na: Set<number>, nb: Set<number>, aFull: boolean, bFull: boolean,
): { score: number | null; confident: boolean } {
  const confident = aFull && bFull;
  if (!confident) return { score: null, confident: false };
  let inter = 0;
  for (const x of na) if (nb.has(x)) inter++;
  const union = na.size + nb.size - inter;
  const score = union === 0 ? 0 : 1 - inter / union;
  return { score, confident: true };
}
```

**Step 4:** Run — Expected PASS.

**Step 5:** Commit `feat(constellation): bridge score with confidence gate`.

---

## Milestone M2 — Discogs credit ingestion

### Task 5: Extend `discogs.ts` to fetch a release's full credits (+ master_id)

**Files:**
- Modify: `apps/api/src/services/discogs.ts` (add `getReleaseCredits`)
- Test: `apps/api/tests/services/discogs.credits.test.ts`

**Step 1: Failing test** — mock `fetch` to return a release payload with `extraartists` + `tracklist[].extraartists` + `master_id`; assert `getReleaseCredits(id)` returns a flat list `{ artistId, name, roles: BaseRole[], masterId }` with per-track credits merged and roles normalized via RoleTaxonomy. (Include a fixture with a `[Uncredited]` bracket and a multi-role `join`.)

**Step 2:** Run — FAIL.

**Step 3: Implement** `getReleaseCredits` using `rateLimit('discogs')` + `fetchWithTimeout`, parsing `extraartists` and `tracklist[].extraartists`, dropping entries with `id === 0` (free-text, non-traversable), mapping roles through `normalizeRole`, and carrying `master_id`.

**Step 4:** Run — PASS.

**Step 5:** Commit `feat(constellation): discogs release credits fetch`.

---

### Task 6: `ExpansionService.expandPerson()` — person → collaborators (live path)

Given a Discogs artist id: fetch their releases (`/artists/{id}/releases`), fetch each release's credits (Task 5), dedup to masters (Task 3), aggregate co-credited people into weighted `ConstellationEdge` rows (weight = `sharedMasterCount × maxRoleWeight × recencyDecay`), write `ConstellationGenre` from release genres, and mark the person's `bothEndpointsFull` truthy once all their releases are processed.

**Files:**
- Create: `apps/api/src/services/constellation/ExpansionService.ts`
- Test: `apps/api/tests/services/constellation/ExpansionService.test.ts`

**Steps:** Failing test with a mocked Discogs client returning 2 releases sharing collaborator X across a reissue (assert X's edge `sharedMasterCount === 1`, not 2) and a distinct collaborator Y on one master. Assert edges are upserted (mock Prisma `constellationEdge.upsert`), blacklisted names (`Various`, `Unknown Artist`) are skipped, and genre rows written. Implement minimal → PASS → commit `feat(constellation): live person expansion`.

**Wiring note:** `ExpansionService` takes a `CreditSource` interface (`getArtistReleases`, `getReleaseCredits`) so Task 9 can inject the dump index instead of the live client. Define that interface here.

---

## Milestone M3 — Credit-only dump index (Setting ON)

### Task 7: `DumpIndexService` schema (SQLite) + writer

**Files:**
- Create: `apps/api/src/services/constellation/DumpIndexService.ts`
- Test: `apps/api/tests/services/constellation/DumpIndexService.test.ts`
- Dependency: add `better-sqlite3` to `apps/api/package.json` (and `@types/better-sqlite3` dev). Verify it installs.

**Steps:** Test opens an in-memory SQLite index, writes a few artist/release/credit rows, and reads back `getArtistReleases(id)` and `getReleaseCredits(id)` matching the `CreditSource` interface from Task 6. Tables: `artist(id,name)`, `artist_release(artist_id,release_id)`, `release_credit(release_id,artist_id,role,master_id)`, `artist_genre(artist_id,genre,weight)`, plus a `meta(index_version)`. Implement → PASS → commit `feat(constellation): sqlite dump index`.

### Task 8: `dump-import-worker` — stream-parse the Discogs releases dump

**Files:**
- Create: `apps/api/src/jobs/constellation/dump-import-worker.ts`
- Create: `apps/api/src/jobs/constellation/queue.ts` (new BullMQ queues: `constellation-import`, `constellation-crawl`, `constellation-expand`)
- Test: `apps/api/tests/jobs/constellation/dump-import.test.ts`

**Steps:** Test feeds a tiny gzipped XML fixture (a handful of `<release>` elements with `<extraartists>` and per-track credits) through the parser and asserts the resulting SQLite index has the expected credit rows + `master_id` + bumped `index_version`. Use a streaming XML parser (`sax` or `htmlparser2` — add dependency) to avoid loading the whole dump. **Surface progress** via socket.io like existing jobs. Implement → PASS → commit `feat(constellation): dump import worker`.

**Honest-cost note in code comments:** parsing the full dump is hours/large-I/O; the worker is idempotent and re-runnable for monthly refresh; `index_version` increments each run.

---

## Milestone M4 — Orbit crawler (budget-bounded)

### Task 9: `OrbitCrawler` — breadth-first, edge-budget bounded

**Files:**
- Create: `apps/api/src/services/constellation/OrbitCrawler.ts`
- Test: `apps/api/tests/services/constellation/OrbitCrawler.test.ts`

**Steps:** Failing test: given seed person ids and a `CreditSource` (fake), crawl breadth-first by tier and **stop once a `maxEdges` budget is hit** (assert it does NOT exhaust a deep small-world graph — e.g., budget 10 halts after ~10 edges even though the fake graph is effectively infinite). Assert nearer tiers fill before farther. Assert idempotency (re-running a settled orbit does no new fetches). Implement using `ExpansionService` + the injected `CreditSource` (index in Setting ON, live client in Setting OFF). → PASS → commit `feat(constellation): budget-bounded orbit crawler`.

### Task 10: `orbit-crawl-worker` + seed collection from listening history

**Files:**
- Create: `apps/api/src/jobs/constellation/orbit-crawl-worker.ts`
- Modify: reuse `services/tautulli.ts`, `services/lastfm.ts`, `services/listenbrainz.ts`, `services/spotify.ts` for seeds
- Test: `apps/api/tests/jobs/constellation/orbit-crawl.test.ts`

**Steps:** Test mocks the listening-history services to return seed artists per tier; assert the worker enqueues crawl work tiered by recency (1d→7d→30d→libtop→lib), resolves seeds to Discogs ids via `IdentityService` (Task 12), respects a **configurable daily API budget** (Setting OFF) and the edge budget, runs at low BullMQ priority, and **idles**, re-waking on new history. Implement → PASS → commit `feat(constellation): orbit crawl worker + seeds`.

---

## Milestone M5 — Identity resolution (edge-only)

### Task 11: `IdentityService.discogsToMbid()` — linked + corroborated + manual

**Files:**
- Create: `apps/api/src/services/constellation/IdentityService.ts`
- Test: `apps/api/tests/services/constellation/IdentityService.test.ts`

**Steps:** Failing tests:
1. **Linked:** MB URL lookup (`/url?resource=discogs.com/artist/{id}&inc=artist-rels`, mocked) returns one MB artist → cache `ConstellationIdentity` with `confidence='linked'`.
2. **Corroborated:** no url-rel, but a name search returns a candidate whose discography overlaps the Discogs releases → auto-accept `confidence='corroborated'`.
3. **Ambiguous:** name match without overlap → return `needsManual: true` (no write).
4. **Cache:** second call hits cache, no second fetch.
Implement using `rateLimit('musicbrainz')`. → PASS → commit `feat(constellation): discogs→mbid identity`.

### Task 12: `IdentityService` reverse (MBID/library → Discogs) + owned-set builder

**Files:** Modify `IdentityService.ts`; Test: extend the identity test.

**Steps:** Test: given a user's Lidarr/Plex/Jellyfin artist MBIDs (mocked via existing `lidarr.ts`/`plex`/`jellyfin` services), build `ConstellationOwned` rows (Discogs person ids) so the "owned ring" can be a set-membership check. Assert unresolved artists are skipped (not errored). Implement → PASS → commit `feat(constellation): owned-set + reverse identity`.

---

## Milestone M6 — GraphService & API

### Task 13: `GraphService.subgraph()` and `bridgeFill()`

**Files:**
- Create: `apps/api/src/services/constellation/GraphService.ts`
- Test: `apps/api/tests/services/constellation/GraphService.test.ts`

**Steps:** Test (mock Prisma) `subgraph(focusId, {roleMask, topN})` returns focus + top-N edges by weight (role-filtered via bitmask), plus a pruned second ring (not top-N²), with node color = dominant genre and node size = `max(lastfm popularity, credit prominence)`. Separately, `bridgeFill(edges)` computes bridge scores for edges whose both endpoints are full (Task 4) and updates `bridge`/`bridgeConfident`. Implement → PASS → commit `feat(constellation): graph subgraph + bridge fill`.

### Task 14: `GraphService.path()` — shortest + interesting

**Files:** Modify `GraphService.ts`; Test: extend.

**Steps:** Test: `path(a, b, {mode:'shortest', max:6})` returns bounded-BFS shortest path or null past 6 degrees; `path(a, b, {mode:'interesting'})` runs bounded k-shortest ranked by cumulative bridge, capped at `max+2` and a candidate budget, preferring higher-bridge chains. Assert the interesting path is allowed to be longer. Implement → PASS → commit `feat(constellation): path modes`.

### Task 15: Constellation API router + SSE

**Files:**
- Create: `apps/api/src/routes/constellation.ts`
- Modify: `apps/api/src/index.ts` (register `app.use('/api/constellation', constellationRouter)`)
- Test: `apps/api/tests/routes/constellation.test.ts`

**Steps:** Test (supertest-style like existing route tests) each endpoint behind `requireAuth`:
- `GET /seed?type=album|artist&id=` → resolves seed to a Discogs id (via IdentityService), returns initial subgraph + an SSE stream token.
- `GET /expand/:personId` → enqueues `constellation-expand`, returns cached neighbors.
- `GET /path?from=&to=&mode=&max=`
- `GET /person/:personId/releases` → discography for the panel.
- `GET /stream/:token` → SSE of newly-expanded nodes, tagged with a **generation token** (client discards stale). Reuse the socket/SSE pattern.
- `GET /owned` → the user's owned person-id set.
Implement → PASS → commit `feat(constellation): api + sse`.

### Task 16: Settings — index on/off, budgets, defaults

**Files:** Modify `apps/api/src/services/settings.service.ts` (or the settings store) + `routes/settings.ts`; Test accordingly.

**Steps:** Add user/global settings: `constellationIndexEnabled` (bool), `orbitEdgeBudget` (250000), `dailyApiBudget` (5000), `fanoutN` (8), `pathMaxDegrees` (6), `indexRefresh` ('monthly'|'off'). Wire `ExpansionService`/`OrbitCrawler` to read the index-on/off toggle and choose `CreditSource` accordingly. Test the toggle selects the right source. Commit `feat(constellation): settings + source toggle`.

---

## Milestone M7 — Frontend constellation

> Frontend tasks state files, the interface each component consumes, and acceptance. Per-render code is written during execution against `apps/web` conventions (Next.js). Add `react-force-graph-2d` to `apps/web/package.json`; verify build.

### Task 17: Data hooks + SSE client
**Files:** Create `apps/web/src/hooks/useConstellation.ts`, `useFrontierStream.ts`; Test with the web test setup (`apps/web/e2e` / vitest).
- `useConstellation(seed)` fetches `/seed`, exposes `{nodes, edges, recenter(id), expandMore(id)}`.
- `useFrontierStream(token)` consumes SSE, **discards events whose generation ≠ current** (re-center race guard). Acceptance test: stale-generation event is ignored.

### Task 18: `<ConstellationView>` — dense field + re-center
**Files:** Create `apps/web/src/components/constellation/ConstellationView.tsx`.
- Render `react-force-graph-2d`: focus + ring-1 (top-N) + pruned ring-2 (~50 nodes). Node color = genre, size = prominence, ring overlay = owned, edge thickness = weight, edge glow = bridge **only when `bridgeConfident`**.
- Click a node → animated re-center (fancy transition) + breadcrumb push. Free-pan = secondary zoom-out.
- Acceptance: clicking re-centers and blooms neighbors; confident-bridge edges glow, non-confident don't.

### Task 19: `<PersonPanel>` + acquisition grain
**Files:** Create `apps/web/src/components/constellation/PersonPanel.tsx`.
- Lists the person's credited master releases (`/person/:id/releases`); each release has the existing subscribe→Lidarr action (adds the album's **primary artist**, monitors that album) reusing the current subscription API.
- Node hover "＋": lead artist → "monitor artist"; non-lead → opens this panel (never monitors an empty artist). Acceptance: session-player node's "＋" opens the panel, does not blind-subscribe.

### Task 20: `<ConstellationPlayer>` — owned → Deezer → YouTube link-out
**Files:** Create `apps/web/src/components/constellation/ConstellationPlayer.tsx`.
- Node plays a track from its strongest edge's master; edge plays that shared master. Fallback: owned (Plex/Jellyfin) → Deezer 30s preview → "open in YouTube" link-out (new tab). Source badge shown. Acceptance: with no owned/Deezer match, shows the YouTube link-out, never a dead button.

### Task 21: `<PathFinder>` + genre filter/legend + "hide hotness"
**Files:** Create `apps/web/src/components/constellation/PathFinder.tsx` and a controls bar.
- Two-artist path (shortest default, "interesting" opt-in with a "searching…" state). Role filter toggles, genre highlight/filter, hide-hotness toggle. Acceptance: interesting-path shows the searching state; role filter changes visible edges.

### Task 22: Page + nav wiring
**Files:** Create the constellation page in `apps/web/src/app/.../constellation/page.tsx`; add nav entry. Acceptance: authenticated route renders the view seeded from a searched artist/album.

---

## Milestone M8 — Integration, docs, degradation

### Task 23: End-to-end integration test (Setting ON and OFF)
**Files:** `apps/api/tests/integration/constellation.e2e.test.ts`.
- Seed → expand → path → owned-ring → subscribe, once with a fake dump index (ON) and once live-mocked (OFF). Assert master-dedup weighting, bounded orbit, bridge confidence, identity resolution, and that Setting OFF degrades (bridge often absent) without erroring.

### Task 24: Degradation matrix tests
**Files:** extend integration tests — Discogs down, MB down, no Plex/Lidarr, dump-not-imported → assert the behaviors in design §9 (serve cache, disable subscribe when no Lidarr, warming state before import).

### Task 25: Docs + setup surfacing
**Files:** README/docs — document the index on/off setting, the honest dump ingest cost, and Plex-Pass-not-required (sonic is out of scope). Commit.

### Task 26: Final audit
Run the **full-review** skill across the branch. Fix findings. The plan is done when it passes cleanly.

---

## Plan review gate — results

1. **Wiring completeness** — Every API endpoint (Task 15) has a consumer hook (17) and component (18–22). Node "＋" grain explicitly routed (19). SSE generation token wired both server (15) and client (17). Seed resolution routed through IdentityService (11/15).
2. **Resource lifecycle** — SQLite index opened/closed in `DumpIndexService` (7); BullMQ queues defined once (8) and workers attach/detach; Redis via existing `createRedisConnection`; SSE streams closed on client disconnect (15). Dump import is idempotent and re-runnable (8).
3. **Dependency completeness** — New deps called out at first use: `better-sqlite3` (+types) Task 7, streaming XML parser Task 8, `react-force-graph-2d` Task 17; each has a "verify it installs/builds" step.
4. **Config consistency** — index on/off toggle (16) selects `CreditSource` for both `ExpansionService` and `OrbitCrawler`; no contradiction. No Docker mount conflicts (index is app-managed local disk).
5. **Async/sync boundaries** — SQLite (`better-sqlite3`) is sync; it runs inside BullMQ workers/services, never inside the Express request path for bulk ops (API reads are small, indexed lookups). Dump parse is streaming. External calls all go through async `rateLimit`/`fetchWithTimeout`.
6. **Missing integration steps** — `CreditSource` interface defined in Task 6 and implemented by both live client (6) and index (7); orbit seeds ↔ identity resolution wired in Task 10/12; owned-ring ↔ graph node flags wired in Task 12/13.

**Plan review passed.**
