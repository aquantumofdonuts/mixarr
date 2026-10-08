# Music catalog execution checkpoint

**Date:** October 8, 2026. **State:** T01–T09 complete; T10 is next. Shared catalog foundations and the acquisition, Undo, and provenance service foundations are implemented. This is an implementation checkpoint, not acceptance of the full redesign. This document records execution status; the specification's planning-only status has not been rewritten.

## Workspace and specification

- Branch: `feat/music-catalog-ux`.
- Isolated worktree: `/tmp/mixarr-music-catalog`, based on `d1aec6cf98739529bc1ae60ae486ce126637dfbb`.
- Authoritative specification for this execution: `/home/chris/Github/mixarr/docs/plans/2026-10-07-music-catalog-ux-plan.md` and its companion design in that checkout, including the October 8 R26–R28/T31–T32 amendments.
- The main checkout began with uncommitted changes to those two documents. They were left untouched and were not copied or staged. The isolated worktree's older committed plan does not contain those amendments; read the authoritative files when resuming. Reconcile the documentation deliberately before eventual integration.
- Dependencies reuse the existing installed packages through ignored local symlinks. The local `node_modules/@mixarr` workspace links point to this worktree, so consumers use its freshly built shared-types output. Next itself is now a local copy of the already-installed version, with a local `.bin/next`, because production webpack resolution failed when its framework files lived in the main checkout. No package or lockfile change was made.

## Spec-derived checkpoint matrix

| Task | Implementation and wiring | Verification | Status |
|---|---|---|---|
| T01 | Username authentication fixtures; actual route/API shapes; distinct identities sharing a name; missing identity/artwork; provenance, long names, failures, and 520 queue records; strict unhandled API failures; external request isolation | Eight routes in light/dark/system, artist action, member mobile navigation, login | Complete |
| T02 | Sole active catalog theme; OS display/text/mono stacks; data-theme dark utilities; compatible HSL aliases; unused theme configuration removed after consumer search | Actual CSS-token contrast arithmetic, black/white reference, generated Tailwind dark selector, screenshots, typecheck | Complete |
| T03 | Neutral shared controls, 4px radii, touch areas, associated labels/errors, native indeterminate checkbox, roving tabs, wrapping page header, shared disclosure CSS; obsolete button/card CSS removed after consumer search; modal focus and body-lock lifecycle with fixed header/footer | Behavioral unit tests; light/dark existing subscription forms and queue; browser keyboard navigation; independent four-lens review | Complete |
| T04 | Shared role-filtered desktop/mobile destinations; 57px desktop shell alignment; native links and labeled menu; modal-based drawer; full-query same-origin login return | Admin/member navigation at 320/390/1024px, long username, focus/Escape, repeated query preservation and unsafe return rejection; production browser checks | Complete |
| T05 | URL/page/filter and stable-selection helpers; actual main scroll element provided to a bounded per-user tab-memory hook; layout-ready inspector restoration and outgoing normal-list persistence; TanStack cancellation reaches real fetches alongside the request timeout | Back/direct-link/readiness, layout changes, user interruption, scope change, unmount, larger live selections, bounded snapshots, real obsolete-query abort and timeout regressions | Complete foundation; inspector/list-page adoption is later work |
| T06 | Actionable ten-second toasts with live announcements and timer teardown; HTTP-compatible IDs; distinct not-searched/no-matches/no-records/error/partial presentations; explicit scope/count/pending bulk controls | Keyboard actions, no focus stealing on notification creation, Retry, timers, HTTP crypto absence, pending prevention and preservation of failed/unrelated selections | Complete foundation; page adoption and authenticated Undo are later work |
| T07 | Awaited provider confirmation, owned conditional acquisition claims/finalization, explicit identity/connection requirements, retryable failed/unconfirmed outcomes, deadline/cancellation propagation, and outcome-aware feed feedback | Actual route and service tests; structured request error tests; production browser regression preserves Retry without success toast | Complete foundation; compact feed adoption remains T12 |
| T08 | Actor-bound signed short-lived dismissal/rejection Undo; atomic conditional restoration; monotonic revisions across decision/metadata writers; immediate restore mutation and affected-cache invalidation | Real Express route tests plus signature, ownership, expiry, replay, concurrency, and rollback tests | Complete foundation; visible feed/queue Undo adoption remains T12/T21 |
| T09 | Actor-owned exact-MBID original source records, bounded cursor pagination, sanitized metadata/links, partial provider availability, and feed source previews | Service/feed tests for actor/admin scope, identity, ordering, cursor bounds, counts, optional providers, and shared 20-second read budget | Complete service stage; public detail endpoint and queries are T10 |
| T10–T28, T31–T32 | Detail wiring, inspector, screen migration, and integrated browser acceptance | Not executed in this checkpoint | Pending |
| T29–T30 | Full spec completion matrix and full integrated code review | Not executed; required before declaring the entire plan complete | Pending |

