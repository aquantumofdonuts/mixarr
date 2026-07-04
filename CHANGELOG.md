# Changelog

All notable changes to Mixarr are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v2.3.3] - 2026-07-04

### Fixed
- **`package-lock.json` version drift**: Lockfile version fields were stuck at `2.2.0` since the v2.3.0 release. Version bump commits were updating all `package.json` files but not regenerating the lockfile. Now in sync at `2.3.3`.
- **Unified image startup race**: Migrations now run against a temporary MySQL instance before supervisor starts, so the API never races the DB on first boot.

---

## [v2.3.2] - 2026-07-04

### Added
- **Redis-cached artist images**: All Deezer artist image lookups now route through a shared Redis cache (7-day positive TTL, 1-hour negative TTL, bounded concurrency of 5). A cold cache warms on first use; subsequent requests are served in microseconds without hitting Deezer
- **Persistent `imageUrl` on subscription results**: The worker now stores the resolved artist image URL directly on each result row at creation time. Read paths serve the stored URL immediately — no per-request Deezer calls on subscription result pages
- **Boot-time Lidarr cache warmup**: On startup, the API warms the shared `LidarrCache` for all active Lidarr connections so the first `/results` request never pays the full library download cost
- **Server-side pagination for subscription results**: `GET /api/subscriptions/:id/results` now defaults to 50 results per page (cap 200) with `limit` / `offset` query params — replaces unbounded full-table loads

### Changed
- **Shared `LidarrCache` registry**: All routes now share a single per-Lidarr-URL `LidarrCache` instance. Refresh calls are coalesced (parallel callers share one in-flight refresh) and use stale-while-revalidate — the first call blocks, subsequent stale reads serve immediately and refresh in the background
- **Subscription detail page**: Rewritten to use parallel react-query hooks (`useSubscriptionDetail`, `useSubscriptionRuns`, `useSubscriptionResults`). Page load no longer waterfalls through uncached Lidarr/Deezer calls. Row-level approve/reject mutations update the cache surgically without a full page refetch
- **One-time image backfill**: Legacy result rows without a stored `imageUrl` are backfilled on first read via a fire-and-forget Redis lookup — no extra latency on the response path

### Fixed
- **`LidarrCache` concurrent refresh stampede**: Multiple simultaneous requests no longer each trigger independent Lidarr library downloads. A single coalesced refresh promise serves all concurrent waiters

## [v2.3.1] - 2026-07-03

### Added
- **Discovery funnel metrics**: Subscription runs now emit structured counters (`fetched`, `deduped`, `already_in_library`, `no_mbid_found`, `queued`, `added`) in the completion log, enabling before/after breadth comparisons
- **Lenient MBID fallback**: When strict MusicBrainz matching fails, a secondary lenient pass accepts the top result when score ≥ 95 — reduces `no_mbid_found` skips for single-token stage names, transliterations, and romanised names
- **Feed truncation metadata**: `GET /api/feed` now returns `truncation.totalBeforeAggregationCap` and `truncation.aggregationTruncated` so the UI can warn when candidates are invisible due to the aggregation cap
- **Configurable review-queue dedup**: `findOrCreateReviewItem` accepts a `dedupStrategy` option (`default` | `relaxed`); relaxed mode skips normalized-name collapse to prevent incorrectly merging distinct artists that share a common token

### Changed
- **Feed aggregation cap**: Raised `MAX_AGGREGATION_ROWS` from 5 000 → 15 000 rows, reducing feed invisibility for users with large subscription histories
- **Discover UI library page limit**: Raised from 100 → 250 artists per page
- **Discover similar request limit**: Raised from 50 → 100 results per call
- **Seed artist schema max**: Raised from 200 → 500 accepted artist names per similar-discovery request

