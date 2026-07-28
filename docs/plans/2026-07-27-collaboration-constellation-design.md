# Collaboration Constellation — Design

**Date:** 2026-07-27
**Status:** Design (attack-gated)
**Working name:** Collaboration Constellation (a.k.a. "Six Degrees")

---

## 1. Vision

A "six degrees of separation" feature for **credited album personnel**, in the spirit of
**liveplasma.com** but wired to Lidarr. Seed with an album or artist; identify everyone
who actually appears in the **liner notes** (performers, producers, composers, songwriters,
engineers, band members); render them as a floating force-directed **constellation** with
the source at the center. Any node expands to reveal *their* other credited collaborators,
recursively and indefinitely — an explorable universe of who-actually-recorded-with-whom.

**Primary purpose: library expansion, not music discovery.** The point is to browse the
collaboration universe and **pull artists/albums straight into Lidarr**. Sonic discovery
("what sounds like this") is Plexamp's job — we don't compete there.

Two things make it different from everything that exists:

1. **Provenance, not recommendation.** Edges mean "credited together on a record," never
   "listeners of X also like Y." This surfaces throughlines no recommendation engine can:
   a rock bassist → his solo LP → its flutist → Kronos Quartet.
2. **The graph *is* the download interface.** Every node is a "subscribe → Lidarr" target.

### Prior art (verified 2026-07-27)
- **DeepDiggr** (deepdiggr.com) — **real but obscure** (no press/GitHub/Reddit footprint);
  Discogs-powered expandable credit graph, ~9.9M artists / 20M collaborations. **No library
  integration** — pure visualization.
- **Lidarr discovery companions** — Sonobarr, Lidify, Aurral, **Digarr**. All list/grid UIs.
  Digarr even has a MusicBrainz "artist relationships" mode but renders it as a *list*, not a
  graph. (Worth studying its relationship-fetching code.)
- **Graph visualizers** — LivePlasma, discograph, Discogsgrapher. All read-only, no library.

**The gap, confirmed:** nobody fuses an explorable collaboration graph with send-to-Lidarr.
The moat is not the graph (DeepDiggr proves that's doable) and not Lidarr discovery (five
tools do it) — it's the **graph as the acquisition interface**. Unoccupied.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Purpose | **Library expansion** first; exploration toy second. Not sonic discovery (Plexamp's turf). |
| 2 | Edge meaning | **Pure collaboration** (credited-together). No similarity/recommendation edges. Real leaf nodes allowed. |
| 3 | Data backbone | **Discogs-primary** (liner-note credits), **MusicBrainz-secondary** (gap fill + typed roles). |
| 4 | Data strategy | **Dump-fed bounded cache**, toggleable: a **credit-only** local index (not the full dump) warms the taste-orbit; live API for the frontier. **Setting OFF** → live + listening-history prefetch + cold cache fill (no dump). |
| 5 | Nodes | **People only** (incl. groups); releases live on edges + per-person discography panel. |
| 6 | Modes | **Constellation** + **shortest-personnel-path** between two artists. |
| 7 | "Interestingness" | **Two orthogonal signals**: tie strength (edge thickness) + **bridge score** (edge glow). |
| 8 | Aesthetic overlay | **Genre = node color** (display + filter only). No computed "morph-delta" metric; no Plex sonic subsystem. |
| 9 | Layout | Force-directed physics; **discrete re-centering** (LivePlasma-style, with a fancy animated transition) + breadcrumb trail; free-pan as secondary zoom-out. |

---

## 3. Data sources & identity

### Sources
- **Discogs (primary).** Liner-note credits via `extraartists` (album-wide) +
  `tracklist[].extraartists` (per-track). Each credit carries an artist `id` → traversal
  stays in Discogs ID space. Roles semi-normalized (`Bass`, `Producer` + optional bracket
  detail like `[Fretless]`). **CC0 monthly dump** (data.discogs.com) contains all of it.
  - *Traversal caveat:* `/artists/{id}/releases` only says role=`"Appearance"`; specific
    roles require a per-release fetch. This is why we work from the local dump, not the
    live API (§4).
