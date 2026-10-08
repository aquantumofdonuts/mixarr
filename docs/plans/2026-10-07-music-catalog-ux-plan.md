# Mixarr Music Catalog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **For Codex:** Read the repository's executing-plans skill, or subagent-driven-development when executing an approved same-session plan. This document authorizes planning, not an automatic start of implementation.

**Goal:** Implement all 25 UI/UX recommendations and a distinctive music-catalog identity built around artwork, source provenance, release chronology, collaborator credits, and truthful acquisition outcomes.

**Architecture:** Extend the existing Next application, shared primitives, TanStack Query hooks, and authenticated Express routers. Add one shared artist inspector and narrow typed contracts; retain existing identity resolution, Lidarr operations, graph lifecycle, and authorization. Use existing records and Node crypto for recovery; no new UI framework, dependency, universal event ledger, or database migration is planned.

**Tech Stack:** Next 15 / React 18, TypeScript, Tailwind 3, next-themes, TanStack Query 5, Lucide, Express, Prisma, Zod, existing Redis/Lidarr/provider services, Vitest, Testing Library, Playwright.

**Design:** [Music catalog visual and interaction design](2026-10-07-music-catalog-ux-design.md). Its R01–R25 and I01 acceptance table is the immutable requirement set for the completion audit.
**Status:** Independently reviewed; ready for execution. No implementation task is complete.
**Planning source revision:** `1e785fd`; refresh HEAD and relevant diffs at execution start. Other work landed during planning.

---

## 1. Execution rules and sequencing

Start implementation in a clean isolated worktree using `.github/skills/using-git-worktrees/SKILL.md`. Read AGENTS.md, docs/ISSUES.md, the design, and current source. Do not reset, stage, or copy another session's uncommitted changes. Preserve the current constellation API-budget/identity work. If source has moved, update exact implementation edits before executing, without silently dropping a requirement.

The tasks below are grouped by dependency, not by the order the critique was delivered. Each numbered step is one bounded action; finish its named behavior and check before moving on. A task may require several small passing cycles. Behavior changes get meaningful regression tests; purely reversible spacing/style edits use rendered checks rather than tests that assert Tailwind classes. TDD is used only if requested. Scoped commits follow passing checks, and have no Co-Authored-By trailer.

| Batch | Tasks | Deliverable / review gate |
|---|---|---|
| A | T01–T06 | Baseline fixtures, tokens, primitives, shell, URL/selection behavior |
| B | T07–T10 | Honest acquisition, Undo, provenance and artist detail contracts |
| C | T11–T15 | Inspector, feed, summaries and subscription navigation |
| D | T16–T19 | Search/add behavior, label traversal and seed discovery |
| E | T20–T22 | Full queue and library navigation |
| F | T23–T27 | Settings, services, downloads, named graph entry and remaining screens |
| G | T28–T30 | Browser evidence, completion matrix, full review and fresh verification |

Execute batches sequentially. Within a batch, shared hooks/primitives/source files are serial work. Use requesting-code-review and the repository's four lenses after each task/batch. Do not merge a half-migrated palette or expose Undo before its authenticated restore route exists. Feature commits can remain local until the integrated batch is reviewed; external publication is a separate action.

### Exact command conventions

Run commands from the repository root unless `cd` is explicitly shown. `npm exec --workspace @mixarr/web -- vitest run <path>` resolves paths relative to `apps/web`; API paths are relative to `apps/api`. For a new test, first run that path; expected output is the named cases passing and exit 0, not a predetermined invented count. Type commands must also exit 0:

```bash
npm run typecheck --workspace @mixarr/shared-types
npm run build --workspace @mixarr/shared-types
npm run typecheck --workspace @mixarr/api
npm run typecheck --workspace @mixarr/web
git diff --check
```

The shared-types build must precede consumer checks because consumers resolve its `dist` exports. Before each commit run the task's checks and `git diff --check`, stage only its named files, then `git commit -m '<task message>'`. Do not use `git add .`. No `db:push --accept-data-loss` is part of this plan.

## 2. Contracts and implementation decisions

### A. Artist/source contract

Create `packages/shared-types/src/artist.ts`; export it from `src/index.ts`. Use the following complete data contract, not per-component versions:

```ts
export type AcquisitionState =
  | 'available' | 'adding' | 'added' | 'already-in-library'
  | 'failed' | 'uncertain' | 'identity-required' | 'connection-required';

export interface ArtistSourceRecord {
  key: string; // e.g. subscription-result:123 or review-item:456
  kind: 'subscription-result' | 'review-item';
  label: string;
  subscriptionId: number | null;
  runId: number | null;
  recordedAt: string;
  recordStatus: string; // raw stored decision, never translated to Lidarr success
  sourceUrl: string | null; // validated http(s) only
}

export interface ArtistDetail {
  mbid: string;
  name: string;
  imageUrl: string | null;
  disambiguation: string | null;
  membership: 'in-library' | 'not-in-library' | 'unknown';
  sources: ArtistSourceRecord[];
  sourcesNextCursor: string | null;
  unavailable: Array<'metadata' | 'membership' | 'sources'>;
}

export interface AcquisitionOutcome {
  artistMbid: string;
  state: 'added' | 'already-in-library' | 'failed' | 'uncertain';
  message: string;
}

export interface UndoDecisionResponse {
  undoToken: string;
  undoExpiresAt: string;
}

export interface LabelArtistPage {
  artists: Array<{ id: string; name: string; sortName: string; imageUrl: string | null }>;
  releasesProcessed: number;
  totalReleases: number;
  nextReleaseOffset: number | null;
}
```

Do not claim all artist-source records fit one response. Artist detail accepts `sourceLimit=50` and opaque `sourceCursor`; return `sourcesNextCursor` as shown in the contract when wiring T09/T10. Source rows are ordered by stored `(createdAt, kind, id)` and returned with their original scope. Provider descriptions are sanitized text only. Use existing metadata endpoints for releases, with their own pagination/error state. Adding an image URL must not manufacture an identity match by name.

### B. URL and stable-selection helpers

In `apps/web/src/lib/list-state.ts`, implement these pure helpers and consume them from real pages. The parser bounds numeric values and preserves unrelated query state:

```ts
export function readPage(value: string | null): number {
  if (!value || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? Math.min(Math.max(page, 1), 10000) : 1;
}

export function updateQuery(
  current: URLSearchParams,
  patch: Record<string, string | null>,
): string {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `?${query}` : '';
}

export function retainSelection(selected: ReadonlySet<string>, available: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter(id => available.has(id)));
}

export function removeActedItems(selected: ReadonlySet<string>, succeeded: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter(id => !succeeded.has(id)));
}
```

Use `mbid` for identified artists, album MBID/provider release ID for albums, numeric review/result IDs for server records, and provider-prefixed stable IDs for unresolved results. Never use array position or artist name when a provider ID exists. If a provider supplies only a name, retain a result-scoped generated key for that request; do not pretend it persists across unrelated searches.

Cursor URLs use the server cursor rather than `readPage`. Store only visited cursor history in the page session for Previous; matching count and an explicit “Back to first page” handle direct links. Filter changes clear cursor history. URL state changes drive query keys, not a second disconnected `useState` copy. Discrete navigation uses push; typing uses debounced replace and cancels its timer/request on replacement/unmount. Keep previous successful data visibly marked while a new request is pending.

### C. Acquisition state machine

T07 replaces detached feed approval with an awaited, bounded call to existing `addArtistWithCacheWarm`/`getArtistByMbid` behavior. Confirm outcomes before marking `SubscriptionResult.added`. Update the route/hook response together. Feed mutation timeout is 70 seconds, exceeding the 60-second server operation deadline; the existing API helper must expose per-call timeout/signal and preserve typed error codes/details. A browser disconnect/timeout still means uncertain, and the next read/retry reconciles server state. Do not globally lengthen unrelated requests.