These foundation tasks do not complete every acceptance criterion of the requirements they reference. Remaining page overrides, domain workflows, and responsive screens still need their later tasks. Do not merge a half-migrated palette.

## Evidence and review

Final validation commands, run from the isolated worktree:

```bash
npm exec --workspace @mixarr/api -- vitest run
npm exec --workspace @mixarr/web -- vitest run
npm run typecheck --workspace @mixarr/shared-types
npm run build --workspace @mixarr/shared-types
npm run typecheck --workspace @mixarr/api
npm run typecheck --workspace @mixarr/web
npm run build --workspace @mixarr/web
npm run lint --workspace @mixarr/web -- --no-cache
CATALOG_EVIDENCE_DIR=/tmp/mixarr-catalog-evidence/production-batch-b E2E_BASE_URL=http://127.0.0.1:3108 npm exec --workspace @mixarr/web -- playwright test e2e/catalog-baseline.spec.ts e2e/catalog-controls.spec.ts e2e/catalog-navigation.spec.ts --project=chromium --workers=1 --max-failures=1
git diff --check
```

Fresh third-checkpoint results: **2,406 API tests passed, 14 skipped, across 151 passing files and one skipped file**; **513 web tests passed in 37 files**; **26 Chromium browser tests passed against the production build**. Shared-types/API/web typechecks, shared-types build, production web build, and whitespace validation exited 0. Uncached lint exited 0 with existing warnings; this is not a warning-free lint claim. The final production build completed its lint phase and retains the existing `optimizeFonts` configuration warning. Browser checks use deterministic mocks: they establish rendering and interaction, not live provider, authentication, or database-mutation acceptance. Latest screenshots are under `/tmp/mixarr-catalog-evidence/production-batch-b`; earlier evidence remains in the sibling directories. These are local temporary evidence, not committed artifacts. The latest run includes mobile navigation and an unconfirmed acquisition that retains Retry and never displays an added toast.

Tooling findings: production builds using the external Next symlink failed to resolve framework files that were present. Moving the isolated generated webpack cache aside did not fix that; materializing the existing Next package and executable locally did. The second-checkpoint build exited 0 but its cached lint phase reported `flatCache.load is not a function`. The existing root override forces `flat-cache@6.1.21` while installed `file-entry-cache@6.0.1` expects `^3.0.4`; `load` is absent from the resolved module. Native `next lint --no-cache` bypassed that cache incompatibility and completed with warnings. No dependency override or application configuration was changed. Evidence logs: `/tmp/mixarr-catalog-build-debug.log`, `/tmp/mixarr-catalog-lint.log`.

Independent scoped review verdict: **PASS for T01–T03**, with no new important issues. Review findings were reproduced and repaired: true nested-dialog registration and original-trigger restoration, footer-only initial focus, and dark status foreground contrast. Existing callers that override default badge backgrounds retain compatible foregrounds. Contrast tests read the real theme and badge mappings; no new dependency was introduced.

Independent second-batch verdict: **PASS for T04–T06** after five reproduced findings were repaired: interruption while data is pending, ordinary navigation persistence, live-selection truncation, HTTP toast IDs, and preservation of an unfinished restoration target when leaving. Fresh scoped re-review: 41 targeted tests, typecheck, and whitespace validation passed. Whole-plan completion audit and full integrated review remain T29/T30.

First-batch resource review: dialog listeners, focus stack, body lock, and original trigger are cleaned up; close callbacks remain current without timer races. Portal footers use existing explicit action handlers. Browser fixtures block service workers and unintended network access. API/provider behavior and database schemas were not changed in the first batch.

Second-batch resource review: media-query listeners, restoration frames/resize observers/input listeners, and toast timers have teardown. Query cancellation and timeout compose through native AbortSignals. Outgoing snapshots retain pending targets unless user input cancels restoration; stored selection is bounded without silently dropping active choices. The actual scroll provider and navigation are wired into the layout. New inspector-context and feedback/bulk consumers remain intentionally assigned to later screen tasks. No backend, migration, Docker, or environment contract changed. Local verification servers were stopped after checks.