- **MusicBrainz (secondary).** Also liner-note-derived, typed/cleaner but sparser. Fills
  Discogs gaps; MB stores Discogs URLs → free join key. `inc=artist-rels,recording-rels,work-rels`.
- **Genius (tertiary).** Song-level writer/producer credits, used to enrich hip-hop/pop
  personnel where Discogs/MB are thin. Degrades gracefully if the Genius API is unreachable.
- **Explicitly NOT used:** Spotify (no credits; audio-features dead), AllMusic (commercial
  license only), Bandcamp (API shut, free-text), RYM/45worlds (no public API),
  AcousticBrainz (dead), Plex sonic (out of scope — library-expansion, not discovery).

### Identity (shrunk from swamp to puddle by the Discogs-primary choice)
The **collaboration graph stays entirely in Discogs artist-ID space** — no MB↔Discogs
person reconciliation for the graph itself. Matching survives only at the *edges*, and only
for artists in the user's own world (bounded):
- **"Owned" ring:** Discogs artist → MBID (via MB's stored Discogs URL) → **Lidarr** (MBID-keyed),
  and → Plex/Jellyfin by metadata. Only run for the user's library set.
- **Popularity:** Discogs artist → Last.fm for listener counts (node sizing).

`PersonIdentity` maps Discogs ID → {MBID, Lidarr, Plex, Last.fm} lazily, only as needed.

---

## 4. Architecture

Reuses existing Mixarr infra: shared **rate-limiter** (`discogs`/`musicbrainz` 1 req/s),
**job queue** (`apps/api/src/jobs`), **MariaDB**, **Redis**. New: a local Discogs dump index.

```
apps/api/src/
  services/constellation/
    DumpIndexService.ts    # download + parse Discogs CC0 dump into a local index
                           #   (artist_id -> release_ids, release_id -> credits[])
    OrbitCrawler.ts        # background: materialize taste-orbit from the index into cache
    GraphService.ts        # read/traverse the materialized graph (BFS, path, subgraph)
    ExpansionService.ts    # node expand: cache -> dump index -> live API fallback
    IdentityService.ts     # Discogs-ID -> MBID/Lidarr/Plex/Last.fm (edge-only, lazy)
    BridgeScore.ts         # neighbor-set-overlap; gated on both_endpoints_full
    RoleTaxonomy.ts        # normalize messy Discogs role strings -> role_bitmask + weight
    MasterDedup.ts         # collapse reissue releases -> master releases before counting
  services/discogs.ts (extend)     # extraartists parse + per-release credits + master_id
  services/musicbrainz.ts (extend) # relationship includes (gap fill)
  jobs/
    dump-import-worker.ts            # one-time / monthly dump index build
    orbit-crawl-worker.ts            # perpetual low-priority orbit warming
    constellation-expand-worker.ts   # on-demand frontier expansion (rate-limited)
apps/web/src/
  <ConstellationView>       # react-force-graph-2d; dense re-centering field (§8);
                            #   node color=genre, size=popularity, ring=owned,
                            #   thickness=tie-strength, glow=bridge(when confident)
  <ConstellationPlayer>     # persistent player: owned -> Deezer preview -> YouTube link-out
  <PersonPanel>             # discography + subscribe/Lidarr actions
  <PathFinder>              # two-artist path mode
```

### 4.1 Data model (MariaDB / Prisma)

The **graph is global** (shared across Mixarr users — one cache benefits everyone). The
**orbit seeds and the "owned" ring are per-user** and must be user-scoped.

```
Person         (person_id PK = discogs artist id, display_name, type)
PersonIdentity (person_id FK, source ENUM[mb,lidarr,plex,lastfm], external_id,
                confidence ENUM[linked,corroborated,manual])   # lazy, edge-only (§13)
CollabEdge     (source_person_id, target_person_id, weight FLOAT,
                bridge FLOAT NULL, bridge_confident BOOL,        # NULL/false until both ends full
                role_bitmask INT, shared_master_count INT,       # DEDUPED to master releases (§5)
                both_endpoints_full BOOL, sample_master_id, index_version,
                fetched_at, PRIMARY KEY(source,target))
PersonGenre    (person_id, genre, weight, source)               # aggregated across masters; coloring
OrbitState     (user_id, person_id, tier ENUM[hist1d,hist7d,hist30d,libtop,lib,frontier],
                last_crawled_at, status, PRIMARY KEY(user_id, person_id))   # per-user
OwnedArtist    (user_id, person_id, source ENUM[lidarr,plex,jellyfin])      # per-user ring
```
The Discogs **credit-only index** lives outside MariaDB (SQLite, §12) — read-mostly and
bulky; `CollabEdge` holds only the materialized taste-orbit (bounded). `index_version` on
each edge lets a dump refresh (§4.3) invalidate stale edges without a full wipe.

### 4.2 Data loading — dump-fed bounded cache (toggleable)

The `orbit-crawler` and `ExpansionService` are **source-agnostic**; a user setting picks
what they read from. Both modes share the same `CollabEdge` cache and the same crawler.

**Setting ON — credit-only local index (footprint + ingest cost, stated plainly):**
1. **Import (one-time / on refresh):** `dump-import-worker` streams the Discogs releases dump
   and extracts **only the credit graph** — `artist_id → release_ids`, `release_id →
   [{artist_id, role, tracks, master_id}]`, plus artist names/genres. Everything else is
   discarded, so the *resulting index* is far smaller than the raw dump. **Honest cost:** the
   *ingest* still downloads and stream-parses the full ~10GB-compressed / ~100GB-uncompressed
   releases dump — hours of parsing and large temp I/O, repeated each refresh. This is the real
   price of Setting ON; it is surfaced at setup, and the refresh cadence is user-set (§12) or
   skippable (run once, never refresh).
2. **Orbit crawl (perpetual, low priority):** seeds from listening history + library
   (Tautulli/Plex, Last.fm, ListenBrainz, Spotify recently-played), tiered by recency
   (1d → 7d → 30d → library-top → whole-library), materializing `CollabEdge`/`PersonGenre`
   into MariaDB. **Bounded by an edge budget, not by depth.** *Critical:* collaboration graphs
   are small-world — depth-3 from a large library (thousands of seeds) reaches essentially all
   of Discogs, so a fixed depth is NOT a bound. The crawler walks **breadth-first by tier until a
   configurable materialized-edge budget** (default ~250k edges, §12) is hit; nearer/hotter tiers
   fill first. This is what actually keeps the "bounded cache" bounded. **Convergence:** the
   crawler idles once the budget is full or a tier is exhausted, and re-wakes only on new
   listening history or library changes — it does not perpetually re-crawl a settled orbit.
3. **Frontier (on demand):** past the materialized orbit → cache → index → **live API** fallback.

**Setting OFF — live + prefetch (lightest footprint, no dump):**
- No index. The same `orbit-crawler` warms the taste-orbit via the **live Discogs/MB API**
  (slower, subject to the per-release role-fetch cost), and on-demand frontier expansion is
  **cold cache fill** from live API. Everything is cached as it's fetched.
- Honors a configurable daily API budget and runs below core-function priority.

Both modes: rate-limited worker, Redis per-person lock to dedupe, new nodes **stream via SSE**.
Each re-center bumps a **generation token**; SSE events tagged with a stale generation are
**discarded** client-side, so nodes still streaming in from a previous focus never leak into the
newly re-centered field (a real race the dense-field + re-center model would otherwise hit).
The **owned-ring resolution** (Discogs→MBID for visible nodes) runs on a **separate, lower
priority** than frontier expansion so ring-painting never starves exploration of the shared
1 req/s MusicBrainz budget; visible nodes are resolved in **batches**, cached forever.

### 4.3 Index refresh & staleness reconciliation
Each materialized `CollabEdge` stamps the `index_version` it was built from. On a dump
refresh (new `index_version`), edges are **not wiped**; they're lazily **re-materialized on
next visit** if their version is stale (and the orbit crawler re-walks the top tiers in the
background). This keeps the graph usable during/after a refresh without a global rebuild, and
bounds staleness to "one refresh cycle for cold regions."

---

## 5. Expansion engine — unbounded graph, bounded viewport

The graph is **infinitely explorable outward**; we cap only what's *rendered*, not what's
*reachable*. Distant nodes fade/collapse but persist in cache (instant return).

**Per-node legibility:**
1. **Tie strength** = `shared_master_count × role_weight × recency_decay`. **Counts DEDUPED
   master releases, not raw releases** — Discogs lists every pressing/reissue as a separate
   release, so counting releases would inflate canonical/popular collaborations by reissue
   count. `MasterDedup` collapses to `master_id` first (§4). Role weight: performer/producer
   high, composer mid, engineer low, artwork ~0 — mapped from raw role strings by
   `RoleTaxonomy`, which normalizes Discogs' messy multi-role/bracketed/multilingual credit
   text (a maintained taxonomy, not a one-liner). → **edge thickness**.
2. **Bridge score** = `1 − |N(a) ∩ N(b)| / |N(a) ∪ N(b)|` (collaborator-set overlap). Low
   overlap = the two live in different worlds = an interesting **bridge** (the rock→Kronos
   leap). → **edge glow**. *Confidence gate:* the score is only trustworthy when **both
   endpoints are fully materialized** (`both_endpoints_full`); at the frontier, incomplete
   neighbor sets make everything look like a false bridge, so glow is **shown only when
   confident**, muted/absent otherwise. *Strong ties keep you in a scene; confident bridges
   cross boundaries — the "worth looking at" highlighter.*
3. **Fan-out cap** — each node blooms **top-N** edges (default 8) by strength; "expand more"
   reveals the rest ("+37 more"). Legibility, not a reach limit.
4. **Role filter** — global toggle set (performer/producer/composer/engineer/…) via `role_bitmask`.

**Navigation — dense field + re-center (see §8):**
- **Dense standing field** — render a rich neighborhood (~50 nodes across 2–3 rings) around the
  current focus, LivePlasma-style, rather than an endless pannable canvas.
- **Re-center to go "outward"** — clicking any node smooth-animates the whole field to re-center
  on it and blooms *its* neighborhood; a breadcrumb trail records the walk. "Infinite" means you
  can always re-center one step further out — reach is unbounded, the *view* is a neighborhood.
- **Predictive prefetch** — warm the clicked node's neighbors (from index or API) before the
  re-center animation completes, so the new field is ready on arrival.

**Honest tradeoff — real leaves.** A true collaboration graph has genuine dead-ends (an
obscure session player with two credits). Infinite *in aggregate*, terminal on some twigs.
Leaves render as visibly *settled*, not "loading forever" — a dead-end is a true fact about
a career, not a bug. (Deliberately chosen over similarity-padding.)

**Safety:** visited-set (no A→B→A cycles); non-person entities (Various Artists, `[unknown]`,
orchestras-as-credit) blacklisted from expansion and hard-capped in fan-out.

---

## 6. Genre overlay (replaces the old morph-delta subsystem)

No computed "aesthetic distance" metric, no Plex sonic layer (out of scope §2). Instead,
genre is a **visual channel** that lets the eye *see* the throughline emerge:
- **Node fill = dominant genre.** Discogs genres/styles are **per-release**, so a node's color
  is the **weighted-mode genre aggregated across that artist's master releases** (`PersonGenre`).
  *Honest limit:* cross-genre artists and session hired-guns have no single true genre — they
  render in a **blended/neutral hue** rather than a false single color, so the map doesn't lie
  about them. The "rock→Kronos" transition shows as a color *drift* across a re-centering walk,
  not a precise gradient.
- **Genre granularity:** top-level Discogs genres are too coarse (~15) and styles too many
  (hundreds) for a legible palette, so color maps to a **curated mid-level genre grouping**;
  full styles remain available as node metadata/filters.
- **Genre filter / highlight** — dim all but a chosen genre, or highlight where genre changes
  along a path, to trace a stumble from one world to another.
This makes the throughline **emergent** (color drift + confident bridge glow + thick lineage
lines), with no dishonest metric anywhere.

---

## 7. Two modes (one engine)

- **Constellation (explore)** — seed album/artist, re-center outward. Default view.
- **Path (six degrees)** — two artists over materialized edges, filling missing hops on demand:
  - **Shortest path (default)** — **bounded BFS** (≤ `max` degrees, default 6); bails "no path
    within 6 degrees" rather than traversing forever. Cheap. *Honest caveat:* the shortest path
    usually routes through a **hub** (a mega-producer/"Various"), so it's often true-but-dull.
  - **"Interesting path" (opt-in)** — bounded **k-shortest-paths** ranked by **cumulative bridge
    score**, preferring boundary-crossing chains over hub-shortcuts. Explicitly **more expensive**
    (multiple path candidates over a lazily-fetched graph) and the interesting path is usually
    **longer** than the shortest — that cost is real and is surfaced (a "searching…" state), not
    hidden. Capped at `max`+2 degrees and a candidate budget.

---

## 8. Constellation UX & discovery loop

Aesthetic/interaction target: **LivePlasma**, plus library-aware powers it can't have.

**Visual channels (all honest, no fake metric):**
- **Node size = prominence** (+ "hide hotness" toggle). **Not just Last.fm listeners** — that
  only works for lead artists and would render the session players (the *point* of the concept)
  tiny. Prominence = `max(lead-artist popularity via Last.fm, intra-graph credit prominence)`,
  where credit prominence = summed tie-strength / credited-master count. So a famous headliner
  sizes by fame; a ubiquitous session player sizes by **how much they're credited** — which is
  the truer story anyway (session ubiquity, not headliner fame).
- **Node color = genre** (§6).
- **"In your library" ring** — colored ring on owned nodes (Lidarr/Plex/Jellyfin). Turns
  the map into a live "gaps in my collection" surface.
- **Edge thickness = tie strength**; **edge glow = bridge score**; red = direct links to focus.

**Interactions:**
- **Discrete re-centering** — click a node, smooth-animate it to center (a deliberately fancy
  transition), bloom neighbors, fade the far side, drop a **breadcrumb trail**. Matches
  "stumble along a path node-to-node," and dissolves the physics-jitter + render-budget
  problems that continuous free-pan creates. Free-pan kept as a secondary "see the whole
  constellation" zoom-out.
- **Hover mini-actions** — ▶ play + ＋ subscribe inline (skip the panel).
- **Player** — a node's **representative track** is a track from its **strongest collaboration
  edge** (the master behind its fattest tie), *not* a Last.fm "top track" — because session
  players have no top track as themselves, but they demonstrably appear on their strongest
  collaboration. So node playback plays something they're genuinely on. An **edge** plays a track
  from that actual shared master. Fallback chain: **owned (Plex/Jellyfin) full playback → Deezer
  30s preview → "open in YouTube" link-out**. (No YouTube Data API: its ~100-search/day quota can't
  back seamless in-app embeds, and scraping violates ToS — so YouTube is an honest link-out, not
  in-app audio.) Match at representative-track level; degrade gracefully to "play this artist"
  rather than "unavailable." Show a source
  badge (▶ owned / ▶ Deezer preview / ↗ YouTube).

**Discovery loop — mind the acquisition grain.** Lidarr monitors **artists** (and their
albums); nodes are **people**. For a *lead artist* node, "add to Lidarr" is meaningful
(monitor their discography). For a *session player* node it is usually **not** — monitoring a
bassist-as-artist yields an empty/tiny discography; what the user actually wants is the
**album the collaboration produced**. So the acquisition target is generally an **album (master
release), reached via the discography**, not the person node:
- **Node hover "＋"** → for lead artists, "monitor this artist"; for non-lead personnel it
  **opens `PersonPanel`** to pick a specific release rather than blindly monitoring an empty artist.
- **`PersonPanel`** lists the person's credited master releases; each carries the existing
  **add-to-Lidarr / subscribe** action (which adds that album's **primary artist**, monitoring
  that album) feeding Mixarr's review queue.
No new acquisition code — the constellation is a new *front-end* onto the existing subscription
system. Explore → spot what you don't own (ring) → hear it (player) → grab the **album**
(Lidarr), without leaving the graph.

---

## 9. Failure modes & degradation (independent)

| Dependency | Behavior |
|---|---|
| Discogs dump not yet imported | Live-API-only mode (slow) until index builds; UI shows warming state |
| Discogs API down | Serve materialized orbit + index; frontier expansion paused |
| MusicBrainz down | Thinner gap-fill; Discogs carries |
| Plex/Jellyfin/Lidarr absent | No "owned" ring / owned-playback; Deezer preview + YouTube link-out still work (subscribe disabled if no Lidarr) |
| Last.fm down | Uniform node sizing (no hotness) |
| Rate-limit contention | Crawler/expansion run below subscription/enrichment priority |

---

## 10. Non-goals / YAGNI
- No sonic-discovery / "morph-delta metric" / Plex sonic subsystem (Plexamp's turf).
- No similarity/recommendation edges (pure collaboration; leaves allowed).
- No MB↔Discogs person reconciliation for the graph (Discogs-ID space; edge-only matching).
- No hard exploration ceiling (only the render budget is bounded).
- No new infra beyond the local dump index — sizing/ring/player reuse existing integrations.

---

## 11. Design attack gate — results

Ran rubber-duck, hostile-operator, and best-practices lenses; issues folded into the design.

**Resolved:**
1. **Identity reconciliation** (was project-eating) — Discogs-primary keeps the graph in one
   ID space; matching is edge-only, lazy, bounded to the user's library (§3).
2. **Cold-path latency** — dump-fed bounded cache + orbit crawler make the user's world warm
   from a *local* file; only the true frontier hits the slow API (§4.2).
3. **Discogs per-release role fetch cost** — sidestepped by working from the local dump index.
4. **Rate-limit starvation & API etiquette** — crawler reads local dump (no API load);
   frontier fetches run below core-function priority with a configurable budget (§4.2, §9).
5. **Combinatorial explosion / hubs** — top-N fan-out + role filter + render budget + mega-node
   blacklist; path mode bounded-BFS and **bridge-ranked** to avoid boring hub-shortcuts (§5,§7).
6. **"Interesting" edges were being suppressed** by strength-only ranking — added bridge score
   as an orthogonal, separately-visualized signal (§5).
7. **Cycles** — visited-set (§5). **Concurrent fetches** — Redis per-person lock (§4.2).
8. **Physics jitter vs. infinite pan** — dense-field + discrete re-centering interaction (§5, §8).
9. **Lossy playback matching** — owned → Deezer → YouTube link-out; representative-track,
   graceful degradation (§8).

**Second attack pass (post Discogs-primary) — resolved:**
10. **Reissue duplication corrupting tie-strength** (a real bug) — Discogs counts every pressing
    as a release; `MasterDedup` collapses to `master_id` and edges count `shared_master_count`
    (§4.1, §5). Without this, weight tracked reissue count, not collaboration.
11. **Discogs role-string mess** — a maintained `RoleTaxonomy` normalizes multi-role/bracketed/
    multilingual credits into `role_bitmask` + weight; named as a first-class component (§4, §5).
12. **Bridge-score false positives at the frontier** — gated on `both_endpoints_full`; glow shows
    only when the metric is trustworthy (§5).
13. **Credit-only index hides ingest cost** — index is small but building it still parses the full
    ~100GB dump; stated at setup, refresh user-set/skippable (§4.2).
14. **Per-user vs. shared cache** — graph is global; `OrbitState`/`OwnedArtist` are user-scoped (§4.1).
15. **Owned-ring vs. frontier budget contention** — ring resolution runs at lower priority, batched (§4.2).
16. **Index-refresh staleness** — `index_version` per edge; lazy re-materialization, no global wipe (§4.3).
17. **YouTube playback overstated** — corrected to link-out (quota/ToS reality) (§8).
18. **Genre-color ambiguity** — cross-genre artists render neutral, not a false single hue; curated
    mid-level genre grouping for a legible palette (§6).
19. **Shortest-path is dull, interesting-path is costly** — both offered explicitly; the opt-in
    interesting path surfaces its cost, doesn't hide it (§7).

**Third attack pass (pre-implementation) — resolved:**
20. **"Bounded orbit" wasn't actually bounded** (a real design flaw) — small-world reachability
    means depth-3 from a large library ≈ all of Discogs. Re-bounded by a **materialized-edge
    budget**, breadth-first by tier, not by depth (§4.2). This repairs the premise the whole
    data strategy rests on.
21. **Acquisition grain was wrong for session players** — node-level "monitor artist" is useless
    for non-lead personnel; the real target is the **album** via the discography panel (§8).
    Strikes at the moat, now corrected.
22. **SSE nodes leaking across re-centers** — generation token discards stale events (§4.2).
23. **Bridge/genre parity between modes** — `both_endpoints_full` (and full genre aggregation)
    are only reliably computable from the **index (Setting ON)**; in Setting OFF the bridge glow
    is best-effort and often absent, and genre is partial. Honest asymmetry: Setting ON is the
    richer experience; Setting OFF trades feature-richness for zero footprint. Stated, not hidden.
24. **Seed resolution can fail** — a library artist/album (MBID) may not resolve to a Discogs
    entity; fall back to Discogs name search + user disambiguation, or a clear "not in Discogs"
    state (§13 mechanism, reused).
25. **Dense-field node math** — the ~50-node field = focus + ring-1 (top-N) + a **pruned** ring-2
    (not top-N², which would overflow); "expand more" replaces the field via re-center rather
    than cramming (§5, §8).

**Convergence/idle:** the orbit crawler idles at budget/exhaustion and re-wakes only on new
history/library changes — no perpetual re-crawl (§4.2).

**Config consistency:** needs MariaDB + Redis (present) + local disk for the credit index +
optional Plex/Jellyfin/Lidarr. No new services.

**Verdict:** Passed after three attack passes. The one irreducible operational cost is the
Setting-ON dump ingest (download + parse ~100GB per refresh); surfaced at setup, and fully
avoidable via Setting OFF (live + prefetch, with the honest feature-richness tradeoff in #23).
No remaining architectural contradictions.

---

## 12. Settled implementation parameters

These are decided, not open. All are exposed as user settings with the defaults below.

- **Credit-only index store:** **SQLite** (embedded, indexable, single-file, fits the
  self-hosted model; no extra service). Two indexed tables — `artist_id → release_ids`,
  `release_id → [{artist_id, role, tracks}]` — plus an `artist(id, name, genres)` table.
- **Identity reconciliation:** fully specified in §13.
- **Viz library:** **`react-force-graph-2d`** (Canvas/WebGL; handles the ~300-node render
  budget with room to spare; native force physics for the floating look).
- **Defaults (all user-adjustable):** fan-out `N = 8`; **orbit materialized-edge budget
  `= 250k` (the real bound, §4.2)**; orbit-crawl depth `= 3` (soft guide within the budget);
  dense-field size `≈ 50` nodes (focus + ring-1 + pruned ring-2); path-mode max degrees `= 6`;
  daily frontier-API budget `= 5000` requests; index refresh `= monthly` (or skip).

## 13. Identity reconciliation (decided)

Scoped down by Discogs-primary. Two faces, one join key (MB's stored Discogs URL):
- **Outbound (Discogs → MBID):** required for the "owned" ring **and the Lidarr add path**
  (Lidarr adds by MBID). The graph-as-download-interface hinges on this resolving.
- **Inbound (MB gap-fill → Discogs):** merge secondary MB-sourced nodes into the Discogs-ID
  graph so the same person isn't duplicated.

**Resolution mechanism — lazy live lookup, cached (no dump crosswalk):**
- Resolve via `GET /url?resource=discogs.com/artist/{id}&inc=artist-rels` (and the reverse for
  inbound). Only ever run for **visible nodes + the user's library set** (hundreds, bounded),
  cached forever in `PersonIdentity`. Works identically whether the credit-index is on or off;
  needs no MusicBrainz dump. (Rejected the dump crosswalk as an unneeded second dump dependency.)

**Residue (no clean MB link) — corroborated auto + manual fallback:**
- Try fuzzy name-match but **auto-accept only when corroborated** — the MB candidate's
  discography overlaps the Discogs artist's releases (shared release titles/years), or
  disambiguation comment matches. High-confidence → resolve silently and cache.
- Otherwise → surface a **"link to MusicBrainz" picker**; the user confirms once, we cache it.
  Never silently fuse two different people (rejected aggressive auto-match).

**No-MB-entity case:** a Discogs-only artist with no MB presence at all stays fully
**explorable** (browse, play via Deezer/YT) but its **subscribe→Lidarr action is disabled**
with a tooltip ("not in MusicBrainz — can't add to Lidarr"). Honest acquisition dead-end;
the node is not removed from the graph.