1. Parse and deduplicate every linked result ID; reject an empty, malformed, oversized (>100), missing, foreign-owned, mixed-MBID, or ineligible aggregate. Return 404/403 according to existing route policy without exposing foreign details. Missing MBID returns 422 `IDENTITY_REQUIRED`; missing applicable Lidarr returns 409 `CONNECTION_REQUIRED`. Neither changes status.
2. In a short transaction conditionally claim all eligible `pending`/`queued`/retryable `failed` records as `adding`, using one `processedAt` claim timestamp. Compare affected count with requested count; rollback on mismatch. A second request seeing a fresh claim returns 409 `IN_PROGRESS` and never calls Lidarr. A stale claim is one older than two minutes; recovery reconciles membership first. Reclaim conditionally against its exact original status/timestamp so only one contender wins.
3. Outside the transaction perform the existing canonical-MBID membership lookup/add. Thread a shared 60-second operation deadline through membership, option lookup, SkyHook warm and add requests using real AbortSignals, and cap each provider request at 30 seconds. The total deadline includes retries/backoff, rate-limit waits, config lookup, cache/SkyHook warming and all nested requests; abort-aware waits must exit before starting another side effect. The 120-second claim lease therefore exceeds the bounded live operation; do not use `Promise.race` to abandon a still-running side effect. Do not add an independent worker/queue.
4. On confirmed membership, update only records still holding this claim to `added` and set the confirmation time. Delete corresponding review records only with `userId` **and** exact MBID. Never delete a name-only match. Return `added` or `already-in-library` as the actual result.
5. On a definite provider rejection store `failed` with a sanitized error; on timeout/unreachable outcome store `failed` with a machine-readable uncertain reason and return `uncertain`. Retry first reconciles canonical membership. A process crash may leave `adding`; the next explicit retry recovers the stale claim. No error path converts an uncertain operation into green success.
6. Existing counts/aggregation must recognize `adding` and `failed` so rows remain visible, with Retry for failures. Eligible pending counts exclude in-flight/failed outcomes unless the label explicitly includes them. Do not count `ReviewItem.approved` as confirmed Lidarr membership without verification. Existing logs/cache invalidation must be updated when outcomes change.

Two distinct feed aggregates for one MBID can still reach the provider concurrently. The existing canonical lookup and Lidarr's stable identity must make that safe; treat a duplicate-provider response as success only after exact-MBID membership lookup. Test this case. This is a truthful bounded HTTP operation, not a guarantee of exactly-once distributed execution. No lease can safely imply that a provider side effect never happened.

Apply the same user-visible truth rules to search, queue, recommendation, and subscription result add responses. Missing-MBID subscription approvals return IDENTITY_REQUIRED without a name-based guess; a validated explicitly chosen MBID is persisted only for the owned result before claim/acquisition. Single/bulk review approvals follow the same rule in T20. Their existing awaited logic remains unless investigation proves it lies; do not rewrite unrelated workers for symmetry. Match settings to the effective provider operation, not a cosmetic options form.

### D. Undo protocol

Add authenticated `POST /api/feed/restore` **before** any conflicting dynamic route and `POST /api/imports/review/restore`. Body: `{ undoToken: string }`. Successful dismiss/reject responses return `UndoDecisionResponse`. Restore returns `{ restoredIds: [...] }`. Reuse existing router registration; no new index.ts mount is needed.

Implement `apps/api/src/lib/decision-undo.ts` using `node:crypto`, Zod, and the configured `SESSION_SECRET`. Serialize a validated payload to base64url; sign the **exact encoded bytes** with HMAC-SHA256 using the domain prefix `mixarr:decision-undo:v1:`; append signature as `payload.signature`. Validate lengths before timing-safe comparison; bound encoded token to 32KB and items to 100. The payload contains version, actor userId, decision kind, issued/expiry timestamps (two-minute maximum), and each record's table kind, ID, original status, post-decision revision, and original state fields required for restoration. Feed revision is decision `processedAt`; review revision is `updatedAt`. No metadata or credentials are included.

Verify auth, signature, schema, actor, action, expiry, ownership, and all current revisions inside a transaction before updating. Conditional restore must affect every token row or rollback with 409. Restore the exact original eligible status (pending/queued/failed for feed; pending for review), but advance the revision timestamp again rather than restoring its old nullable value. For SubscriptionResult, processedAt becomes the last decision/claim revision even on a restored pending row; confirmed-add chronology is read only for added status, and record discovery time remains createdAt. For ReviewItem, explicitly advance updatedAt. Every relevant writer sets the new revision to max(now, previousRevision+1ms), with a conditional expected-status/revision update in a transaction. Reject no-op same-state decisions. This preserves a high-water revision under a frozen clock and prevents reject→restore→reject from reusing an older token. Replay fails because the monotonically advancing revision/status no longer equals the post-decision state. Scope/count checks and monotonic revision writes must apply to every competing decision writer, including existing subscription result approve/reject routes. Review rejects update status without deleting the record. Feed dismissal must retain restorable review records and include them in its snapshot if it changes them; remove existing name-based/unscoped delete behavior. No token-less general restore endpoint exists.

The UI exposes Undo for ten seconds, sends a server restore immediately on click, and invalidates affected query scopes only after success. It does not delay the original mutation. Do not reuse the OAuth state helper's shallow JSON key filtering for nested item snapshots. Never log tokens or put them in query strings/sessionStorage. If a token cannot be generated, do not advertise Undo; fail the reversible operation before mutating when signing configuration is unavailable.

### E. Queue and label pagination

Queue `GET /api/imports/review/queue` accepts existing status/itemType plus `q` (trimmed, max120), `limit` (1–100, default50), and validated opaque cursor. Query `(createdAt DESC, id DESC)`, `take: limit+1`; decode cursor into strict timestamp/positive ID and apply a tie-safe bound. Use one shared `where` scope for page and matching count; preserve admin-wide behavior only where the existing API permits it. Response `{ items, total, nextCursor }`. Artist/album text search belongs in the database and the existing database's supported case-insensitive collation, not on the first 500 returned rows. Never interpolate SQL. Do not pass Prisma's unsupported insensitive mode to a provider that cannot use it.

Label `GET /api/search/label/:mbid/artists` keeps its route but returns `LabelArtistPage`. Validate MBID UUID, limit<=100, offset>=0. `nextReleaseOffset` uses **raw releases fetched**, not artists extracted. `totalReleases` comes from the MusicBrainz release response. Deduplicate accumulated artists by MBID in the client, including across pages. Progress says “N releases checked; M artists loaded”; filter says “Search loaded artists”. A filtered zero-match state retains Load more while a release cursor exists. Full enumeration is user-controlled and respects provider throttling; do not prefetch an entire label on opening.

## 3. Tasks

### T01: Establish fixtures and behavioral baseline

**Requirements:** All; infrastructure for R08/R24/R25/I01. **Depends on:** none.

**Files:** Modify `apps/web/e2e/fixtures.ts`; create `apps/web/e2e/catalog-fixtures.ts` for the isolated catalog API mocks. Create `apps/web/e2e/catalog-baseline.spec.ts`. Read `apps/web/playwright.config.ts`, existing e2e auth helpers, and `apps/web/src/lib/auth.tsx`.