Independent third-batch scoped verdicts: **PASS for T07, T08, and the T09 service/feed stage**, after reproduced findings were repaired and re-reviewed. Repairs covered ownership and conditional claims, provider cancellation and duplicate confirmation, stale acquisition recovery, structured client errors, token integrity/minimal snapshots, monotonic revisions across all decision writers, bounded provenance reads, and provider uncertainty. The full API run exposed an outdated cache-warming mock assertion after optional cancellation options were added; the assertion was updated to the actual call contract and the full suite rerun. No important scoped findings remain. T10 endpoint/hook integration and T29/T30 whole-plan audits remain pending.

Third-batch resource and architectural review: cancellation reaches Lidarr requests/retry/rate waits; read-only database/metadata deadlines remove their listeners without abandoning mutations. Acquisition claim/finalization transactions use short bounded transactions and conditional ownership/revision checks. Undo requires the existing SESSION_SECRET, verifies actor/action/expiry before conditional restore, and never stores tokens or embeds credentials/error metadata. Provider outcomes remain distinct from local decision conflicts. Provenance streams are bounded, independently cursor-paged, and owner-scoped even for admins. No dependency, migration, Docker, or new environment variable was introduced. Tests use mocked database transactions/providers; live database concurrency, provider behavior, and Docker deployment remain unverified. The verification server was stopped after browser checks.

Task commits:

- `3cdac50` — `test(web): establish catalog interaction fixtures`.
- `c096282` — `style(web): establish neutral catalog themes and system type`.
- `78f0118` — `refactor(web): unify catalog controls and headers`.
- `a610076` — `feat(web): align catalog shell and mobile navigation`.
- `6ac9780` — `feat(web): preserve catalog URL and drilldown context`.
- `ad66427` — `fix(web): retain list context through loading and navigation`.
- `14e1e57` — `feat(web): add scoped bulk actions and recoverable feedback`.
- `0fd5ba4` — `test(web): capture responsive catalog drawer evidence`.
- `66a005b` — `fix(feed): confirm acquisition before reporting added`.
- `e637747` — `feat(review): restore recent decisions with scoped undo tokens`.
- `9eb0744` — `test(api): verify optional warming cancellation options`.
- `bfa3b43` — `fix(web): retain structured acquisition error details`.
- `c00a8b9` — `feat(api): expose owned artist discovery evidence`.
- `12ebfc7` — `test(web): verify unconfirmed acquisition retains retry`.

## Resume

The repository's Executing Plans skill requires: **“Between batches: just report and wait.”** The user approved the first two checkpoints; this third checkpoint stops after the next three tasks. Resume after feedback, using this prompt:

> Continue implementing the music-catalog UX plan in `/tmp/mixarr-music-catalog` on `feat/music-catalog-ux`. Read this progress document, verify branch/history/cleanliness and the main checkout's uncommitted specification edits, and use `/home/chris/Github/mixarr/docs/plans/2026-10-07-music-catalog-ux-plan.md` plus its companion design as the authoritative amended spec. Read repository skills from the main checkout because ignored `.github/skills` is not present in the worktree. T01–T09 are implemented, reviewed, and verified; start at T10. Follow the mandatory execution checkpoints, preserve unrelated changes, and keep later acquisition/provider and full-plan acceptance claims separate from mocked browser evidence. For T10, wire authenticated `/api/search/artist/:mbid/detail` in the existing search router, mapping public `sourceLimit`/`sourceCursor` to the service `limit`/`cursor`, and wire actor-scoped detail/release hooks with logout cache clearing. The T09 service has a shared 20-second read budget; do not create a duplicate feed detail endpoint. Feed/queue visible Undo adoption remains T12/T21. Reuse the bounded list-context and feedback primitives when their screen tasks arrive. Read the tooling notes before building; use uncached lint for the existing cache-dependency incompatibility. Run the read-only amendment review required for R26–R28/T31–T32 before batch F.

To run local browser checks again, start Next from `/tmp/mixarr-music-catalog/apps/web` with `node ../../node_modules/next/dist/bin/next dev --port 3108 --hostname 127.0.0.1`; use the explicit `E2E_BASE_URL` above. The final browser run instead used `next start` against the built `.next` output; it does not establish Docker/standalone deployment acceptance. Check that the port is free first. No PR, merge, push, or deployment has been performed.
