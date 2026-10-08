# Mixarr music catalog: visual and interaction design

**Status:** Design proposal with implementation plan; implementation has not started.
**Date:** October 7, 2026.
**Companion:** [Implementation plan](2026-10-07-music-catalog-ux-plan.md).
**Decision confirmed by user:** Compact discovery list with artwork thumbnails is the default.

## 1. Product intent and scope

Mixarr serves someone collecting music: they discover an artist, understand why the artist appeared, inspect releases and collaborators, then decide what to add or follow. Returning users also need to review subscriptions, diagnose failed acquisitions, and operate connected services. Those activities should feel like browsing a well maintained music catalog: compact, legible, specific, and easy to resume.

This design covers all 25 recommendations from the UI review, plus the distinctive identity. It changes the application shell, shared controls, discovery feed, artist details, search, similar-artist discovery, review queue, subscriptions, connections, downloads, settings, library tables, and Collaboration Constellation. It preserves current capabilities and authorization boundaries. It does not redesign music discovery algorithms or the constellation crawler.

The provided AGENTS visual guidelines are the baseline. The old copper/teal recommendations in [February UI polish design](archive/2026-02-28-ux-ui-polish-2-design.md) are superseded for future visual work. Existing performance work and [Constellation design](2026-07-27-collaboration-constellation-design.md) remain applicable. This proposal does not imply TD-009's universal additions ledger has been implemented.

## 2. Identity: a catalog that shows how music connects

**Domain vocabulary:** artist credits, record sleeves, release chronology, catalog identifiers, seed artists, collaborators, source subscriptions, collection membership. **Color world:** white paper, pale silver dividers, graphite text, slate links, black record labels; artwork supplies the varied color. **Signature:** discovery provenance attached to the artist, followed by an honest acquisition outcome.

The signature is a useful sentence or short trail, not a badge collection: “Found by [subscription] · [source] · [date]”, “Similar to [seed artist]”, or “[person] played [role] on [release]”. Each linked entity opens the relevant detail. Evidence unavailable from the current record is omitted or described as unavailable. Dates come from stored events. Similarity counts come from existing deterministic matching. No invented biographies, inferred causal histories, confidence percentages, or name-based identity joins.

This identity appears in five places: the feed's source line; the artist inspector's source records and release chronology; subscription results linking to their run; similar-artist recommendations explaining matched seeds; and Constellation's credit bridge connecting people through releases. Confirmed Lidarr membership and download progress sit beside these facts. Provider logos remain small identifiers where useful. There is no vinyl texture, oversized promotional copy, or decorative spectrum.

Three defaults change: dashboard tiles become an actionable summary strip; floating card grids become aligned catalog rows; generic colored badges become source/credit text with a few meaningful status labels. If artwork is hidden, typography and provenance must still make this recognizably a music application.

## 3. Alternatives considered

| Approach | Benefit | Tradeoff | Decision |
|---|---|---|---|
| Compact catalog with provenance | Fast comparison, persistent actions, music-specific information | Needs shared identity and source contracts | Chosen |
| Artwork-first sleeve gallery | Strong visual browsing | Lower density; long names and actions compete with art | Optional feed view after list is complete |
| Operations-first dashboard | Efficient administration | Discovery feels secondary | Use its clarity for system pages only |

The optional artwork view uses the same data, labels, actions, inspector, and URL state as the list. It is not a second interaction model. No standalone visual mood board or new font/animation dependency is required.

## 4. Evidence and root causes

Source quotes below refer to the working repository inspected for this proposal. Recheck before execution because other API work has landed during planning.

| Evidence | Implication |
|---|---|
| `apps/web/src/styles/themes/listening-room.css`: “Primary - Rust/Copper”, “Secondary - Muted Teal” | The palette issue originates in active tokens, not isolated pages. Replace the active theme and its consumers together. |
| `apps/web/src/app/layout.tsx`: `DM_Sans`; theme provider uses `data-theme` | Remove the font fetch and ensure Tailwind dark variants follow the same theme selector. |
| `apps/api/src/services/FeedService.ts`: `data: { status: 'added', processedAt: new Date() }` before `addToLidarrInBackground` | Feed approval currently describes an outcome before confirming it. Honest success requires a backend change. |
| Same service: `where: { OR: orConditions }` in review deletion | Adding/removing matching review records must be scoped to the acting user and a stable identity. |
| `apps/api/src/routes/imports.ts`: `take: limit`, `orderBy: { createdAt: 'desc' }` | The review API lacks real page navigation and a tie breaker. UI-only pagination cannot reach the full queue. |
| `apps/api/src/services/musicbrainz.ts`: `/release?query=laid:${labelMbid}`; search route returns `count: enrichedArtists.length` | Label browsing pages releases, then extracts artists. Its current count is the current page's unique artists, not all label artists. |
| `apps/api/src/routes/connections.ts`: `data: { lastTest: new Date() }` | Last-tested time does not persist the test verdict. A timestamp cannot imply healthy. |
| `apps/web/src/lib/hooks.ts`: `useReviewQueue`, `useSubscriptionResults`, `useSlskdDownloads` | Existing TanStack Query hooks should be extended, rather than introducing a competing data layer. |