1. Record current HEAD, tracked cleanliness, current route/theme behavior, and screenshots for feed/search/subscriptions/queue/connections/downloads/settings/constellation. Save evidence under a task-specific ignored `/tmp` directory; never commit actual credentials or personal data.
2. Build deterministic request fixtures using actual API shapes: username-based auth, same-name distinct MBIDs, missing artwork/MBID, multiple sources, pending/failed adds, long names, empty/error responses, and >500 queue records. Use existing local assets or fixture-generated neutral images, not external artwork requests.
3. Add browser smoke cases for navigation, an artist action, and mobile drawer role visibility. Fixtures should fail loudly on unhandled `/api/` calls; allow the required auth/health/settings routes explicitly.
4. Run `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-baseline.spec.ts --project=chromium`; expect authentic route rendering with deterministic fixtures. Record existing failures before changing production code.
5. Commit only fixture/spec changes: `test(web): establish catalog interaction fixtures`.

### T02: Replace active theme and font tokens

**Requirements:** R01/R06/R08. **Depends on:** T01.

**Files:** Modify `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`, `apps/web/src/styles/themes/index.css`, `apps/web/tailwind.config.ts`, `apps/web/src/styles/themes/README.md`. Create `apps/web/src/styles/themes/catalog.css` and `apps/web/src/lib/__tests__/catalog-contrast.test.ts`. Read `apps/web/src/lib/themes.ts` and remove it only after proving it has no consumers.

1. Remove DM_Sans/next-font usage; set the three supplied system font stacks. Create light/dark tokens from design §5 with existing HSL token aliases so current Tailwind consumers still work; import catalog.css as the sole active theme. Keep `data-theme`, system mode, and SSR hydration behavior.
2. Configure dark utilities to follow `[data-theme="dark"]` using the installed Tailwind version's selector strategy; check generated dark utilities rather than adding a second class toggle. Remove warm defaults and hard-coded decorative accents when encountered.
3. Make the contrast test read actual catalog.css declarations. Convert hex/HSL to sRGB, compute relative luminance and `(lighter+.05)/(darker+.05)`. Assert >=4.5 for rendered body/meta/button/status text pairs and >=3 for focus/control boundaries against adjacent backgrounds, both modes. Test a known black/white pair against 21 to validate the arithmetic.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/catalog-contrast.test.ts` and web typecheck; render light/dark/system screenshots. Adjust proposed meta/focus/divider values where these checks require it.
5. Commit: `style(web): establish neutral catalog themes and system type`.

### T03: Normalize shared primitives and page headers

**Requirements:** R02/R03/R04/R05/R06/R25. **Depends on:** T02.

**Files:** Modify `apps/web/src/components/ui/button.tsx`, `card.tsx`, `input.tsx`, `select.tsx`, `checkbox.tsx`, `tabs.tsx`, `modal.tsx`, `apps/web/src/components/layout/page-header.tsx`, and `apps/web/src/app/globals.css`. Create `apps/web/src/components/ui/__tests__/controls.test.tsx` and `apps/web/src/components/ui/__tests__/modal.test.tsx`.

1. Set 4px radii, neutral fills, outline secondary buttons, ink/slate primary hover, visible focus, and touch hit areas. Remove card translate/glow and decorative status variants; retain overlays' minimal shadow. Do not break existing loading/disabled semantics.
2. Use native input/select/checkbox semantics and associated labels; make the shared header 18px/600 with wrapping actions. Disclosure controls use one chevron rotated by CSS over 0.14s, with reduced-motion override.
3. Delete duplicated `.btn`/`.card` styles only after consumers resolve to the shared owners. Do not introduce another parallel component family. Test label association, keyboard activation, disabled/loading prevention, and indeterminate native checkbox behavior. Repair modal focus trapping/restoration, disabled/hidden focusable filtering, double onClose and body-lock cleanup here; keep header/footer outside body scroll so T04 can reuse it.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/ui/__tests__/controls.test.tsx src/components/ui/__tests__/modal.test.tsx` and web typecheck; visually inspect an existing form and table in both themes.
5. Commit: `refactor(web): unify catalog controls and headers`.

### T04: Align shell and authorized responsive navigation

**Requirements:** R04/R13/R24/R25. **Depends on:** T03.

**Files:** Modify `apps/web/src/components/layout/sidebar.tsx`, `protected-layout.tsx`, `mobile-nav.tsx`. Create `apps/web/e2e/catalog-navigation.spec.ts`. Create `apps/web/src/components/layout/navigation.ts` only if desktop and mobile actually share a second consumer.

1. Align sidebar/main topbar at 57px and reduce content padding. Use grayscale active states and concise section labels. Preserve existing route paths and admin visibility.
2. Implement the narrow-screen menu/drawer using the same role-filtered items. Reuse the modal focus behavior completed in T03; verify drawer focus restoration and Escape behavior. Remove or replace the dormant unfiltered MobileNav instead of mounting it unchanged.
3. Preserve `pathname + search` in the auth return URL and reject external return targets using the existing auth safeguards. Check labels/focus order/long usernames.
4. Run `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-navigation.spec.ts --project=chromium`; expect admin/member destinations correct, query preserved through login, and 320/390/1024px navigation usable.
5. Commit: `feat(web): align catalog shell and mobile navigation`.

### T05: Wire URL state and list-context restoration

**Requirements:** R10/R13. **Depends on:** T04.

**Files:** Create `apps/web/src/lib/list-state.ts`, `apps/web/src/lib/__tests__/list-state.test.ts`, `apps/web/src/hooks/useListContext.ts`, `apps/web/src/hooks/__tests__/useListContext.test.tsx`. Modify `apps/web/src/components/layout/protected-layout.tsx` for the actual scroll element reference and `apps/web/src/lib/api.ts` to accept an optional AbortSignal. Compose it with the existing timeout signal; TanStack query functions pass their signal so obsolete reads really cancel.

1. Implement contract B; test invalid/huge page numbers, preserved query parameters, repeated seeds, cursor reset on filter change, and stable selection helpers.
2. Add the narrow list-context hook used by the inspector/list pages. Capture the actual scroll container, parent URL, and trigger element before opening; restore after data/layout readiness without an arbitrary timeout. Cancel restoration when the user scrolls or changes list scope.
3. Store bounded scroll/selection state in session memory/storage keyed by route+committed query, excluding credentials/tokens. Direct-link closure removes only the inspector parameter and leaves the current parent state intact. Explicit cursor pages push history; typing replaces.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/list-state.test.ts src/hooks/__tests__/useListContext.test.tsx`; expect Back/direct-link/unmount behavior and cleanup verified.
5. Commit: `feat(web): preserve catalog URL and drilldown context`.

### T06: Implement actionable feedback, result states, and bulk scope

**Requirements:** R15/R22/R25. **Depends on:** T03/T05.

**Files:** Modify `apps/web/src/components/ui/toast.tsx`. Create `apps/web/src/components/ui/result-state.tsx`, `bulk-toolbar.tsx`, and `apps/web/src/components/ui/__tests__/feedback.test.tsx`. Reuse existing loading/empty components where their semantics fit.

1. Add toast `action: { label, onClick }`, live announcements, ten-second undo option, timer cleanup, and no forced focus. Keep concrete errors inline with Retry; no silent catch or success-on-error.
2. Provide explicit not-searched/no-matches/no-records/error/partial-results presentations with an action slot; pages select states based on actual request status, not merely `items.length===0`.
3. Bulk toolbar receives selected count, scope label, pending state and actions; it does not fetch/select hidden pages. Test keyboard action, aria-live, timer teardown, Retry, and preservation of failed selections.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/ui/__tests__/feedback.test.tsx` and web typecheck.
5. Commit: `feat(web): add scoped bulk actions and recoverable feedback`.

### T07: Make feed acquisition truthful and recoverable

**Requirements:** R14/R21/I01. **Depends on:** T01.