### Fixed
- **Spotify artist search broken** (#62): Spotify's `/v1/search` now rejects `limit=25` with HTTP 400 — clamped to `Math.min(limit, 10)`. Swallowed provider errors in `multiSourceSearch` now log at `warn` instead of silently returning empty results

---

## [v2.2.0] - 2026-04-30

### Added
- **DISABLE_CADDY env var** (#42): Set `DISABLE_CADDY=true` to bypass the built-in Caddy reverse proxy in the unified container — intended for users who want to front Mixarr with an external reverse proxy (e.g. nginx, Traefik, Caddy on the host)

### Fixed
- **SSRF vulnerability** (CodeQL #50): Service URLs (Lidarr, Navidrome, slskd) are now validated before HTTP requests to prevent server-side request forgery
- **Lidarr form stale state** (#43): Connection form re-mounts when saved config loads during an edit, preventing stale field values from the previous session
- **rootFolderPath normalization** (#43): Empty `rootFolderPath` values are normalized to prevent automatic fallback to the wrong Lidarr folder
- **Subscription worker error logging**: Error objects now serialize `message` and `stack` correctly instead of logging an empty `{}`
- **TypeScript build errors**: Pinned `ioredis` to resolve transitive dependency version conflicts that broke compilation
- **Update checker cache**: Falls back to a live GitHub check when the cache is empty after upgrade; stale "update available" banner no longer appears post-upgrade; upgrade errors logged at `warn` instead of `error`
- **Version constant**: Health endpoint and startup banner now read the version from the `VERSION` constant rather than the `npm_package_version` environment variable

### Changed
- Version sourcing automated — `version.ts` and `constants.ts` derive values from `package.json` at build time; no more manual constant updates on release

---

## [v2.1.6] - 2026-04-30

### Fixed
- **Unified container restart auth failure** (issue #51): Auto-generated `MYSQL_PASSWORD` was regenerated on every container restart but MariaDB retained the original password from first boot, causing _"Authentication failed against database server at `127.0.0.1`"_ on every `docker compose down && docker compose up`. The generated password is now persisted to `/data/.mixarr_credentials` (mode 600) and restored on subsequent starts. Existing installs upgrading from this version perform a one-time password rotation via `ALTER USER` so the database remains accessible without data loss. Users who set `MYSQL_PASSWORD` explicitly are unaffected. Affects unified image only.

---

## [v2.1.5] - 2026-04-05

### Fixed
- **Wrong version displayed at startup**: `apps/api/package.json` and workspace packages were not committed as part of the v2.1.4 release tag due to `npm version --workspaces` leaving workspace files unstaged. The startup banner and `/health` endpoint now correctly report the image version.

---

## [v2.1.4] - 2026-03-30

### Fixed
- **Slim image build failure**: Removed broken `COPY --from=prod-deps /app/apps/api/node_modules` line in `docker/Dockerfile.slim` — same root cause as v2.1.3 hotfix, missed in the slim image

---

## [v2.1.3] - 2026-03-30

### Fixed
- **Docker build failure**: Removed broken `COPY --from=builder-api /app/apps/api/node_modules` line in `docker/Dockerfile.unified` — this path does not exist since npm workspaces hoists all dependencies to the root `node_modules`
- **CI latest tag**: Fixed `latest` Docker tag not being published after the workflow trigger was changed from `release` events to tag pushes

---

## [v2.1.2] - 2026-03-30

### Fixed
- **Subscription worker error logging**: Error objects now serialize correctly — `message` and `stack` are logged instead of an empty `{}` object, making job failure diagnosis possible
- **Lidarr auto-add silent failures**: Failed artist additions now log the Lidarr error message before marking the result as failed
- **SSRF vulnerability** (CodeQL #50): Service URLs are now validated before HTTP requests to prevent server-side request forgery
- **DISABLE_CADDY env var** (#42): Added support for disabling Caddy when using an external reverse proxy
- **Lidarr form stale state** (#43): Connection form re-mounts when config loads during edit, preventing stale values
- **rootFolderPath normalization** (#43): Empty `rootFolderPath` values are normalized to prevent fallback to the wrong Lidarr folder
- **TypeScript build errors**: Resolved dependency version conflicts (pinned ioredis); fixes compilation failures introduced by transitive dep upgrades
- **Update checker false positive**: Cache now invalidates correctly after upgrade, preventing stale "update available" banner
- **Version constant**: Health endpoint now reads version from `VERSION` constant rather than `npm_package_version` env var

### Changed
- Version sourcing automated — `version.ts` and `constants.ts` derive values from `package.json` at build time

---

## [v2.1.1] - 2026-03-18

### Added
- **Update checker**: Background service checks GitHub Releases every 6 hours, logs to console when a new version is available
- **Version display**: Shown in sidebar footer, login page, and Settings > About section
- **Update toast**: Notification on login when a newer release is available
- **Metadata profile selector**: Lidarr connection form now includes a Metadata Profile dropdown (fixes #40)
- **Preset tag hints**: Tag-based subscription presets show "Tag can be changed to any genre" in the UI

### Fixed
- **Metadata Profile: None** (#40): Artists were added to Lidarr with metadata profile "None" because the subscription approve route always picked the first profile from the API (typically "None") instead of using the connection config. Now respects saved connection settings with proper fallback.
- **Theme picker overflow**: Light/dark/system toggle no longer overlaps the Mixarr logo when the sidebar is collapsed. Moved to the user menu dropdown.

## [v2.1.0] - 2026-03-15

### New Subscription Types
- **5 new Last.fm strategies**: Tag Albums, Related Tags, User Albums, Weekly Artists, Weekly Albums
- **10 new Last.fm presets** organized into Charts & Tags, Personal Library, and Similar & Discovery categories
- Total subscription types: **56** (up from 51)

### UI/UX Overhaul (Phase 2)
- **Component architecture rewrite**: Connections page (1,325 → 199 lines), Search page (903 → 143 lines)
- **ConnectionWizard**: 3-step modal replaces monolithic form
- **Search tabs**: Extracted SearchBar, BulkActionBar, 5 tab components, MbidModal, LabelArtistsModal
- **Subscription descriptors**: Smart auto-generated names (e.g. "Last.fm Tag: electronic" instead of "Last.fm Tag")
- **Subscription rename**: Pencil-to-unlock UX for custom names
- Breadcrumb navigation on detail pages
- Brand lettermark in sidebar with active state indicator
- Brand illustration on login page
- StatsBar upgraded to pill badges with icons
- Skeleton loading states on all data pages
- BottomSheet component for mobile nav

### Design System
- Semantic color tokens replace all hardcoded colors
- `rounded-container` design token for consistent border radius
- Differentiated accent vs primary color tokens
- Exit animations on Modal, BottomSheet, and Toast
- Staggered fade-in on feed cards, interactive hover on connection cards
- Accessible Switch component replaces inline toggles
- ConfirmDialog replaces `window.confirm` across all pages
- Tabs component with ARIA, keyboard nav, and TabPanel
- OpenGraph and Twitter card metadata

### Security
- Redis session store replaces in-memory MemoryStore
- Deactivated users rejected in `deserializeUser`
- Path traversal validation on slskd poll job
- Connection test endpoint requires auth after setup
- Notification secrets masked in API responses
- `hashPassword` utility with cost 12 in admin routes
- 15-second timeout on Plex auth fetch calls
- `POST /api/settings/base-url` restricted to setup-only
- Connection test errors sanitized to prevent info leakage
- Dependabot and CodeQL alerts resolved
- SECURITY.md vulnerability disclosure policy

### Reliability & Validation
- Zod schemas on all API routes (AI, settings, SSO, slskd, discover, imports, jobs, duplicates)
- `fetchWithTimeout` wrapper on all external API calls
- `unhandledRejection` and `uncaughtException` handlers
- Logging added to all previously silent catch blocks
- Graceful error when slskd connection missing

### Architecture
- **Strategy pattern**: Subscription worker refactored from monolithic switch to 14 strategy modules
- `withTypedConnection` middleware applied to 13 connection routes
- Connection test handlers extracted to strategy map
- Bulk PUT endpoint for global settings
- Subscription `resultLimit` persisted and used (was hard-coded to 50)
- Non-root user in unified Docker image
- DB credentials randomized on first boot

### Fixed
- slskd router not mounted (404 on all Soulseek endpoints)
- 50-item cap on subscription results display
- Config key mismatches in subscription descriptor
- Last.fm extended strategies hardened against edge cases
- ESLint errors breaking Next.js production build
- SSO emoji icons replaced with Lucide icons
- Toast positioning on mobile

---

## [v2.0.0] - 2026-02-01

### SkyHook Cache Warmer (No-Miss Lidarr Adds)
- **New Feature**: Pre-flight SkyHookcache warming eliminates failed artist adds

### Theme Consolidation
- Replace 6-theme system with single "Listening Room" theme
- Simplify theme picker to Light/Dark/System toggle

### Library Health: Fix Metadata Tool
- **New Feature**: "Fix" button on Library Health page to repair missing metadata
- Single-artist fix: Click wrench icon to warm cache + refresh artist
- Batch "Fix All": Process all artists with issues (1/second rate limit)

### UI/UX Polish
- Add skeleton loading states for dashboard and data tables
- Group sidebar navigation into logical sections (Home, Library, Discover, Settings)
- Add interactive card variant with enhanced hover states
- Add actionable CTA to empty dashboard state
- Migrate to semantic status color tokens (success, warning, error, info)
- Badge component uses semantic status tokens for consistency

### slskd Quality Scoring
- Add audio format classification system (lossless, high-quality, lossy, low-quality, unknown)
- Intelligent file extension parsing with comprehensive format support
- Add slskd peer quality scoring algorithm with weighted factors
- Peer scoring considers: file format, bitrate, lossless detection, filename patterns

### API Architecture Improvements
- Extract subscription presets to dedicated data module (1,021 lines)
- Extract run history endpoints to controller pattern
- Standardize error logging across subscription controller
- Reduce subscriptions.ts route file by 76% (1,452 → 347 lines)

### Accessibility Improvements
- Add focus trap to modals (Tab cycles within modal)
- Add focus restoration when modals close
- Add screen reader support for loading spinner
- Respect `prefers-reduced-motion` user preference
- Add proper ARIA attributes to modals (role=dialog, aria-modal, aria-labelledby)
- Escape key closes modals

### Performance Improvements
- Remove 8 external Google Font dependencies (Inter, Playfair, IBM Plex, etc.)
- Use system font stack (eliminates font loading latency)
- Replace lucide-react barrel imports with direct imports (better tree-shaking)
- Replace @/components/ui barrel imports with direct imports (better code splitting)
- Migrate to next/image for automatic image optimization (WebP, srcset, lazy loading)

### UX Improvements
- Add tabular-nums to numeric displays (prevents layout shift)
- Add motion-safe animations for modal transitions
- Configure remote image patterns for cover art (coverartarchive.org, musicbrainz.org)

### Documentation
- Add theme system README with design principles and color palette reference

### Fixed
- Fix 40 failing tests (SSO, slskd, controller, jellyfin mocks)
- Move integration tests to separate directory for cleaner test runs

#### Docker Slim Image
- New `mixarr:slim` Docker image containing only API + Web (~700MB vs ~1.5GB unified)
- `docker-compose.slim.yml` for production deployments with external MariaDB and Redis
- `docker-compose.byo.yml` for users with existing database/Redis infrastructure


#### Ollama & Custom OpenAI Support
- Use local LLMs or OpenAI-compatible providers (Ollama, LiteLLM, OpenRouter) for AI recommendations
- Configure custom base URL and model name in AI Settings
- Works without API key for local Ollama instances
- Security: Reject URLs with embedded credentials

#### Lidarr Monitor New Items
- Add "Monitor New Albums" dropdown to Lidarr connection settings
- Support for None, All, New, and Existing monitor options
- Automatically apply monitor setting when adding artists via subscriptions

## [v1.2.1] - 2026-01-27

### Hotfixes

- Issue #30 - HTTP Access Shows Blank Dashboard


## [v1.2.0] - 2026-01-27

### Fixed
- Issue #24: Lidarr import settings are not respected
- Issue #22: Allow renaming custom spotify playlists
- Issue #21: Can't access the WebUI on http
- Issue #20: slskd server ban (warning)
- Fix modals not scrollable on small screens
- Fix Discogs subscription error on save
- Fix Musicbrainz subscription error on save
- Fix subscription edit using PUT to match API route
- Fix Spotify category preset field name mismatch
- Fix Docker image typo (aquantumofdonums → aquantumofdonuts)
- Expose port 3010 for direct web access in unified Docker image
- Prevent worker auto-import in test environment
- Pass monitorOption from Lidarr connection settings when adding artists

### Security
- Sanitize 5xx errors in production responses
- Add session secret validation warning
- Add auth rate limiting verification tests
- Global rate limiting for CodeQL findings

### Added

#### Lidarr Monitor New Items
- Add "Monitor New Albums" dropdown to Lidarr connection settings
- Support for None, All, New, and Existing monitor options
- Automatically apply monitor setting when adding artists via subscriptions

#### Subscription System Refactoring
- Extract SubscriptionService with TDD (business logic layer)
- Add SubscriptionController with TDD (HTTP layer)
- Wire CRUD routes through controller pattern
- Extract SubscriptionFormModal component (1019 lines)
- Extract SubscriptionCard component (204 lines)
- Extract subscription-constants.ts (260 lines)
- Add useCreateSubscription and useUpdateSubscription hooks
- Reduce subscriptions/page.tsx from 1,179 to 214 lines (82% reduction)

#### Type Safety & Code Quality
- Add Socket.IO type definitions to eliminate `as any` casts
- Add shared subscription types and result handling constants
- Standardize error logging across all API routes
- Consolidate LidarrConnectionConfig to single canonical type

### Documentation
- Add pre-release cleanup documentation

---

### slskd Integration (Major Feature)

#### Added
- Add slskd (Soulseek) as a new connection type with schema validation
- SlskdService: search, downloads, connection test functionality
- SlskdSubscriptionProcessor with peer quality scoring algorithm
- SlskdDownload model for tracking download status and history
- API endpoints for downloads with filtering, retry, and cancel actions
- Webhook endpoint for download completion events
- Polling job for download status detection (2-minute interval)
- SlskdOrganizerService for automatic file organization
- Rate limiting with exponential backoff to protect slskd server
- Queue monitoring and metrics for download operations
- Two-phase commit for transaction safety
- 30-second timeout on all slskd API calls
- Search polling loop until search completion
- Peer quality scoring for better download source selection
- Detailed API error parsing with logging

#### slskd UI
- Downloads page with status filtering and actions (retry, cancel)
- slskd search modal integrated on Search, Discovery, and Review Queue pages
- ArtistCard integration for quick slskd search

#### Fixed (slskd-specific)
- Fix slskdProcessor scope in finally block (ReferenceError)
- Fix DB error propagation in rate limiting flag check
- Fix memory leak in slskd worker metrics interval
- Fix stale flag caching in subscription processor
- Fix cross-device file moves with copy fallback (EXDEV error)
- Fix BigInt serialization to string in JSON responses
- Export QueueEvents cleanup for graceful shutdown

#### Security (slskd-specific)
- Path traversal security fix in slskd webhook handler
- Unicode normalization before path validation (prevent bypass attacks)

#### Documentation
- Add slskd rate limiting operations guide


---

## [v1.1.2] - 2026-01-08

### Fixed
- Fix subscription scheduler bug - schedules other than "manual" now save correctly
- Fix Spotify Playlist subscription type using incorrect API endpoint
- Fix Spotify Category preset field name mismatch in validation
- Fix Issue #16 "Spotify Subscription - Please fill in all required fields"

### Changed
- Website updates

---

## [v1.1.1] - 2026-01-05

### Added
- **Recommendation-Only Mode**: Mixarr now works without Lidarr connection
  - Subscriptions work in `preview` and `queue` modes
  - Discovered artists land in Review Queue for later import
- **Jellyfin Integration**: Similar artists based on Jellyfin listening history
  - Direct Jellyfin API connection (no Tautulli required)
  - Test connection, user selection, library browsing
  - jellyfin_similar subscription type
- **ListenBrainz Weekly Types**: Weekly Jams and Weekly Exploration subscriptions
- **Code Quality Improvements** (5 sprints):
  - Sprint 1: Health check, route param validation, debug cleanup
  - Sprint 2: Connection config types, eliminate `as any`
  - Sprint 3: Zod validation middleware for all routes
  - Sprint 4: Security headers, rate limiting, correlation IDs
  - Sprint 5: Structured JSON logging, request logging, tests

### Fixed
- Fix native ARM64 runner configuration for faster Docker builds
- Improve subscription modal UX with validation and type locking

### Documentation
- Add JSDoc documentation to middleware and utilities
- Archive 12 completed plan documents

---

## [v1.1.0] - 2026-01-04

### Added
- **Docker Image Publishing**: Pre-built images on GitHub Container Registry
  - Multi-architecture support (amd64, arm64)
  - Automated builds on release tags
  - `ghcr.io/aquantumofdonuts/mixarr:latest`
- **Unraid Community Apps**: Template for easy Unraid installation
- **GitHub Pages Website**: Landing page at aquantumofdonuts.github.io/mixarr

### Changed
- Use native ARM64 runners instead of QEMU emulation for faster builds
- Disable font optimization in CI to prevent ARM64 build timeouts

### Documentation
- Add website link and screenshot to README
- Add Plex-centric music management implementation plan

---

## [v1.0.0] - 2025-12-25

### Initial Public Release

#### Music Service Integrations
- **Spotify**: Full OAuth - followed artists, playlists, Discover Weekly, Release Radar, Daily Mix, new releases
- **TIDAL**: Full OAuth - followed artists, playlists, discovery mixes, new arrivals
- **Deezer**: Public API - charts, genre browsing, artist search
- **Last.fm**: API - global/country charts, genre tags, geographic artists, scrobble history, similar artists
- **MusicBrainz**: New release discovery and metadata
- **ListenBrainz**: Top artists, recommendations, similar users
- **Plex/Tautulli**: Similar artists based on Plex listening history

#### Core Features
- **39 Subscription Types**: Automated discovery from charts, playlists, recommendations across all services
- **Review Queue**: Discovered artists land in queue for approval before Lidarr import
- **Universal Search**: Search across Lidarr, Spotify, TIDAL, Deezer, Last.fm, MusicBrainz
- **Library Health**: Analyze Lidarr library for missing metadata, duplicates, enrichment
- **AI-Powered Discovery**: Natural language recommendations via OpenAI, Anthropic, Ollama

#### Platform Features
- Multi-user support with admin/user roles
- SSO authentication (Google OAuth, SAML 2.0, Plex, LDAP)
- PWA support - installable, works offline
- Label browsing - click any label to see all artists
- Notifications via Discord and generic webhooks
- Background jobs with real-time progress via WebSocket
- Docker deployment with Caddy reverse proxy for HTTPS

---

[v2.3.1]: https://github.com/aquantumofdonuts/mixarr/compare/v2.2.0...v2.3.1
[v2.2.0]: https://github.com/aquantumofdonuts/mixarr/compare/v2.1.6...v2.2.0
[v2.1.2]: https://github.com/aquantumofdonuts/mixarr/compare/v2.1.1...v2.1.2
[v2.1.1]: https://github.com/aquantumofdonuts/mixarr/compare/v2.1.0...v2.1.1
[v2.1.0]: https://github.com/aquantumofdonuts/mixarr/compare/v2.0.0...v2.1.0
[v2.0.0]: https://github.com/aquantumofdonuts/mixarr/compare/v1.2.1...v2.0.0
[v1.2.0]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.2...v1.2.0
[v1.1.2]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.1...v1.1.2
[v1.1.1]: https://github.com/aquantumofdonuts/mixarr/compare/v1.1.0...v1.1.1
[v1.1.0]: https://github.com/aquantumofdonuts/mixarr/compare/v1.0.0...v1.1.0
[v1.0.0]: https://github.com/aquantumofdonuts/mixarr/releases/tag/v1.0.0