The earlier browser review used sample API responses to inspect layouts and interactions. Its contrast calculation found the existing primary text pair below 4.5:1 in both modes. New color acceptance will use deterministic tests against the actual replacement tokens; sample browser data does not prove provider behavior.

## 5. Visual system

### Palette and semantics

Use the supplied light tokens: paper `#F7F8F8`, raised paper `#FFFFFF`, ink `#191C1F`, secondary ink `#494F55`, dividers `#DBDEE1`, interactive slate `#3D5A73`, slate hover `#2C4356`, actual success `#3F7A52`, actual warning `#8A6D1E`. Keep the supplied lighter neutral steps for fills and boundaries. Secondary readable text uses ink-700; ink-500 is reserved for sufficiently large text or adjusted until its actual background pair passes contrast.

Dark mode uses charcoal paper `#171A1D`, raised paper `#202428`, foreground `#ECEFF1`, secondary foreground `#B7BEC5`, subtle fill `#2C3238`, divider `#454D55`, interactive slate `#A8C5DD`, success `#9BCCAA`, warning `#DCC780`. Status backgrounds use subdued corresponding tints. Verify each rendered combination rather than assuming the proposed values pass.

Resolve the guideline's button ambiguity explicitly: primary buttons use ink-900 fill, switching to accent-ink on hover; links and focus rings use slate. Secondary buttons use a neutral border. Dark primary buttons invert to a light neutral fill and dark text. Active navigation, tabs, selection, file/provider identifiers, and counts remain grayscale. Red is allowed solely for real errors or destructive consequences, with text/icon meaning also present; it is never decorative. Constellation's data encodings remain functional chart encodings, explained by its legend.

### Type, space, and shape

Use the OS system stack everywhere. Page and section headings: 18px, weight 600; body and controls: 14px; metadata: 12–13px. Codes, IDs, counts, statistics, timestamps, and revision-like tokens use the mono stack, with tabular numerals. Keep proper artist/release names in normal text. Mono stamps use the supplied 10.5px style; essential explanatory text does not shrink to stamp size.

Use a 4/8/12/16/24px spacing scale, 4px control/dialog radius, 1px dividers, and no lifted default cards. Tables and catalog lists share row rhythm, column alignment, muted headers, and restrained neutral hover. Desktop rows target 64–72px where artwork is present; administrative table rows target 40–44px. Action hit areas are at least 44px on touch layouts. Depth is reserved for overlays. Motion is limited to brief disclosure/overlay transitions and respects reduced motion. Artwork gets a square crop with an intentional neutral missing-art treatment.

### Shared components

One compact `PageHeader`: heading, optional one-line description, contextual actions. One button hierarchy, field/label/error pattern, native checkbox, rotating chevron, status vocabulary, empty-state pattern, and feedback pattern. Existing primitives own the styles; remove duplicated page-local variants as consumers migrate. Native links navigate; native buttons mutate/disclose; no nested links and buttons or clickable `div` rows.

Modal headers and footers sit outside the scrolling body. Focus enters the meaningful first control, remains inside the dialog, returns to its trigger, and moves to the first invalid field on validation failure. Escape/backdrop close honors dirty state. Toasts announce results without stealing focus, support an accessible action, and clear timers on teardown. A blocking error stays next to the failed action with Retry; a toast is supplemental.

## 6. Shell, navigation, and URL behavior

Align the sidebar brand and main topbar to 57px. Reduce main padding to 16px mobile / 24px desktop. Give the content region an obvious heading and one principal action. Preserve existing routes; clarify visible groups into discovery, collection/work, and administration without renaming URLs. Existing admin-only visibility applies to every navigation surface, including a mobile drawer. The currently unmounted `MobileNav` must not be activated with its independent unfiltered route list.

At narrow widths use a labeled menu control and a drawer with the same authorized destinations. Page actions wrap; filters become a collapsible group; subscriptions become stacked rows with labeled actions. Tables may scroll within their own labeled region when their columns cannot sensibly reflow. No viewport-wide horizontal overflow at 320px. Downloads' filter bar wraps. Search gets a full-width field before action buttons. At 200% zoom, primary tasks remain reachable without overlapping sticky controls.