**Files:** Modify `apps/api/src/services/FeedService.ts`, `apps/api/src/routes/feed.ts`, `apps/api/src/services/lidarr.ts`, `apps/api/src/lib/fetch-with-timeout.ts`, `apps/api/src/services/rate-limiter.ts`, `apps/api/src/services/skyhook-cache-warmer.ts`, `apps/api/src/routes/subscriptions.ts`, `apps/api/src/jobs/scheduler.ts`, `apps/api/tests/api/subscriptions.test.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/hooks.ts`, `apps/api/tests/services/feed.test.ts`, `apps/api/tests/api/feed.test.ts`, `apps/web/src/lib/__tests__/feed-hooks.test.tsx`. Create the shared `artist.ts` contract and export it from `packages/shared-types/src/index.ts`.

1. Implement contract A and the acquisition state machine C. Before code edits, inspect current add/cache/connection resolver behavior and provider timeout support. Preserve effective user settings and existing idempotent add logic. Audit all status writers with `rg "subscriptionResult\.(update|updateMany|delete)" apps/api/src`: subscription approve/reject must use compatible conditional claims/revisions, require ownership, and refuse fresh adding records; failure/success cannot blindly update by ID after another decision. Scheduler retention must exclude active claims. Metadata-only image updates remain independent. Reconcile a confirmed external side effect after a conditional finalization conflict; never overwrite a newer user decision to hide that conflict.
2. Extend feed aggregation and response states to include in-flight and failed rows. Replace optimistic “added” removal with in-flight presentation; failure retains its row and Retry. Invalidate feed/queue/library/detail counts only after meaningful server outcomes.
3. Add tests for foreign/missing/mixed IDs, no Lidarr, no MBID, confirmed success, existing membership, definite failure, timeout reconciliation, simultaneous claims, duplicate-MBID aggregates, stale claims, cache invalidation, owner-scoped exact-MBID review cleanup, competing feed/subscription approvals/rejections, active operation bounds including retries/warming/rate waits, conditional finalization conflict after a real side effect, and same-name missing-MBID subscription candidates requiring explicit choice.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/services/feed.test.ts tests/api/feed.test.ts tests/api/subscriptions.test.ts` and `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/feed-hooks.test.tsx`; run shared build and both typechecks. API success tests must prove the response waits for confirmed provider outcome.
5. Commit: `fix(feed): confirm acquisition before reporting added`.

### T08: Add authenticated reversible decision restoration

**Requirements:** R21. **Depends on:** T07.

**Files:** Create `apps/api/src/lib/decision-undo.ts`, `apps/api/tests/lib/decision-undo.test.ts`. Modify `apps/api/src/services/FeedService.ts`, `apps/api/src/routes/feed.ts`, `apps/api/src/routes/imports.ts`, `apps/api/src/schemas/imports.ts`, `apps/api/tests/api/feed.test.ts`, `apps/api/tests/api/review.test.ts`, `apps/web/src/lib/hooks.ts`.

1. Implement protocol D for feed dismiss and single/bulk review reject (max100). Snapshot and mutate in one transaction, retaining records for safe restoration. Add auth/schema validation in both restore routes and return typed tokens from original decisions.
2. Test nested payload signatures, actor mismatch, tampering, expired/future-issued tokens, missing secret, oversized token/body, wrong decision, foreign IDs, replay, revision changes, all-or-nothing multi-row restoration, frozen-clock reject→restore→reject→old-token replay, and concurrent decision/restoration CAS conflicts. Fake the clock; do not wait two real minutes.
3. Implement mutation hooks for restore, using typed responses and exact cache invalidation. Original dismiss/reject persists immediately; no unload-sensitive delayed server writes.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/lib/decision-undo.test.ts tests/api/feed.test.ts tests/api/review.test.ts` and both typechecks.
5. Commit: `feat(review): restore recent decisions with scoped undo tokens`.

### T09: Expose scoped discovery provenance

**Requirements:** R10/I01. **Depends on:** T07.

**Files:** Modify `apps/api/src/services/FeedService.ts`, `apps/api/src/routes/feed.ts`, `apps/api/tests/services/feed.test.ts`, `packages/shared-types/src/artist.ts`, `apps/web/src/lib/hooks.ts`. Create `apps/api/src/services/artist-detail.ts`, `apps/api/tests/services/artist-detail.test.ts`.

1. Feed source records include actual subscription/result/run references and stored timestamps while preserving aggregate identity. Build source lookup using actor-owned records matched by exact MBID. No cross-user sources, name joins, guessed acquisition times, or conflated record counts.
2. Add bounded source pagination from contract A; return original source labels when ReviewItem cannot provide a subscription reference. Validate external source links as http(s); do not allow javascript/data schemes.
3. Test multi-source ordering/deduplication, no-MBID exclusion, absent references, same-name distinct artists, actor/admin scope, count semantics, and provider metadata absence.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/services/artist-detail.test.ts tests/services/feed.test.ts`; run shared build and API typecheck.
5. Commit: `feat(api): expose owned artist discovery evidence`.

### T10: Wire artist detail and existing release queries

**Requirements:** R10/I01. **Depends on:** T09.

**Files:** Modify `apps/api/src/routes/search.ts`, `apps/api/tests/api/search.test.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/hooks.ts`. Create `apps/web/src/lib/__tests__/artist-detail-hooks.test.tsx`.

1. Add authenticated `GET /api/search/artist/:mbid/detail` with UUID and bounded source-cursor validation. Route to the scoped detail service; reuse MusicBrainz `getArtist`, existing connection resolver, and canonical Lidarr membership lookup. Return partial availability for provider failures, but propagate auth failures.
2. Reuse `GET /api/search/artist/:mbid/releases` with runtime validation and bounded limit/offset. Add actor-scoped query keys for detail and release pages; clear protected cached data on logout/user change using the existing auth/query boundary.
3. Test invalid MBID/cursor, anonymous/foreign access, optional provider failure, load-more releases, request cancellation and identity changes. Do not expose other users' sources to an admin implicitly.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/api/search.test.ts tests/services/artist-detail.test.ts` and `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/artist-detail-hooks.test.tsx`; both typechecks.
5. Commit: `feat(artists): wire authenticated detail and release queries`.

### T11: Build shared artist inspector and repair modal lifecycle

**Requirements:** R10/R22/R25/I01. **Depends on:** T05/T06/T10.

**Files:** Modify `apps/web/src/components/ui/modal.tsx`. Create `apps/web/src/components/artists/ArtistInspector.tsx`, `ArtistLink.tsx`, `apps/web/src/components/artists/__tests__/ArtistInspector.test.tsx`, `apps/web/src/components/ui/__tests__/modal.test.tsx`. Modify `protected-layout.tsx` only to mount the shared inspector host for supported protected routes.

1. Put modal header/footer outside body scroll; fix focus trap, hidden/disabled focusables, double onClose, Escape, focus restoration and body-lock cleanup. Inspector side-panel/mobile layout uses the same lifecycle.
2. Render identity, membership, known source records, paged release chronology and explicit provider errors. Artwork/name links use `?artist=<validated-mbid>`; unidentified rows use existing identify flow and their provider metadata rather than a fabricated key.
3. Wire source links to `subscriptions/<id>?tab=results` and run links to `?tab=runs&run=<id>`. Initially wire the existing useArtistAdd flow; T17 upgrades its effective shared options across all entry points. All add actions must use that single path; no second player/provider is mounted in constellation.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/artists/__tests__/ArtistInspector.test.tsx src/components/ui/__tests__/modal.test.tsx`; test direct link, scroll/focus restoration, partial source data, stale response, invalid field focus and repeated open/close cleanup.
5. Commit: `feat(artists): add context-preserving catalog inspector`.

### T12: Replace feed cards with compact catalog rows

**Requirements:** R02/R05/R09/R10/R21/R22/I01. **Depends on:** T06/T07/T08/T11.

**Files:** Modify `apps/web/src/components/feed/FeedCard.tsx`, `FeedGrid.tsx`, their existing tests, `apps/web/src/app/page.tsx`, `apps/web/src/lib/hooks.ts`. Rename components only if all imports/tests are migrated in this task; do not leave duplicate old/new implementations.

1. Default to artwork-thumbnail rows: artist link, real source sentence, relevant metadata, acquisition status, persistent Add artist/Dismiss. Remove overlay-only actions and redundant badges. Feed view selection persists as `?view=list|artwork`.
2. Keep rows during acquisition, show real success/error/uncertain recovery, and offer signed Undo after dismiss. Maintain row identity while its data changes. Artwork alternative shares actions and inspector; it never hides primary actions on hover.
3. Retain bounded infinite data loading; add Load more, loaded-range announcements, and scoped empty/error/partial states. Read current API truncation metadata and do not claim a complete feed when aggregation is capped.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/feed/FeedCard.test.tsx src/components/feed/FeedGrid.test.tsx src/lib/__tests__/feed-hooks.test.tsx`; verify touch/keyboard actions without hover and restore on Undo.
5. Commit: `feat(feed): introduce compact actionable discovery rows`.

### T13: Replace dashboard tiles with actionable summaries

**Requirements:** R03/R07. **Depends on:** T07/T12.

**Files:** Modify `apps/web/src/components/feed/DashboardTiles.tsx`, `apps/web/src/app/page.tsx`, `apps/web/src/lib/hooks.ts`, `apps/api/src/routes/dashboard.ts` only where truthful outcome/scoping requires it. Create `apps/web/src/components/feed/DashboardTiles.test.tsx`; extend existing dashboard API tests if the endpoint changes.

1. Replace colored/lifting tile blocks with a single compact summary strip. Use labels such as pending discovery/review and confirmed additions, linking to their actual scope; hide irrelevant admin stats from members.
2. Audit count definitions after T07. Do not blindly sum review decisions and subscription outcomes as distinct confirmed additions; use canonical distinct identities and confirmed evidence, or label each record count explicitly. Any required count comes from deterministic queries/rules.
3. Test summary destinations, correct zero/error behavior, actor scope and absence of misleading global totals. A noninteractive value has no pointer/hover-click treatment.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/feed/DashboardTiles.test.tsx` and `npm exec --workspace @mixarr/api -- vitest run tests/api/dashboard.test.ts` if the dashboard API changed; typecheck changed workspaces.
5. Commit: `feat(dashboard): prioritize scoped actionable summaries`.

### T14: Clarify subscription list controls and mobile rows

**Requirements:** R02/R05/R11/R24/R25. **Depends on:** T03/T05.

**Files:** Modify `apps/web/src/components/subscriptions/SubscriptionCard.tsx`, `SubscriptionFormModal.tsx`, `apps/web/src/app/subscriptions/page.tsx`. Create `apps/web/src/components/subscriptions/SubscriptionCard.test.tsx`.

1. Artist/source subscription name is the main detail link; render a compact row with meaningful scheduling/last-run status. Give Run now a labeled button and scheduling a separate Pause schedule/Resume schedule control.
2. View results is a standalone link, not a Link wrapping Button. Edit/Delete go in a keyboard-operable overflow; Delete explains schedule/results consequences using existing backend behavior before confirmation.
3. Stack identity and actions at narrow widths. Associate form labels, preserve focused error fields, and place modal actions outside form-body scroll.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/components/subscriptions/SubscriptionCard.test.tsx`; assert each action invokes only its intended handler, and tabbing/link navigation works.
5. Commit: `feat(subscriptions): clarify runs scheduling and row actions`.

### T15: Make subscription results and runs deep-linkable

**Requirements:** R10/R12/R13/I01. **Depends on:** T05/T11/T14.

**Files:** Modify `apps/web/src/app/subscriptions/[id]/page.tsx`, `apps/web/src/lib/hooks.ts`, `apps/web/src/lib/__tests__/subscription-detail-hooks.test.tsx`, `apps/web/e2e/subscriptions.spec.ts`.

1. Drive selected tab/status/page/run from validated query params. View results opens results immediately. Use native run disclosure controls and direct links; retain expanded run on refresh/Back.
2. Query keys use subscription+filter+page/run. Keep previous successful data during page requests without confusing scopes; changing filter resets page. Empty-run details differ from failed fetching.
3. Link artists to inspector and expose actual source/run context. Route unidentified subscription result acquisitions through the shared candidate picker, preserving result ID and artist-level action intent; test two same-name candidates and no choice producing no acquisition. Confirm each result add/reject route's ownership checks; the known unscoped reject issue in docs/ISSUES.md must be fixed before exposing that mutation through this UI.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/subscription-detail-hooks.test.tsx` and `npm exec --workspace @mixarr/web -- playwright test e2e/subscriptions.spec.ts --project=chromium`; if reject scoping changes, run `npm exec --workspace @mixarr/api -- vitest run tests/api/subscriptions.test.ts` with a foreign-result case.
5. Commit: `feat(subscriptions): preserve result and run navigation state`.

### T16: Make search results persistent, selectable, and explicit

**Requirements:** R10/R13/R14/R15/R22/R24/R25. **Depends on:** T05/T06/T11.

**Files:** Modify `apps/web/src/app/search/page.tsx`, `hooks/useSearch.ts`, `components/ArtistSearch.tsx`, `AlbumSearch.tsx`, `apps/web/src/components/ArtistCard.tsx`, `AlbumCard.tsx`, existing search hook tests. Create `apps/web/src/app/search/__tests__/search-interactions.test.tsx`.

1. Drive committed query/tab/sources from URL; keep draft typing local until committed. Preserve successful results on request pending/error, cancel obsolete requests, and render explicit initial/no-match/partial/error states.
2. Use stable identities and contract B. One successful mutation removes only its selection; failed items remain selected; a replaced result set prunes missing keys. Sticky toolbar says Select this page and displays operation scope.
3. Artist names open inspector. Album button says Add artist and describes the artist-level side effect. Give each row its own pending/confirmed/failure state. Full-width mobile input precedes source/action controls.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/search/__tests__/useSearch.test.tsx src/app/search/__tests__/search-interactions.test.tsx`; test late responses, Back/reload, one-row mutation, failed bulk outcomes and same-name artists.
5. Commit: `feat(search): preserve results selections and action meaning`.

### T17: Make import options and identity selection effective

**Requirements:** R14/R25. **Depends on:** T07/T11/T16.

**Files:** Modify `apps/web/src/app/search/hooks/useArtistAdd.ts`, `components/MbidSelectionModal.tsx`, `apps/web/src/app/search/__tests__/useArtistAdd.test.tsx`, and actual existing add-options component discovered by `rg 'rootFolderPath|qualityProfileId|searchForMissingAlbums' apps/web/src`. If no reusable options component exists, create `apps/web/src/components/artists/AddArtistOptions.tsx`. Modify `apps/web/src/components/artists/ArtistInspector.tsx`, `apps/web/src/components/feed/FeedCard.tsx`, `apps/web/src/app/subscriptions/[id]/page.tsx`, `apps/web/src/app/queue/page.tsx`, and `apps/web/src/app/discover/page.tsx` to integrate the shared options/identity action while preserving source IDs. Modify `apps/api/src/routes/search.ts`, `apps/api/src/routes/feed.ts`, `apps/api/src/routes/subscriptions.ts`, `apps/api/src/services/FeedService.ts` and existing add-route schemas to accept/validate effective option overrides wherever the current path omits them, including feed approval. T07 keeps existing defaults; T17 connects selected overrides to the actual provider call.

1. Reuse the installed options/settings APIs and manual MBID candidate flow. Display root folder/quality profile/monitor/search-on-add at the action step, initialized from current effective defaults.
2. Pass actual values through single/bulk add endpoints and check server schema/allowed profile/root options. Do not silently discard override values. No-MBID users choose a canonical candidate; no name-only automatic match.
3. The inspector, search, feed, subscription results, review queue and recommendations use this shared identity/options action path; preserve page-specific source/result IDs where state updates require them. First invalid input receives focus; failed outcomes retain the entered options.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/search/__tests__/useArtistAdd.test.tsx`; run `npm exec --workspace @mixarr/api -- vitest run tests/api/search.test.ts tests/api/search-no-lidarr.test.ts` if changed. Assert effective payload/provider arguments, not just modal visibility.
5. Commit: `feat(artists): share effective add options and identity safeguards`.