Shareable query parameters encode committed search, source/status filters, tabs, page/cursor, selected run, feed view, and artist inspector. Use `push` for explicit entity/tab/page navigation; `replace` for debounced typing/filter refinements. Changing a filter resets page/cursor. Parse and clamp every URL value, preserving unrelated supported parameters. Closing an inspector opened from a row restores the original URL, selection, and scroll; a directly opened inspector closes to its current parent list. Preserve the full path plus query through login.

Seed identifiers for similar-artist discovery can be repeated URL parameters with a bounded count. Session state holds uncommitted inputs, selections, and scroll positions keyed by the committed list URL; it contains no credentials. Do not encode enormous selected result sets or constellation graph contents in the URL. Use page-level URL parsing helpers, not a new universal navigation framework.

## 7. Shared artist inspector and provenance

Artist names and artwork open one common inspector from feed, search, queue, subscription results, recommendations, and constellation when a MusicBrainz identity is available. The inspector contains identity, confirmed collection membership, source records, releases, and relevant actions. A wide screen uses a side panel; mobile uses a full-height dialog with fixed action footer. Both are the same component and query contract.

Canonical key: validated MusicBrainz artist UUID. Provider-only results use their existing disambiguation flow before an acquisition; name alone never becomes a global key. Such rows still expose available provider metadata and an explicit “Identify artist” action. Constellation retains its credit/person panel for unresolved collaborators and playback; it links to the inspector only after identity resolution. Do not replace the graph panel with an empty generic artist view.

The new authenticated detail endpoint lives in the existing search router. It returns provider identity/metadata, releases via the existing release endpoint, known Lidarr membership, and source records from the requesting user's `SubscriptionResult`/`ReviewItem` records. Subscription evidence includes the available subscription/run references and stored time. Review evidence may only contain its plain source label. Admin-wide review browsing does not grant a common artist detail endpoint permission to reveal other users' provenance. Erroring providers return explicit partial availability; authorization errors never become empty success.

This is a list of known evidence, not an exhaustive life history. `SubscriptionResult` and `ReviewItem` are different records; do not join them by artist name or double-count them as acquisitions. Each source record identifies its origin and nullable reference fields. No schema migration or new universal event ledger is planned.

## 8. Page workflows

### Feed and dashboard

The heading is “Discovery”. A restrained summary strip links to pending review, subscription outcomes, and failed operations where the user can actually act. Counts must identify their scope. The list shows artwork, artist, source sentence, useful metadata, acquisition state, and always-visible “Add artist” and “Dismiss” actions. Keyboard focus reveals no essential information that was missing before focus. Optional artwork view keeps these actions outside the artwork hover overlay. Infinite loading also provides a working “Load more” control and announces the loaded range.

Approval means requesting an acquisition, not declaring completion. The row stays visible as “Adding…” until confirmed, then shows “Added to Lidarr” or “Already in Lidarr”. Missing identity or connection leaves the item actionable with a recovery path. Failure remains visible with Retry and its concrete error. Summary counts and source records update after confirmed outcomes. Multi-source aggregates retain stable result references and do not let a mixed-artist aggregate perform a single misleading add.

### Subscriptions and results

Subscription name opens detail; “View results” opens `?tab=results`. “Run now” triggers one run; a separately labeled pause/resume schedule control changes scheduling. Overflow contains Edit and Delete, with consequence confirmation for Delete. On mobile actions follow the identity/status block instead of squeezing the name. The detail page persists tab, result status/page, and selected run. Run disclosure is a native button; deep links target the specific run. Result rows open artist details and carry a source/run reference where one exists.

### Search, labels, and similar artists

Search keeps the last successful result set while loading a new query, clearly marking pending work; an error offers Retry and preserves the input. Distinguish not searched, no matches, provider unavailable, and partial results. Album results explicitly say “Add artist” while the underlying operation adds the artist. Display the selected root folder, quality profile, monitoring, and search-on-add options before committing. Preserve existing manual identity selection and per-item pending/success/error feedback.

Selection is keyed by stable result identity. Acting on one selected row removes only that row; replacing the query prunes only identities absent from the new result set. A sticky bulk toolbar shows selected count and action scope. “Select this page” never implies all pages. Labels initially search “Loaded artists”; loading more remains available under that filter. Server responses expose a **release** cursor and total releases, deduplicating artists across pages. Do not claim complete artist search until the entire release traversal has finished. This bounded, explicit behavior is the selected alternative to building a full label index.