### T18: Correct label traversal and loaded search scope

**Requirements:** R16/R22. **Depends on:** T06/T10/T16.

**Files:** Modify `apps/api/src/routes/search.ts`, `apps/api/src/services/musicbrainz.ts` only if its return shape needs clarity, `apps/api/tests/api/search.test.ts`, `apps/web/src/app/search/components/LabelArtistsModal.tsx`, `apps/web/src/app/search/__tests__/LabelArtistsModal.test.tsx`.

1. Implement contract E's release cursor and `LabelArtistPage`; update both consumers atomically. Remove page-local count-as-total and offsets advanced by artist count.
2. Deduplicate loaded artists across release pages; show releases checked/artists loaded. Loaded-only name filter remains compatible with Load more; provider failure offers Retry at the same release offset.
3. Keep independently collapsible filter sections with the common rotating chevron. Avoid one nested-scroll pane inside another dialog; footer/bulk actions remain outside body scroll.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/api/search.test.ts` and `npm exec --workspace @mixarr/web -- vitest run src/app/search/__tests__/LabelArtistsModal.test.tsx`; test repeated artists, pages with zero new artists, filtered zero-match, final page and request failure.
5. Commit: `fix(labels): page releases and state artist search scope honestly`.

### T19: Streamline similar-artist discovery

**Requirements:** R10/R13/R15/R18/R22/I01. **Depends on:** T05/T06/T11/T17.

**Files:** Modify `apps/web/src/app/discover/page.tsx`. Create `apps/web/src/app/discover/__tests__/discovery-flow.test.tsx`. Extend existing recommendation hooks in `apps/web/src/lib/hooks.ts` only if extracted from this page without changing contracts.

1. Render seeds then recommendations with one main scroll region. Seed selection persists as bounded canonical IDs; existing name-only saved seeds remain explicit unresolved identities.
2. Query keys include seed IDs/source/options affecting recommendations; no static cache key that returns a previous seed set's results. A changed seed request cancels/supersedes earlier work.
3. Show matched seed names from `matchedFrom`, retaining deterministic match counts. Artist names open inspector; options appear at add time; bulk toolbar/selection uses contract B. Separate no seeds/no matches/provider failure states.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/discover/__tests__/discovery-flow.test.tsx`; test seed change, query reload, provider error, stable selection, payload settings and source explanation.
5. Commit: `feat(discovery): connect seeds explanations and artist actions`.

### T20: Add full review-queue API search and cursor paging

**Requirements:** R17. **Depends on:** T08.

**Files:** Modify `apps/api/src/schemas/imports.ts`, `apps/api/src/routes/imports.ts`, `apps/api/tests/api/review.test.ts`, `apps/web/src/lib/hooks.ts`, `apps/web/src/lib/api.ts` if endpoint types are held there.

1. Implement contract E with a shared actor/filter scope and stable descending cursor. Upgrade single/bulk approval outcomes in the same router to stable per-record results: `{ outcomes: [{ id, state, message }], added, alreadyInLibrary, failed }`; state includes confirmed added/already-in-library, failed, uncertain, and identity-required. Never classify a provider failure as user rejection: leave its ReviewItem pending and return the recoverable outcome. Missing identity requires the existing explicit candidate selection instead of automatically picking the first name search result; validate an optional selected MBID against the requested record and actor before persisting it. Keep existing status/itemType/admin browsing behavior; mutations remain actor-owned unless the existing explicit permission authorizes acting for another owner. Clamp validated page size; bounded enrichment applies to page rows only.
2. Return matching total and nextCursor; update query keys to include search/status/itemType/cursor/limit. Preserve existing approve/reject contracts from T08.
3. Test mixed bulk success/failure with same-name artists, ID-keyed outcomes, failed records remaining pending, explicit identity choices, existing membership, and exact owner scope. Also test >500 rows, same-time ordering, final page, malformed/foreign cursor values, bounded limits, search escaping, empty matches and member/admin visibility. Cursor values never grant access by themselves.
4. Run `npm exec --workspace @mixarr/api -- vitest run tests/api/review.test.ts` and both typechecks; meaningful server integration must exercise the database filtering/paging rather than returning a fixture's prefiltered list.
5. Commit: `feat(review): search and page the complete scoped queue`.

### T21: Build review catalog table and stable bulk workflow

**Requirements:** R02/R10/R13/R15/R17/R21/R22/R25. **Depends on:** T06/T08/T11/T20.

**Files:** Modify `apps/web/src/app/queue/page.tsx`, `apps/web/src/lib/hooks.ts`. Create `apps/web/src/app/queue/__tests__/queue-interactions.test.tsx`, `apps/web/e2e/catalog-review.spec.ts`.

1. Wire URL search/status/type/cursor to the T20 query; show Previous/Next/first-page controls and matching total. Remove approve-to-see-more messaging. Reset cursor only when scope changes.
2. Table/stacked rows have native checkboxes, artist links, source text, explicit add/reject controls and sticky scope-labeled bulk toolbar. Row operations preserve unrelated selection; failed outcomes remain visible/selected.
3. Signed Undo restores rejects; acquisition approvals show actual per-item outcome rather than treating approved status as proof of collection membership. Partial bulk failures retain recoverable rows. A page empty after mutation moves to a valid visited cursor or first page, retaining filters.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/queue/__tests__/queue-interactions.test.tsx` and `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-review.spec.ts --project=chromium`; include >500 reachability and keyboard Undo.
5. Commit: `feat(review): add navigable catalog queue and scoped bulk actions`.

### T22: Normalize library table navigation and sorting

**Requirements:** R13/R25. **Depends on:** T03/T05/T11.

**Files:** Modify `apps/web/src/app/library/page.tsx`, `apps/web/src/lib/hooks.ts` only if its existing query needs supported sort params. Create `apps/web/src/app/library/__tests__/library-navigation.test.tsx`.

1. Keep bounded loading/cache behavior and existing admin access. Persist supported search/filter/page/sort in URL. A local-only sort labels its actual scope instead of pretending to sort unreturned rows.
2. Replace clickable th/div handlers with buttons/links; set aria-sort, native checkbox semantics, and meaningful focus. Keep identifiers/counts mono; names link to inspector only with valid MBID.
3. Preserve list position/selection on artist closure and Back; filters expand via common disclosure. Reflow metadata or constrain a labeled table scroll region at narrow widths.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/library/__tests__/library-navigation.test.tsx`; cover keyboard sort, drilldown restoration and bounded load behavior.
5. Commit: `feat(library): preserve catalog table state and keyboard sorting`.

### T23: Make settings save scopes and dirty navigation explicit

**Requirements:** R19/R25. **Depends on:** T03/T04/T06/T11.

**Files:** Modify `apps/web/src/app/settings/page.tsx`, `apps/web/src/components/settings/ai-settings.tsx`, `sso-settings.tsx`, `apps/web/src/app/settings/notifications/page.tsx`, `apps/web/src/components/layout/sidebar.tsx`, `protected-layout.tsx`. Modify `apps/web/src/components/settings/ai-settings.tsx` and `sso-settings.tsx` navigation links to use the boundary. Create `apps/web/src/hooks/useUnsavedChanges.ts`, `apps/web/src/hooks/__tests__/useUnsavedChanges.test.tsx`, `apps/web/e2e/catalog-settings.spec.ts`.

1. Use independent baseline/draft/error/saving state per real save endpoint. Save only its section, apply a new baseline only on success, and retain dirty drafts through failed/refetched settings. Restore defaults updates draft, never persists silently. Wire labels and invalid-field focus.
2. A narrow dirty registry exposes `hasUnsavedChanges` and guarded app navigation; sidebar and actual settings links/actions consult it. Cleanup unregisters on unmount. Native `beforeunload` is attached only while dirty.
3. Use a native document-navigation boundary for settings: links entering settings (including notifications) use native anchors, and navigation leaving a dirty settings document uses native location navigation. Within-section/tab changes replace query state instead of pushing same-document history, and ask before discarding a dirty section. This makes browser Back leave the document and invoke native beforeunload protection without a fragile popstate/history-index interception. Do not patch Next history internals or expect preventDefault to cancel popstate. Verify a clean settings boundary has no prompt and a dirty one can cancel Back; avoid duplicate prompts when an explicit section guard already received confirmation.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/hooks/__tests__/useUnsavedChanges.test.tsx` and `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-settings.spec.ts --project=chromium`; test local/global/AI/provider scope, failed save, defaults, internal links, Back, unload and Cancel navigation.
5. Commit: `feat(settings): expose save scope and protect unsaved drafts`.

### T24: Put configured services before the provider catalog

**Requirements:** R02/R05/R20/R21. **Depends on:** T03/T06/T11.

**Files:** Modify `apps/web/src/app/connections/page.tsx`, `components/ConnectionCard.tsx`, `ConnectionWizard.tsx`, `hooks/useConnectionForm.ts`, existing connection component/hook tests, `apps/web/src/lib/hooks.ts`.

1. Configured connections become compact rows with service name, enabled state, authorization state and Last tested timestamp. Available providers live behind Add connection.
2. Show session-local test Pass/Fail independently from the timestamp; after reload, do not manufacture a saved verdict. Authentication state follows actual OAuth/provider responses; lastTest/isActive cannot imply it.
3. Test/edit/authorize are explicit actions; deletion explains dependencies and confirms. Failures stay with Retry; secrets remain redacted and existing provider forms/role restrictions are preserved.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/connections/__tests__/ConnectionCard.test.tsx src/app/connections/__tests__/ConnectionWizard.test.tsx src/app/connections/__tests__/useConnectionForm.test.tsx src/app/connections/__tests__/useOAuthStatus.test.tsx`; verify failed-test reload doesn't become healthy.
5. Commit: `feat(connections): prioritize configured services and honest state`.

### T25: Make download state, filters and cancellation ergonomic

**Requirements:** R13/R21/R22/R24. **Depends on:** T05/T06.

**Files:** Modify `apps/web/src/app/downloads/page.tsx`, `apps/web/src/lib/hooks.ts`. Create `apps/web/src/lib/__tests__/download-hooks.test.tsx`, `apps/web/e2e/catalog-downloads.spec.ts`. Modify `apps/api/src/routes/slskd.ts` and `apps/api/tests/api/slskd-downloads.test.ts` only if summary/scoping data requires a backend change.