Similar-artist discovery is a simple sequence: select seeds → request recommendations → inspect/add artists. Move import options to the add step, persist seed identity, show matched seeds, and avoid nested scrolling result panes. Existing match rules provide counts; recommendations do not gain AI confidence scores.

### Review queue and library

Queue search/filter/page navigation reaches all eligible records through a scoped API query; remove the 500-row ceiling message as the navigation mechanism. Use a bounded cursor with stable `(createdAt, id)` ordering, matching-filter total, and page size 50. Header selection means loaded page only. Bulk actions report each outcome and leave failed rows selected. Reject can be undone; approve is an acquisition with irreversible external effects and is not advertised as Undo.

Library keeps its existing bounded loading/performance behavior. Sort headers are buttons with `aria-sort`, row identity is a link, checkboxes are native, and filters/page/sort survive drilldown. Do not fetch the complete library merely to sort a visual table unless the existing API already provides that scope; label local sorting where needed.

### Settings, connections, downloads

Settings use explicit section-level save scopes matching their APIs: personal/general, global/admin, AI, SSO provider, notifications. Each section shows dirty/saving/saved/error state and a local Save action. “Restore defaults” changes the draft and requires Save. New settings fetched while dirty do not overwrite the draft. Unsaved navigation protection covers application links, section changes, dialog closure, browser Back, and unload; an intercepted `popstate` cannot be canceled with `preventDefault`. Use native document navigation at the settings boundary so browser Back/unload protection works without patching Next history internals; section/tab changes use guarded replacement. Test the actual navigation behavior.

Connections first shows configured services and their enabled/authorization state. “Add connection” opens the available provider catalog. “Last tested” is a timestamp; a current-session test result may show Pass/Fail; after refresh a verdict is unknown unless the backend persisted it. No new health column is proposed. Credentials stay redacted. Download rows prioritize artist/release, progress, current state, and next action. Poll the All view when active work exists, clean up polling on navigation, and label summary scope so filtered rows cannot silently become global totals. Confirm cancellation with its real consequence; show inline Retry for failed transfers.

### Collaboration Constellation

Replace the raw Discogs seed input with artist-name search and an identity choice using the existing MusicBrainz search and seed resolver. Existing MBID resolution is reused. Launch graph exploration from an identified artist. The path finder selects named, resolved endpoints and sends the numeric person IDs the existing path API requires. Numeric identifiers remain available as secondary technical metadata.

Keep credit bridges, ownership encodings, playback, legend, incremental graph expansion, SSE cleanup, and identity safeguards from the current constellation. Query state stores focus/seed/path endpoints only. A request resolving after the seed has changed must not replace the newer graph. The distinctive visual material here is the actual collaborator credit, role, and release, rather than generic network decorations.

## 9. Mutations, recovery, and integrity

Do not hold a database transaction open during a Lidarr call. Feed acquisition validates every linked result exists, belongs to the actor, has a compatible stable artist identity, and is eligible. Preflight missing Lidarr/identity before changing records. Claim eligible records atomically as `adding`, call the existing bounded/idempotent Lidarr add logic, then store a confirmed outcome or actionable failure. Concurrent attempts cannot independently claim the same records. A timeout is an uncertain outcome: reconcile by canonical MBID before retrying. All competing subscription result decision routes use the same conditional claim/revision rules, and scheduler retention excludes active claims. A crashed claim must be recoverable on the next attempt using a two-minute lease and a total provider operation deadline of 60 seconds, including retries and rate waits; it must not display permanent success. The implementation plan supplies the exact state machine.

Undo applies to dismiss/reject decisions only. Persist the decision immediately, return a short-lived signed, user-scoped restoration token, and show Undo for 10 seconds. The token contains previous statuses and post-decision revisions. Restoration verifies identity, expiry, action type, ownership, and unchanged revisions, then restores status atomically while advancing a monotonic decision revision; conflicting later work returns 409. Restored pending results retain a decision revision in processedAt, rather than resetting it and permitting a same-clock replay. This uses existing fields and Node crypto, without a new table. Route auth is mandatory, and tokens never enter URLs, logs, or persistent browser storage. On Undo failure, leave the server's actual decision visible with an explanation. Acquisitions, deletions, and transfer cancellation use explicit outcomes/confirmation rather than a fake rollback promise.

## 10. Recommendation traceability and acceptance

Each requirement is independently verifiable. “Complete” requires implementation evidence, not presence in this document.