1. Persist status filter in URL, wrap filter controls at 320px, and prioritize artist/release/progress/action in rows. Label stats as the current filtered set or request independent scoped totals; no false global counts.
2. Poll All while its returned data contains pending/downloading work; explicitly active filters continue existing polling. Stop/cancel work on unmount and prevent overlapping requests. Empty/error/loading states differ.
3. Cancellation names the transfer and exact consequence; Retry appears inline. Preserve current slskd access policy while resolving the known missing-user-scope issue in docs/ISSUES.md before any newly exposed mutation. Do not broaden access in a visual refactor.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/lib/__tests__/download-hooks.test.tsx` and `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-downloads.spec.ts --project=chromium`; run `npm exec --workspace @mixarr/api -- vitest run tests/api/slskd-downloads.test.ts tests/integration/slskd-security.test.ts` for backend changes.
5. Commit: `feat(downloads): clarify active progress filters and recovery`.

### T26: Introduce named Constellation seeds and paths

**Requirements:** R10/R13/R23/I01. **Depends on:** T05/T10/T11.

**Files:** Modify `apps/web/src/app/constellation/page.tsx`, `apps/web/src/components/constellation/PathFinder.tsx`, `PersonPanel.tsx`, `ConstellationControls.tsx`, `apps/web/src/hooks/useConstellation.ts`, their existing tests. Reuse `apps/api/src/routes/constellation.ts`; change only if a narrowly scoped lookup is actually missing after investigating current seed resolution.

1. Artist-name lookup selects an existing MusicBrainz search candidate; seed by MBID through the current IdentityService. Capture the resolved focus/person ID for graph/path operations. Preserve manual disambiguation; avoid starting an orbit from a name guess.
2. Path endpoints select named resolved people; send existing numeric IDs to `/path`. Inspector can launch graph via seed/focus URL. PersonPanel retains credit/release/playback controls and links to common inspector only after resolution.
3. Expose actual role/release credit bridges and existing legend. Persist seed/focus/path identifiers, not complete graph snapshots. Abort/ignore stale lookup/seed/path responses and preserve existing SSE generation/cleanup semantics.
4. Run `npm exec --workspace @mixarr/web -- vitest run src/app/constellation/__tests__/page.test.tsx src/components/constellation/__tests__/PathFinder.test.tsx src/components/constellation/__tests__/PersonPanel.test.tsx src/hooks/__tests__/useConstellation.test.tsx src/hooks/__tests__/useFrontierStream.test.tsx`; include rapid seed change, unresolved names, path endpoint resolution and graph playback regression.
5. Commit: `feat(constellation): explore named artists and credited relationships`.

### T27: Finish consistent visual language on remaining routes

**Requirements:** R01/R02/R03/R04/R05/R06/R22. **Depends on:** T03 and feature migrations T12–T26.

**Files:** Modify `apps/web/src/app/jobs/page.tsx`, `logs/page.tsx`, `users/page.tsx`, `users/me/page.tsx`, `login/page.tsx`, `setup/page.tsx`, `preview/page.tsx`, plus only their directly rendered components. Update `apps/web/src/styles/themes/README.md` and remove inactive `listening-room.css` after proving no imports remain.

1. Apply shared page headings, neutral tables/rows, mono IDs/counts, associated labels, status/error vocabulary and responsive spacing. Remove hero copy, redundant icon containers and decorative colored chips from each actual route.
2. Keep setup/onboarding's functional explanation and recovery steps; compact does not mean hiding prerequisite instructions. Confirm permission visibility and keyboard support on system screens.
3. Search active source for copper/warm/teal tokens, rounded-2xl/3xl, hover translate/shadow glow, next/font, duplicate component styles and decorative color utilities. Inspect matches; real artwork, chart/status semantics and unrelated terms are not blanket-deleted.
4. Run web typecheck, the existing targeted tests for changed behavior, and T01 smoke spec; inspect both themes on the named remaining routes. Pure style edits do not get implementation-mirroring unit tests.
5. Commit: `style(web): complete catalog language across remaining screens`.

### T28: Verify responsive, keyboard and signature workflows

**Requirements:** R08/R09/R24/R25/I01 plus cross-route integration. **Depends on:** T12–T27.

**Files:** Create `apps/web/e2e/catalog-accessibility.spec.ts`, `catalog-workflows.spec.ts`, `catalog-visual.spec.ts`. Modify fixture helpers from T01 and `apps/web/playwright.config.ts` only to isolate deterministic catalog tests from real-backend tests.

1. Exercise 320/390/768/1024/1440px, light/dark/system, long text, missing art, data/error states, 200% browser zoom where supported and reduced motion. Check viewport overflow deterministically, exempting only intentional inner table regions.
2. Keyboard flows: feed Add/Dismiss/Undo, inspector releases/source link/close, subscription Run now/schedule/results/run, search identity choice/bulk, queue paging/reject, settings invalid field/dirty navigation, mobile drawer. Verify visible focus, labels, modal trap/footer, and native checked/aria-sort state.
3. Capture screenshots for all five signature surfaces with stored source/seed/credit evidence. Use deterministic local artwork. Record a human review checklist against design §2/§5: visual identity, hierarchy, density, source clarity and action meaning. Screenshot approval is an explicit human acceptance step, not implied by test pass.
4. Run `npm exec --workspace @mixarr/web -- playwright test e2e/catalog-accessibility.spec.ts e2e/catalog-workflows.spec.ts e2e/catalog-visual.spec.ts --project=chromium --project=firefox --project=mobile`. Browser binaries must be installed through the existing toolchain; report missing runtime prerequisites instead of skipping the affected checks silently. Run the actual-token contrast test from T02.
5. Commit: `test(web): verify catalog workflows themes and responsive access`.

### T29: Produce spec-derived completion audit

**Requirements:** R01–R25/I01. **Depends on:** T28.

**Files:** Create `docs/plans/2026-10-07-music-catalog-ux-completion.md`; update this plan's task status with real evidence only. Read local `.github/skills/completion-audit/SKILL.md`; if absent, use the installed `completion-audit` skill rather than omitting it.

1. Extract granular checklist items from design/plan, including endpoints, scopes, state machine, sources, UI routes, responsive behavior, Undo, dirty navigation and lifecycle cleanup. Count using a deterministic TypeScript array/script; R01–R25/I01 remain the parent denominator.
2. For every item record Exists → Not a stub → Wired → End-to-end reachable, with source/test/runtime evidence. Trace browser action through route/service/provider/database and back for acquisitions, queue search and Undo. Mocked screenshots are not provider or authorization evidence.
3. Use the isolated test database and controlled provider adapters to prove real router/database scope and mutation transitions, including two users, missing identity/connection, timeout and stale revision. A sandbox Lidarr run can separately confirm provider integration when available; describe precisely which real-provider paths were exercised.
4. Mark gaps explicitly and leave their parent requirements incomplete. No automatic acceptance of a gap because a provider/test environment is unavailable. Human visual review and genuine external-provider evidence remain labeled pending until supplied.
5. Commit the actual matrix/evidence: `docs(ux): record catalog spec completion evidence`.

### T30: Full review, fresh verification and handoff

**Requirements:** All. **Depends on:** T29 with no unresolved implementation gaps.

**Files:** Update `docs/ISSUES.md`, `docs/plans/2026-10-07-music-catalog-ux-completion.md`, `apps/web/src/styles/themes/README.md`, and changed implementation files only when a review finding requires it.

1. Apply `.github/skills/full-review/SKILL.md`: rubber-duck → hostile attack → code review → best-practices. Fix critical/important findings and rerun their relevant checks. Confirm the latest source still preserves graph lifecycle, identity safeguards, route auth and installed dependency boundaries.
2. Run fresh shared build/typecheck, API/web typechecks, `npm test --workspace @mixarr/api`, `npm exec --workspace @mixarr/web -- vitest run`, `npm run build --workspace @mixarr/web`, the T28 Playwright suite, and `git diff --check`. Record command, exit status and evidence artifact; identify preexisting failures separately and do not call a failed suite clean.
3. Check create→cleanup for timers, observers, query requests, focus/body locks, stream subscriptions and dirty registries; check Docker/app port/API assumptions if touched. No deployment or schema migration is necessary to certify a documentation plan.
4. Update only the UI initiative's issue status. Preserve unrelated security/operational findings. Provide changed behavior, tested boundaries, pending human/provider acceptance, scoped commits and a cold-session resume prompt if anything remains outstanding.
5. Commit: `docs(ux): close verified catalog implementation and handoff`. Publish/merge only with applicable authorization and required reviews; completion means both requested audits pass with fresh evidence.

## 4. Plan review gate

| Lens | Failure challenged | Decision / verification |
|---|---|---|
| Wiring | Inspector/source contracts exist but no entry points | T11 host; T12/T15/T16/T19/T21/T26 links; browser deep-link evidence |
| Authorization | Source IDs/restore tokens reveal another user's records | Actor-scoped services, exact ID/MBID ownership, two-user API/database tests |
| External effects | UI shows added before Lidarr confirmation | Awaited bounded T07 operation; uncertain outcomes reconcile; no detached false success |
| Recovery | Undo overwrites a newer decision | Signed token + revision check + atomic restore; no Undo for irreversible actions |
| Pagination | Label artists/queue rows disappear past local cap | Release cursors with cross-page dedup; scoped queue cursor/filter/count |
| Lifecycle | Late search/graph replies replace newer context | Cancel/ignore by query identity; preserve existing graph generations; unmount tests |
| Configuration | Theme selector/consumer types disagree | Single data-theme source; generated dark utilities checked; shared build before consumers |
| Navigation | Browser Back loses search/draft/selection | URL-first list state; scroll restoration; dirty Back test with actual browser history |
| Dependencies | New framework or new ledger needed for visual refresh | Existing stack/services/fields; no new dependency or migration |
| Integrity | Administrative or acquisition counts overstate evidence | Scope labels, canonical IDs, rule/query-derived counts, no assumed history |

**Design/plan attack corrections incorporated:** release counts are not artist totals; lastTest is not health; feed success waits for confirmation; unresolved names are not canonical identities; reversible decisions retain records; cursor ordering includes IDs; unmounted mobile navigation is not trusted; source pagination/tenant scope are explicit; uncertain external outcomes cannot be silently retried as if no side effect occurred.

Independent review findings and their dispositions appear below once the review is complete. During execution, the design remains the source of acceptance; do not replace it with a checklist inferred from whatever was implemented.


### Independent review dispositions

The requesting-code-review skill's read-only reviewer checked the design, plan, and relevant existing API/UI source. Material findings were corrected before finalization:

| Finding | Plan correction |
|---|---|
| Forward dependency cycles through modal/shared add UI | Modal lifecycle moved into T03; T04 uses it; T11 uses existing add flow until T17 upgrades consumers |
| Bulk failures keyed by name and stored as rejected | T20 returns per-ID outcomes, retains pending failures, requires explicit identity choice; T21 consumes outcomes |
| Live acquisition outlasting claim lease | §C/T07 require a shared 60-second deadline across retries, waits, warming and nested calls; 120-second lease, 70-second client timeout |
| Competing subscription decisions overwriting feed claims | §C/T07 inventory and guard existing decision writers and retention; reconcile finalization conflict after provider effect |
| Same-clock Undo replay / restored revision reset | §D/T08 monotonic decision+restore revisions and conditional writes; frozen-clock ABA test; exact eligible prior status |
| Subscription result acquisitions guessing missing identity | §C/T07/T15/T17 explicit candidate selection and owned-result validated identity; no acquisition before choice |
| Fragile Next history interception | T23 uses native settings document-navigation boundary and guarded replace-only sections; actual Back/unload tests |

These are planning corrections. No mutation implementation or runtime acceptance is claimed by this review.

**Final planning review verdict:** Ready for execution, with no remaining critical or important planning findings. This verdict covers the documents only; implementation, runtime verification, and human visual acceptance remain pending.