| ID | Review recommendation | Observable acceptance | Plan tasks |
|---|---|---|---|
| R01 | Replace brown/copper and competing teal | Both themes use the neutral/slate system; no old decorative accents in active UI | T02, T03, T27 |
| R02 | Lists/tables replace rounded card walls | Feed, subscriptions, queue, connections and operational pages use aligned rows | T03, T12, T14, T21, T24, T27 |
| R03 | Remove lift/glow/fake click affordances | Noninteractive summaries do not lift; interactive rows use semantic controls | T03, T13, T14, T27 |
| R04 | Compact consistent headers | Shared 18px header and aligned 57px shell headers | T03, T04, T27 |
| R05 | Reduce badge/icon noise | Source prose replaces decorative badges; action icons have labels | T03, T12, T14, T24, T27 |
| R06 | System typography; mono IDs/counts | No font download; IDs/counts distinct without shrinking essential text | T02, T03, T27 |
| R07 | Actionable compact dashboard | Scoped summaries link to actual review/outcome workflows | T13 |
| R08 | Correct contrast | Actual text pairs >=4.5:1; required control/focus boundaries >=3:1 | T02, T28 |
| R09 | Persistent feed actions | Add/Dismiss visible and operable by mouse, touch and keyboard in both views | T12, T28 |
| R10 | Common artist drilldown | All artist entry points share inspector and preserve parent context | T05, T09, T10, T11, T12, T15, T16, T19, T21, T26 |
| R11 | Explicit subscription actions | Run now, schedule toggle, name link and overflow have distinct meaning | T14 |
| R12 | Results/run navigation | View results opens results; run links/disclosures support keyboard and URL | T15 |
| R13 | URL state and scroll restoration | Back/reload/deep link restore committed state and list position | T04, T05, T15, T16, T19, T21, T22, T25, T26 |
| R14 | Honest album add/options/feedback | Artist-level action says Add artist; options and result are visible | T07, T16, T17 |
| R15 | Stable selection and bulk toolbar | One mutation does not erase unrelated selection; bulk scope is explicit | T06, T16, T19, T21 |
| R16 | Correct label search/loading | Loaded-only filter is labeled; more releases load while filtered; no false artist total | T18 |
| R17 | Complete queue navigation/search | Records beyond 500 are reachable with matching scoped search/counts | T20, T21 |
| R18 | Streamlined recommendation flow | Seeds→results→add options; no nested result scroll; seeds persist | T19 |
| R19 | Save scope and dirty protection | Each API-backed section saves itself; dirty state survives error and guards leaving | T23 |
| R20 | Connected services first | Configured list precedes catalog; enabled/authorized/test verdict are distinct | T24 |
| R21 | Undo, consequence confirmation, Retry | Reject/dismiss restore safely; irreversible actions say what happens; failures retry inline | T07, T08, T12, T21, T24, T25 |
| R22 | Distinct loading/empty/error states | Not searched/no matches/no records/provider failure have different recovery | T06, T11, T12, T16, T18, T19, T21, T25, T27 |
| R23 | Named constellation entry points | Names launch seeds/paths through existing identity resolution; raw ID is secondary | T26 |
| R24 | Responsive reflow | Subscription identity readable, search full width, download filters accessible at 320px | T04, T14, T16, T25, T28 |
| R25 | Keyboard/labels/checks/focus | Native controls, sortable headers, modal footer and invalid-field focus work | T03, T04, T06, T11, T14, T16, T17, T21, T22, T23, T28 |
| I01 | Distinctive catalog identity | Source, seed and credit evidence plus honest acquisition state appear across five signature surfaces | T07, T09, T10, T11, T12, T15, T19, T26, T28 |

## 11. Design attack and acceptance boundaries

**Rubber-duck result:** clicking an artist must preserve the list; clicking Add must preserve a truthful pending state; the server confirms an external operation before the UI claims success. Provenance starts with owned records, not a guessed artist history. Release pagination is not artist pagination. These distinctions drive the backend tasks and the inspector contract.

**Attack result:** handle same-name artists, missing MBIDs, unauthorized source IDs, simultaneous adds, late requests, provider errors, hundreds of queue rows, changes during Undo, stale settings reads, anonymous deep links, and graph seed changes. Avoid reactivating unfiltered mobile navigation, removing manual disambiguation, or creating a new theme file while legacy styling still wins.

**Tradeoffs accepted in this proposal:** label search is explicitly loaded-only until traversal completes; connection test verdicts are session-local; provenance is limited to stored evidence; artwork grid is secondary. These are bounded honest behaviors, not permission to leave the 25 recommendations unwired.

Implementation acceptance requires a spec-derived completion matrix, a full code review, fresh checks, keyboard/mobile/theme evidence, and real API integration checks for mutation/authorization behavior. Request-mocked browser fixtures prove layout and navigation only. Human visual acceptance is a final review of real screenshots/flows; automated checks do not certify that the design feels distinctive.
