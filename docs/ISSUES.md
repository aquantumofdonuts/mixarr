# Mixarr Issues & Technical Debt

> **Last Updated:** October 9, 2026
> **Status:** PRODUCTION READY (v2.3.5) — Collaboration Constellation unreleased on `dev`
> 
> For completed issues, see [ISSUES-FIXED.md](ISSUES-FIXED.md)  
> For future feature ideas, see [ROADMAP.md](ROADMAP.md)
> 
> The three Feb 18 implementation plans (critical security, input validation, architecture) shipped in v2.1.x–v2.2.0 and are archived under [plans/archive/](plans/archive/).

---

## 🔴 OPEN SECURITY FINDINGS (from the 2026-07-04 adversarial review)

The 2026-10-07 snapshot identified six merge-blocking items from [plans/2026-07-04-adversarial-code-review.md](plans/2026-07-04-adversarial-code-review.md). Item 5 and the user-facing ownership portion of item 6 are repaired and verified on the local `feat/music-catalog-ux` branch; they have not been integrated or released. The remaining findings stay open:

1. SAML accepts unsigned assertions and an empty IdP certificate — `apps/api/src/auth/strategies/saml.ts`
2. Plex `restrictToServerId` is declared but never enforced — `apps/api/src/auth/strategies/plex.ts`
3. No session regeneration on login (session fixation) — `apps/api/src/auth/passport.ts` and every `logIn` path
4. Connection config is an open record (`z.record(z.unknown())`), bypassing per-type schemas; SSRF surface on test endpoints — `apps/api/src/schemas/connection.ts`, `apps/api/src/routes/connections.ts`
5. **Resolved locally:** Result rejection reads by result ID, subscription ID, and owner, then conditionally writes with that ownership scope and the expected status/revision — `apps/api/src/routes/subscriptions.ts`. T07 implemented the fix; T15 reverified foreign owners (including admins), foreign result bindings, active claims, and competing decisions in `tests/api/subscription-decisions.test.ts`. Approval uses the same ownership boundary.
6. **Partially resolved locally:** T25 scopes user-facing slskd search/download operations to owned connections (administrators retain access), rejects foreign tracking mutations before effects, and retries through the record's exact active connection. Independent spec/quality reviews passed actual router/auth tests with mocked external boundaries. The webhook still sits behind session auth and uses unscoped configuration/record matching; those findings remain open — `apps/api/src/routes/slskd.ts`.

Follow-up items 9 (per-artist error isolation) and 13 (pagination clamping) from that review have shipped.

---

## 🐛 OPEN GITHUB ISSUES WITH KNOWN FIXES

- **#81 — TIDAL subscriptions 404.** All seven calls in `apps/api/src/services/tidal.ts` use the `/userCollections/{id}` and `/userRecommendations/{id}` paths TIDAL removed on 2026-09-14; the issue lists the replacement `/userCollection*/me/…` paths.
- **#66 — "No test handler for type: slskd".** The `connectionTestHandlers` map in `apps/api/src/routes/connections.ts` has no `slskd` entry; the pre-save test endpoint in the same file does.

---

## UI/UX catalog redesign (in progress)

**Status:** Local product `ffeb12352704b404130fc73c27ff661c032c7733` is independently SPEC/QUALITY reviewed. T28 has explicit five-surface gallery approval and final 22-check authentic Chromium native-200%-zoom proof. T29's complete regenerated matrix reports 136/137 COMPLETE, with genuine external-provider acceptance C137 pending; gate INCOMPLETE. T30 integrated code QUALITY is PASS with no open confirmed Critical/Important findings. Root final verification passed 2,592 API tests (39 skipped), 825 web tests, 194 Chromium and 64 Firefox/mobile browser checks; builds/types/uncached lint passed with existing warnings. Independent backend review passed 877 tests including actual disposable MySQL/Redis; web review passed 89 fresh tests. The actual Settings first-dirty-commit race and mobile player occlusion have causal repairs and retained regressions; outcome consumers now distinguish new/existing membership. The owner-approved hard 300-node cap remains intact. The injected Preview-history observation remains latent; baseline account submissions and legacy automatic-import workers are not certified by this scope. Owned runtimes/test containers are removed; the original main-checkout specification edits are preserved. See the [completion matrix](plans/2026-10-07-music-catalog-ux-completion.md), [full review](plans/2026-10-09-music-catalog-ux-full-review.md), [checkpoint](plans/2026-10-08-music-catalog-ux-progress.md) and [visual review](plans/2026-10-09-music-catalog-visual-review.md). No provider waiver, integration or release is claimed.
**Scope:** R01–R28/I01: the 25 UI/UX review recommendations, a distinctive music-catalog identity with the user-confirmed compact artwork-thumbnail feed, and the three October 8 Constellation follow-ups.

- [Design and acceptance criteria](plans/2026-10-07-music-catalog-ux-design.md)
- [Implementation tasks and verification gates](plans/2026-10-07-music-catalog-ux-plan.md)
- [Execution checkpoint and resume instructions](plans/2026-10-08-music-catalog-ux-progress.md)
- [Constellation amendment findings and accepted cap decision](plans/2026-10-08-music-catalog-amendment-review.md)

This initiative includes truthful acquisition feedback, artist/source drilldown, queue pagination, safe reversible decisions, and consistent responsive controls. Existing security findings above remain tracked independently; affected mutations must satisfy their scope checks before being exposed by the new UI.

---

## 🔧 TECHNICAL DEBT (Deferred)

### Account profile/password client routes do not match the API

**Priority:** Medium

**Status:** Backlog; preexisting functional limitation

**Verified:** October 9, 2026

The account page calls `PUT /api/auth/profile` and `POST /api/auth/password`; the Users page also calls the latter for the current account. `apps/api/src/routes/auth.ts` registers neither endpoint. These same client calls exist at baseline `d1aec6c`, before the catalog rollout. T27 changes their visual treatment only; its screenshot/browser checks do not establish working profile/password submission. Existing admin reset-password routing is a separate operation.

Repair the account forms against an explicitly validated, authenticated server contract in a separate functional change. Do not treat the catalog's visual acceptance as acceptance of these submissions. Evidence: `apps/web/src/app/users/me/page.tsx:38,55`, `apps/web/src/app/users/page.tsx:79`, and the registered `authRouter` methods in `apps/api/src/routes/auth.ts`.

### TD-009: Unify "Artist Added" Tracking Across Add Paths

**Priority:** Low  
**Status:** Backlog  
**Added:** February 9, 2026

Artists can be added to Lidarr through multiple paths, each tracking the addition in a different table:
- **Subscriptions/Feed** → `SubscriptionResult` with `status: 'added'`
- **Review Queue** → `ReviewItem` with `status: 'approved'`

The local catalog implementation no longer sums these decision records as confirmed distinct additions. Its owner-scoped dashboard explicitly counts subscription result records marked added in the last 30 days; repeated artist identities and legacy evidence remain possible. A cross-path ledger of confirmed distinct acquisitions is still a separate backlog item.

**Proposed fix:** Create a unified `artist_additions` audit table (or similar) that all add paths write to, so dashboard stats only need one query. This also enables better analytics (e.g., "added via subscription" vs "added via review queue").

**Files involved:**
- `apps/api/src/routes/dashboard.ts` — explicit owner-scoped record counts
- `apps/api/src/routes/imports.ts` — review queue approval (lines ~305-390)
- `apps/api/src/services/FeedService.ts` — feed approval
- `apps/api/src/jobs/subscription-worker.ts` — auto-add

---

### TD-006: OpenAI SDK Placeholder API Key

**Priority:** Low  
**Created:** January 31, 2026  
**Status:** Deferred

**Problem:**
The AI service uses a placeholder API key (`ollama-local-no-key-required`) when connecting to OpenAI-compatible endpoints that don't require authentication (e.g., Ollama). The OpenAI SDK requires a non-empty apiKey parameter, so this workaround is necessary.

**Location:** `apps/api/src/services/ai.ts`

**Future:**
Investigate if newer OpenAI SDK versions allow null/empty keys with custom baseURL. If so, remove the placeholder for cleaner code.

---

### TD-001: Migrate LDAP from deprecated ldapjs to ldapts

**Priority:** Medium  
**Created:** January 2, 2026  
**Status:** Deferred

**Problem:**
Build warnings show `ldapjs@2.3.3` is deprecated. The dependency chain is:
- `passport-ldapauth@3.0.1` → `ldapauth-fork@5.0.5` → `ldapjs@2.3.3` (deprecated)
- `passport-ldapauth` last updated June 2022 (3+ years stale)

**Solution:**
Replace `passport-ldapauth` with `ldap-authentication` package which uses `ldapts` (actively maintained, last updated Dec 2025).

**Migration Steps:**
1. Install `ldap-authentication` package
2. Create custom Passport strategy wrapping `ldap-authentication`
3. Update `apps/api/src/auth/strategies/ldap.ts` to use new library
4. Update tests
5. Remove `passport-ldapauth` dependency

**Files Affected:**
- `apps/api/package.json`
- `apps/api/src/auth/strategies/ldap.ts`
- Related tests

**Notes:**
- LDAP is a critical feature, migration required eventually
- `whatwg-encoding` deprecation warning (from cheerio) is benign and can be ignored

---

### TD-002: Lidarr Rescan Behavior Causes Full Library Scans

**Priority:** High (User Impact)  
**Created:** January 3, 2026  
**Status:** Documented - Workaround Available

**Problem:**
When Mixarr's Library Health features trigger `RefreshArtist` commands for existing artists in Lidarr, each refresh causes a full root folder scan (not just the artist's folder). This is due to Lidarr's internal behavior in `RefreshArtistService.RescanArtists()`:

```csharp
// For NEW artists: scans only artist folder
if (isNew) {
    folders = artists.Select(x => x.Path).ToList();
}
// For EXISTING artists: scans ALL root folders by default
else {
    folders = _rootFolderService.All().Select(x => x.Path).ToList();
}
```

When bulk refresh operations are triggered (e.g., "Refresh Incomplete Artists"), this queues many `RefreshArtist` commands, each triggering a full library scan. With large libraries (30K+ files), these scans can take hours and queue up for days.

**Affected Mixarr Features:**
- Library Health → Refresh single artist
- Library Health → Bulk refresh incomplete artists
- Library Health → Bulk refresh by issue type

**Workaround (Recommended):**
In Lidarr, go to **Settings → Media Management** and set **"Rescan Artist Folder after Refresh"** to **Never**.

This will:
- ✅ Still scan new artist folders when added from Mixarr
- ✅ Stop existing artist refreshes from triggering full library scans
- ✅ Allow manual rescans when actually needed

**Notes:**
- Adding NEW artists is not affected - those always scan only the artist's folder
- This is Lidarr's internal behavior, not something Mixarr can control via API
- Users with large libraries should set this to "Never" before using bulk refresh features

---

## Future Enhancements

### SSO Provider Credential Encryption
**Priority:** Medium | **Type:** Security Enhancement | **Created:** 2026-01-11

**Description:**
Currently SSO provider credentials (OAuth client secrets, LDAP bind passwords, SAML certificates) are stored in plain text in the database. While database access is restricted and connections are encrypted, adding application-level encryption provides defense-in-depth.

**Proposed Solution:**
- Encrypt secrets at rest using AES-256-GCM
- Store encryption key in environment variable or secrets manager
- Implement key rotation capability
- Transparent encrypt/decrypt in sso-provider service

**Impact:**
- Additional protection against database compromise
- Compliance with security best practices for credential storage
- Minimal performance impact (encrypt once on write, decrypt on read)

**Files Affected:**
- `apps/api/src/services/sso-provider.ts` - Add encrypt/decrypt methods
- `apps/api/prisma/schema.prisma` - Consider separate encrypted fields
- `apps/api/src/lib/crypto.ts` - Encryption utility (new file)

**Complexity:** Medium (2-3 days)

**References:**
- OWASP Cryptographic Storage Cheat Sheet
- Node.js crypto module documentation

---

### Cache Connection Resolution in Redis
**Priority:** Low | **Type:** Performance | **Created:** 2026-02-10

**Description:**
Connection resolution (`getLidarrService()`, `getLastfmService()`, etc. in `connection-resolver.ts`) hits the database on every API request — often multiple times per request across 20+ route handlers. The connection config rarely changes mid-session.

**Proposed Solution:**
- Cache `connection:{type}:{userId}` in Redis with 5-minute TTL
- Invalidate cache keys on connection CRUD operations in the connections route
- TTL acts as safety net if invalidation is missed

**Current Impact:**
- ~5-20ms saved per request (single indexed DB query)
- Individually small, but significant in aggregate across all route handlers
- Reduces DB connection pool pressure under load

**Decision:** Deferred — the DB query is fast (~5ms), and cache invalidation on CRUD adds complexity. Revisit if DB load becomes a concern or if connection resolution shows up in profiling.

**Files Affected:**
- `apps/api/src/lib/connection-resolver.ts` — Add cache-aside pattern
- `apps/api/src/routes/connections.ts` — Add cache invalidation on create/update/delete

---

### Extract getLidarrServiceWithConfig to Shared Module
**Priority:** Low | **Type:** Code Quality | **Created:** 2026-01-17

**Description:**
The `getLidarrServiceWithConfig()` helper function is duplicated in `discover.ts` and `search.ts`. This should be extracted to a shared service factory module.

**Proposed Solution:**
- Create `apps/api/src/lib/service-factory.ts`
- Move `getLidarrServiceWithConfig()` (and similar helpers) to shared module
- Import from shared module in routes

**Files Affected:**
- `apps/api/src/lib/service-factory.ts` (new file)
- `apps/api/src/routes/discover.ts`
- `apps/api/src/routes/search.ts`

**Complexity:** Low (30 minutes)

---

### Refactor addArtist to Use Options Object Pattern
**Priority:** Low | **Type:** Code Quality | **Created:** 2026-01-17

**Description:**
`LidarrService.addArtist()` and `addArtistWithRefresh()` use positional boolean parameters with inline comments, making calls hard to read and error-prone. The deprecated `_waitForRefresh` parameter is still required for API compatibility.

**Current Pattern:**
```typescript
await lidarr.addArtistWithRefresh(
  mbid, qpId, mpId, rfPath,
  true,  // monitored
  true,  // searchForMissingAlbums
  false, // waitForRefresh (deprecated)
  'all'  // monitorOption
);
```

**Proposed Solution:**
```typescript
interface AddArtistOptions {
  monitored?: boolean;
  searchForMissingAlbums?: boolean;
  monitorOption?: LidarrMonitorOption;
}

await lidarr.addArtist(mbid, qpId, mpId, rfPath, {
  monitored: true,
  searchForMissingAlbums: true,
  monitorOption: 'all'
});
```

**Files Affected:**
- `apps/api/src/services/lidarr.ts`
- All callers (8+ locations)

**Complexity:** Medium (1-2 hours)

---

### Add MonitorOption Validation to Lidarr Settings
**Priority:** Low | **Type:** Validation | **Created:** 2026-01-17

**Description:**
The `monitorOption` field accepts any string but Lidarr API only accepts specific values: `'all'`, `'future'`, `'missing'`, `'existing'`, `'first'`, `'latest'`, `'none'`. Invalid values would cause Lidarr API errors.

**Current State:**
- `LidarrMonitorOption` type union added to `types/connections.ts`
- Connection settings UI doesn't validate against this

**Proposed Solution:**
- Add Zod schema for connection config with enum validation
- Validate on connection save in settings routes
- Use `LidarrMonitorOption` type in frontend dropdown

**Files Affected:**
- `apps/api/src/schemas/connection.ts` (if exists, or create)
- `apps/api/src/routes/settings.ts`
- `apps/web/src/app/connections/page.tsx`

**Complexity:** Low (1 hour)

---

## 🏗️ ARCHITECTURE: Separation of Concerns Violations

**Priority:** Medium-High | **Type:** Architecture | **Created:** 2026-01-18

A comprehensive review identified violations of three-tier architecture (Database → API → Frontend). These issues create tight coupling, duplicate logic, and maintenance burden.

### SOC-001: Frontend Business Logic - Soulseek Quality Scoring

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SearchModal.tsx](apps/web/src/components/modals/SearchModal.tsx) contains a `scoreResult()` function with hardcoded business rules for ranking Soulseek search results (50 pts lossless, 30 pts upload speed, 10 pts free slot, -10 pts queue length).

**Impact:**
- Scoring algorithm can't be adjusted without frontend deployment
- Different frontends would need to duplicate this logic
- Business rules scattered across tiers

**Solution:** Move to API - return `qualityScore` field from slskd search endpoint.

---

### SOC-002: Frontend Business Logic - Audio Format Classification

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SearchModal.tsx](apps/web/src/components/modals/SearchModal.tsx) contains `getFileFormat()` and `isLossless()` functions that classify audio file formats.

**Impact:**
- Format definitions can't be centralized
- Adding new format support requires frontend changes
- Domain knowledge duplicated

**Solution:** API should return `format` and `isLossless` fields on file objects.

---

### SOC-003: Frontend Business Logic - Subscription Type Metadata

**Priority:** High | **Severity:** High | **Status:** ✅ Resolved — `GET /api/subscriptions/types` exists in `apps/api/src/routes/subscriptions.ts`

**Problem (historical):**
[apps/web/src/components/subscriptions/](apps/web/src/components/subscriptions/) contains 50+ subscription types with required fields, descriptions, icons, and validation rules hardcoded in frontend.

**Impact:**
- Backend and frontend can get out of sync
- Adding subscription types requires coordinated changes
- Validation logic duplicated between tiers

**Solution:** Create `GET /api/subscriptions/types` endpoint that returns type metadata, required fields, descriptions.

---

### SOC-004: Frontend Business Logic - Subscription Config Building

**Priority:** High | **Severity:** High

**Problem:**
[apps/web/src/components/modals/SubscriptionModal.tsx](apps/web/src/components/modals/SubscriptionModal.tsx) contains 30+ lines of `buildConfig()` logic that constructs type-specific config objects.

**Impact:**
- Config structure duplicated between frontend and API
- Frontend knows too much about API data shapes
- Adding config fields requires frontend changes

**Solution:** API should accept form-ready data or provide schema-driven form configuration.

---

### SOC-005: API Missing Service Layer - Direct Prisma in Routes

**Priority:** High | **Severity:** High

**Problem:**
Multiple route files access Prisma directly instead of going through service layer:
- [apps/api/src/routes/users.ts](apps/api/src/routes/users.ts) - No `UserService`
- [apps/api/src/routes/connections.ts](apps/api/src/routes/connections.ts) - No `ConnectionService`
- [apps/api/src/routes/importSources.ts](apps/api/src/routes/importSources.ts) - No `ImportSourceService`
- [apps/api/src/routes/settings.ts](apps/api/src/routes/settings.ts) - No `SettingsService`
- [apps/api/src/routes/notifications.ts](apps/api/src/routes/notifications.ts) - Channel CRUD in route
- [apps/api/src/routes/logs.ts](apps/api/src/routes/logs.ts) - No `LogService`
- [apps/api/src/routes/duplicates.ts](apps/api/src/routes/duplicates.ts) - No `DuplicateService`
- [apps/api/src/routes/ai.ts](apps/api/src/routes/ai.ts) - No `AISettingsService`

**Impact:**
- Business logic mixed with HTTP concerns
- Harder to test business logic in isolation
- Code reuse difficult across routes/workers

**Solution:** Extract service classes for each domain.

---

### SOC-006: API Presentation Logic - UI Text in Backend

**Priority:** Medium | **Severity:** Medium

**Problem:**
- [apps/api/src/routes/webhooks.ts](apps/api/src/routes/webhooks.ts) contains `formatEventLabel()` and `getEventDescription()` with UI-facing text
- [apps/api/src/lib/subscriptions/presets.ts](apps/api/src/lib/subscriptions/presets.ts) has massive preset data with UI descriptions
- [apps/api/src/routes/dashboard.ts](apps/api/src/routes/dashboard.ts) generates description strings like "Added X artists"

**Impact:**
- UI text changes require API deployment
- Localization would be harder
- Presentation concerns in API layer

**Solution:** API returns raw data, frontend handles formatting and display text.

---

### SOC-007: API Data Layer Leakage - Prisma Models in Responses

**Priority:** Medium | **Severity:** Medium

**Problem:**
Multiple routes return raw Prisma model objects without DTO transformation:
- Connection routes expose internal Prisma fields
- Subscription routes expose raw model structure
- User routes expose internal `_count` structures

**Impact:**
- Frontend tightly coupled to database schema
- Can't change DB schema without breaking frontend
- Internal fields potentially exposed

**Solution:** Create DTOs (Data Transfer Objects) for API responses.

---

### SOC-008: Duplicate Helper Functions Across Routes

**Priority:** Low | **Severity:** Medium

**Problem:**
- `getActiveConnection()` duplicated in 3+ route files
- `resolveConnectionWithDefaults()` duplicated across routes
- Similar patterns for connection resolution

**Impact:**
- Bug fixes need to be applied in multiple places
- Inconsistent behavior possible
- Code bloat

**Solution:** Create `ConnectionResolverService` with shared helpers.

---

### Implementation Plan Reference
See [docs/plans/2026-01-18-separation-of-concerns-refactor.md](docs/plans/2026-01-18-separation-of-concerns-refactor.md) for detailed implementation plan.

### Recommended Implementation Order

**Prerequisites:** Fix the 40 failing tests (TD-003, TD-004, TD-005) before major refactoring. Hard to know if refactoring breaks something when tests are already broken.

| Phase | Issues | Risk | Notes |
|-------|--------|------|-------|
| **Phase 1** | SOC-001, SOC-002, SOC-006, SOC-008 | 🟢 Low | Safe wins - pure refactors, no behavior change |
| **Phase 2** | SOC-005, SOC-007 | 🟡 Medium | Extract service layer, add DTOs - coordinated frontend/backend changes |
| **Phase 3** | SOC-003 | ✅ Done | Subscription type metadata API (`GET /api/subscriptions/types`) |
| **Phase 4** | SOC-004 | 🔴 High | Subscription config building - core functionality, defer until everything else is stable |

**Total estimated effort:** 2-3 weeks with proper TDD

---

## 🔒 SECURITY

### SEC-001: Unauthenticated SSRF via Connection Test Endpoint

**Priority:** High  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
The setup connection-test endpoint allows unauthenticated users to make the server send HTTP requests to arbitrary URLs. An attacker can use the Mixarr server to probe internal network services, scan ports behind the firewall, or access cloud metadata endpoints (e.g., `http://169.254.169.254/`).

**Location:** `apps/api/src/routes/setup.ts` — connection test endpoint accessible without auth

**Solution:**
Move the endpoint behind authentication, or at minimum behind a setup-mode guard so it's only accessible when no users exist yet.

**Estimated Effort:** 30 minutes

---

### SEC-002: MemoryStore Used for Sessions Instead of Redis

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
`express-session` uses the default `MemoryStore` despite Redis already running in the Docker stack. MemoryStore leaks memory over time (no automatic session cleanup), loses all sessions on container restart, and prevents horizontal scaling.

**Location:** `apps/api/src/index.ts` — session configuration

**Solution:**
Use `connect-redis` with the existing Redis instance for session storage. The `ioredis` client is already available in the codebase.

**Estimated Effort:** 1 hour

---

### SEC-003: Secrets Stored Plaintext in Database

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
Connection configs (Lidarr API keys, Spotify OAuth tokens, Last.fm keys), SSO provider configs (OAuth client secrets, LDAP bind passwords, SAML certificates), and AI API keys are stored as unencrypted JSON in the database. The Prisma schema comments say "Encrypted credentials" but no encryption is implemented. A database compromise exposes all third-party credentials.

**Related:** Overlaps with "SSO Provider Credential Encryption" in Future Enhancements — this issue expands scope to ALL stored secrets, not just SSO.

**Location:**
- `apps/api/prisma/schema.prisma` — `config Json` fields on `connections`, `sso_providers`, `ai_settings`
- `apps/api/src/services/sso-provider.ts`

**Solution:**
- Implement AES-256-GCM encryption using a dedicated `ENCRYPTION_KEY` env var
- Create `apps/api/src/lib/crypto.ts` with encrypt/decrypt utilities
- Transparent encrypt on write, decrypt on read in service layers
- Migration to encrypt existing plaintext values

**Estimated Effort:** 2-3 days

---

### SEC-004: Docker Containers Run as Root

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
The API production Dockerfile and the unified Dockerfile do not drop privileges — processes run as root inside the container. A container escape vulnerability would grant root access on the host.

**Location:**
- `apps/api/Dockerfile` — no `USER node` in production stage
- `docker/Dockerfile.unified` — supervisor runs as root
- `docker/Dockerfile.slim` — no USER directive

**Solution:**
- Add `USER node` to the production stage of `apps/api/Dockerfile`
- Configure supervisor in the unified image to run app processes as the `node` user
- Ensure file permissions are set correctly during build

**Estimated Effort:** 1-2 hours

---

### SEC-005: `prisma db push --accept-data-loss` in Production Entrypoint

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
The production entrypoint runs `npx prisma db push --accept-data-loss` on every container start. This flag allows Prisma to silently drop columns or tables if the schema diverges from the database. On a version upgrade with schema changes, this could destroy user data without warning.

**Location:**
- `docker/entrypoint-slim.sh`
- `apps/api/Dockerfile` — entrypoint command

**Solution:**
Migrate to `prisma migrate deploy` for production schema changes:
- Generate migration files during development with `prisma migrate dev`
- Run `prisma migrate deploy` in production entrypoint (applies pending migrations, never drops data)
- Keep `db push` for development only

**Related:** See `docs/plans/2026-01-19-prisma-migrate-design.md` for existing design doc.

**Estimated Effort:** 4-6 hours (includes generating initial baseline migration)

---

### SEC-006: Unauthenticated Base URL Setter

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
The setup endpoint that sets the application base URL does not verify authentication or check whether initial setup is complete. An attacker could change the base URL to an attacker-controlled domain, potentially redirecting OAuth callbacks and capturing tokens.

**Location:** `apps/api/src/routes/setup.ts` — base URL endpoint

**Solution:**
Guard the endpoint so it's only accessible during initial setup (no users exist) or by authenticated admins.

**Estimated Effort:** 15 minutes

---

### SEC-007: Deactivated Users Retain Active Sessions

**Priority:** Low  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
When an admin deactivates a user (`isActive = false`), the user's existing session continues to work until it naturally expires (24 hours). The `deserializeUser` callback in Passport fetches the user from the database but does not check the `isActive` flag.

**Location:** `apps/api/src/auth/passport.ts` — `deserializeUser` callback

**Solution:**
Add `isActive` check in `deserializeUser`:
```typescript
if (!user || !user.isActive) {
  return done(null, false);
}
```

**Estimated Effort:** 10 minutes

---

### SEC-008: Connection Test Leaks Internal Network Details in Error Messages

**Priority:** Low  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
The connection test endpoint returns raw `err.message` in its response. When a connection fails, error messages like `ECONNREFUSED http://lidarr:8686` or `getaddrinfo ENOTFOUND internal-host.local` leak internal hostnames, Docker service names, and network topology to the client.

**Location:** `apps/api/src/routes/connections.ts` — connection test catch blocks

**Solution:**
Sanitize error messages before returning to the client — return a generic "Connection failed" message with a safe error code, log the full error server-side for debugging.

**Estimated Effort:** 30 minutes

---

### SEC-009: Missing Timeouts on External API Calls

**Priority:** Low  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
Most external API calls (Last.fm, Spotify, Deezer, MusicBrainz, ListenBrainz, Discogs, TIDAL) use bare `fetch()` without explicit timeout handling. A hung upstream service could hold connections open indefinitely, eventually exhausting server resources (file descriptors, memory, event loop).

**Location:**
- `apps/api/src/services/lastfm.ts`
- `apps/api/src/services/spotify.ts`
- `apps/api/src/services/deezer.ts`
- `apps/api/src/services/musicbrainz.ts`
- `apps/api/src/services/listenbrainz.ts`
- `apps/api/src/services/tidal.ts`
- `apps/api/src/services/discogs.ts`

**Solution:**
Create a shared `fetchWithTimeout` wrapper (using `AbortSignal.timeout()`) with a 30-second default, and use it in all external API service calls.

**Estimated Effort:** 1-2 hours

---

## New Issues

<!-- Add new issues below this line -->

### TD-009: FeedCard formatListeners Missing Negative Number Guard

**Priority:** Low  
**Created:** February 2, 2026  
**Status:** Backlog

**Problem:**
The `formatListeners` helper in `FeedCard.tsx` doesn't guard against negative numbers. While listener counts from the API should always be positive, a defensive check would prevent unexpected display of "-1K listeners" if bad data reached the frontend.

**Location:** `apps/web/src/components/feed/FeedCard.tsx:10-18`

**Solution:**
Add guard at start of function:
```typescript
if (count < 0) return '0';
```

**Estimated Effort:** 5 minutes

---

### TD-010: FeedCard Tag Key Uses Value Instead of Index

**Priority:** Low  
**Created:** February 2, 2026  
**Status:** Backlog

**Problem:**
In `FeedCard.tsx`, tag rendering uses `key={tag}` which could cause React duplicate key warnings if the backend ever sends duplicate tags (currently prevented by Set deduplication in FeedService).

**Location:** `apps/web/src/components/feed/FeedCard.tsx:139`

**Current Code:**
```tsx
{tags!.map((tag, idx) => (
  <span key={tag} className="inline-flex items-center">
```

**Solution:**
Use composite key for safety:
```tsx
{tags!.map((tag, idx) => (
  <span key={`tag-${idx}`} className="inline-flex items-center">
```

**Estimated Effort:** 2 minutes

---

### TD-011: Lidarr Library Cancel Buttons Do Not Cancel "Fix All" Job

**Priority:** Medium  
**Created:** February 2, 2026  
**Status:** Backlog

**Problem:**
On the Lidarr Library page, clicking "Cancel" does not actually cancel the running "Fix All" metadata job. The UI appears to acknowledge the action, but the background job continues.

**Location:** `apps/web/src/app/library/page.tsx` (UI) and relevant API/job cancel endpoint (TBD)

**Expected Behavior:**
Cancel button should terminate the "Fix All" job and update the UI state accordingly.

**Estimated Effort:** 30-60 minutes

---

### TD-012: Convert handleSaveGlobal to Bulk PUT Endpoint

**Priority:** Low  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
`handleSaveGlobal` in `apps/web/src/app/settings/page.tsx` loops through global settings and sends a separate `PUT /api/settings/global/:key` for each one. This is N requests for N settings, and non-atomic (partial saves on failure).

**Location:** `apps/web/src/app/settings/page.tsx:160-172` (frontend) and `apps/api/src/routes/settings.ts` (API)

**Solution:**
Add a bulk `PUT /api/settings/global` endpoint (same pattern as the `PUT /api/settings` bulk route added for user settings), then update `handleSaveGlobal` to use it.

**Estimated Effort:** 15 minutes

---

### TD-013: Slskd Router Not Mounted — "Search on Soulseek" Returns 404

**Priority:** High  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
Clicking "Search on Soulseek" on review queue items returns a 404 (Express default HTML). The slskd router in `apps/api/src/routes/slskd.ts` is never mounted in `apps/api/src/index.ts`. Only the named export `cleanupQueueEvents` is imported — the default router export is not imported or registered.

**Location:** `apps/api/src/index.ts:34` (import) and `apps/api/src/index.ts:123-139` (route registration block)

**Fix:**
1. Update import: `import slskdRouter, { cleanupQueueEvents } from './routes/slskd.js';`
2. Add mount: `app.use('/api/slskd', slskdRouter);` in the route registration block

**Estimated Effort:** 5 minutes + tests

---

### TD-014: Graceful Error When Searching Soulseek With No Connection Configured

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** Backlog

**Problem:**
After TD-013 is fixed, clicking "Search on Soulseek" with no slskd connection configured will likely produce a 500 error (attempting to connect to a non-existent slskd instance). Users should see a clear, friendly message instead of a server error.

**Location:** `apps/api/src/routes/slskd.ts` (search endpoint), `apps/web/src/components/` (search modal)

**Fix:**
1. API: Check for active slskd connection before attempting search; return a proper JSON error (e.g., `{ error: "No Soulseek connection configured" }`) with an appropriate status code (e.g., 400 or 503)
2. Frontend: Display the error message cleanly in the search modal instead of a generic "Server error" toast

**Estimated Effort:** 20 minutes

---
### TD-015: Website SEO Optimization for Discoverability

**Priority:** Medium  
**Created:** February 10, 2026  
**Status:** ✅ Complete (February 10, 2026)  
**Location:** `website/index.html`, `website/` (new files)

**Problem:**
The landing page at `https://aquantumofdonuts.github.io/mixarr/` is missing standard SEO elements that prevent discovery via search engines and produce poor previews when shared on Reddit, Discord, and Twitter/X.

**What's missing (in priority order):**

1. **Open Graph + Twitter Card meta tags** — sharing on Reddit /r/selfhosted, Discord, X shows no preview image or description
2. **JSON-LD structured data** (`SoftwareApplication` schema) — no rich results in Google
3. **Canonical URL** (`<link rel="canonical">`) — GitHub Pages may index duplicate with/without trailing slash
4. **Rewrite title + description** — current title "The missing piece for Lidarr" doesn't tell Google what it is; description missing high-value keywords: "self-hosted", "Docker", "open source", "arr stack", "music automation", "Spotify to Lidarr"
5. **`robots.txt` + `sitemap.xml`** — standard crawler guidance files, both missing entirely
6. **`loading="lazy"` on below-fold images** — Core Web Vitals / page speed improvement
7. **`.nojekyll` file** — prevents GitHub Pages Jekyll processing issues
8. **`<meta name="theme-color">`** — brand color in mobile browsers
9. **`<link rel="apple-touch-icon">`** — iOS bookmark icon
10. **404.html** — custom 404 instead of GitHub's generic page

**Keyword opportunities not present on the page:**
"self-hosted music discovery", "arr stack", "music automation", "Lidarr companion", "Lidarr recommendations", "Spotify to Lidarr", "free open source", "Docker music app"

**Estimated Effort:** 1 hour

---

### TD-016: Missing Zod Validation on ~80% of API Endpoints

**Priority:** High  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 2, Tasks 1-7](plans/2026-02-18-input-validation-error-handling-plan.md)

**Problem:**
Only 4 route files use Zod validation (connections, subscriptions, feed, notifications, admin users). The remaining 8 route files accept `req.body` and `req.params` without schema validation: ai.ts, slskd.ts, discover.ts, settings.ts, sso.ts, imports.ts, jobs.ts, duplicates.ts.

**Impact:** Type confusion, potential injection, DoS via malformed input.

**Estimated Effort:** 2-3 days

---

### TD-017: Subscription Worker God-File (2,312 lines)

**Priority:** High  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 3, Phase A](plans/2026-02-18-architecture-code-quality-plan.md)

**Problem:**
`apps/api/src/workers/subscription-worker.ts` is a single 2,312-line file with a massive switch statement handling 20+ subscription types. It mixes source fetching, artist matching, Lidarr communication, review queue management, notifications, and logging.

**Solution:** Extract into strategy pattern — one strategy class per service (Spotify, Last.fm, Deezer, etc.), with the worker as a thin dispatcher.

**Estimated Effort:** 3-5 days

---

### TD-018: Silent Catch Blocks (auth.ts, imports.ts, connections.ts)

**Priority:** Medium  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 1, Task 9](plans/2026-02-18-critical-security-reliability-plan.md)

**Problem:**
~13 catch blocks across auth.ts (6), imports.ts (4), and connections.ts (3) silently swallow errors without logging. Production issues become invisible — the user gets a generic 500, but nothing appears in logs.

**Estimated Effort:** 30 minutes

---

### TD-019: Fake/Tautological Test Files

**Priority:** Medium  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 1 Task 6, Plan 3 Phase C](plans/2026-02-18-critical-security-reliability-plan.md)

**Problem:**
- `tests/security/security.test.ts` (332 lines): Tests hardcoded strings and local variables. Zero HTTP requests, zero middleware tests. Every test passes tautologically.
- `tests/workers/scheduler.test.ts` (295 lines): Tests mock objects directly instead of importing the actual scheduler module. Verifies mocks do what they're told to do.

**Solution:** Delete security.test.ts (dangerous false confidence). Rewrite scheduler.test.ts to import and test the real module.

**Estimated Effort:** 2-3 hours

---

### TD-020: No unhandledRejection/uncaughtException Handlers

**Priority:** Medium  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 1, Task 4](plans/2026-02-18-critical-security-reliability-plan.md)

**Problem:**
No global handlers for unhandled promise rejections or uncaught exceptions in `apps/api/src/index.ts`. Unhandled errors crash the process silently with no logging.

**Estimated Effort:** 10 minutes

---

### TD-021: Missing Fetch Timeouts on External API Calls

**Priority:** Medium  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 2, Task 8](plans/2026-02-18-input-validation-error-handling-plan.md)

**Problem:**
Most external API calls (~14 service files) use bare `fetch()` without timeout handling. A hung upstream service holds connections open indefinitely, eventually exhausting server resources.

**Solution:** Create shared `fetchWithTimeout` wrapper using `AbortSignal.timeout()`.

**Estimated Effort:** 1-2 hours

---

### TD-022: Frontend Test Coverage Gap (5 files vs 102 API)

**Priority:** Medium  
**Created:** February 18, 2026  
**Status:** Backlog  
**Plan:** [Plan 3, Phase E Task E3](plans/2026-02-18-architecture-code-quality-plan.md)

**Problem:**
Only 5 frontend test files exist compared to 102 API test files. Critical UI components (connections page, subscription modal, search page, settings) have zero test coverage.

**Target:** 5 → 25+ test files.

**Estimated Effort:** 3-5 days

---

## 🎯 FEATURE BACKLOG (Competitive — from Aurral Analysis)

> Items identified from competitive analysis against [Aurral](https://github.com/lklynet/aurral) (March 2026).
> These are features where Aurral has a clear UX or capability advantage.

### FB-001: Weekly Flow / Playlist Generation Pipeline

**Priority:** High  
**Created:** March 3, 2026  
**Status:** Backlog  
**Origin:** Aurral competitive analysis — their "killer feature"

**Problem:**
Mixarr discovers artists and adds them to Lidarr, but stops there. Aurral generates weekly playlists from discovery recommendations, downloads actual tracks via a built-in Soulseek client, organizes them into a dedicated folder, and creates Navidrome smart playlists — essentially a self-hosted "Discover Weekly" experience with real audio files.

Mixarr already has slskd integration for downloading, but it's a rudimentary per-track queue — not a curated playlist workflow.

**Proposed Solution:**
- Build a "Flow" system that generates playlists from subscription results (recommended artists → top tracks → download queue)
- Configurable mix modes: discovery, trending, deep dive, tag-based
- Multiple flows per user with adjustable track count and refresh schedule
- Download pipeline leveraging existing slskd integration
- Navidrome integration: create libraries, write smart playlist files (.nsp), trigger scans
- WebSocket-driven progress tracking (queued → downloading → processing → complete/failed)

**Complexity:** High (1-2 weeks)

---

### FB-002: Tag/Genre-Based Discovery UI

**Priority:** Medium  
**Created:** March 3, 2026  
**Status:** Backlog  
**Origin:** Aurral competitive analysis — Discover page UX

**Problem:**
Mixarr has Last.fm tag subscriptions (data source exists) but no browsable tag/genre discovery experience. Aurral's Discover page features "Because You Like [genre]" sections with artists grouped by tag, clickable genre pills, and a tag search scope toggle (recommended vs. all artists). This makes discovery feel exploratory rather than subscription-configuration-driven.

**Proposed Solution:**
- Add a tag-based discovery section to the Mixarr dashboard/discover page
- Show "Because You Like [tag]" sections derived from the user's library genres
- Clickable tag pills that navigate to filtered artist results
- Tag search with scope toggle (recommended vs. all)
- Pull genre data from Last.fm, Spotify, and MusicBrainz to build user's tag profile

**Files Likely Affected:**
- `apps/web/src/app/discover/` — new discovery sections
- `apps/api/src/routes/discover.ts` — tag aggregation endpoint
- `apps/api/src/services/` — tag profile builder using existing service connections

**Complexity:** Medium (3-5 days)

---

### FB-003: Artist Audio Preview

**Priority:** Medium  
**Created:** March 3, 2026  
**Status:** Backlog  
**Origin:** Aurral competitive analysis — artist detail UX

**Problem:**
When users discover a new artist in Mixarr, they have no way to preview what the artist sounds like without leaving the app. Aurral provides inline audio previews via Deezer top tracks (30-second samples) and Navidrome streaming for library tracks. This dramatically improves the "should I add this?" decision quality.

**Proposed Solution:**
- Add a preview player component to artist search results and the review queue
- Source previews from Deezer (30-second samples, no auth required for previews) as primary source
- Optional Navidrome/Jellyfin streaming for artists already in the user's library
- Minimal player UI: play/pause, progress bar, track name — inline, not a modal
- Preload next track for smooth sequential listening

**Files Likely Affected:**
- `apps/web/src/components/` — new `PreviewPlayer` component
- `apps/api/src/routes/` — preview proxy endpoint (Deezer top tracks API)
- `apps/web/src/app/discover/` and `apps/web/src/app/queue/` — integrate player

**Complexity:** Medium (2-3 days)

---

### FB-004: Recently Added & Upcoming Releases on Dashboard

**Priority:** Low-Medium  
**Created:** March 3, 2026  
**Status:** Backlog  
**Origin:** Aurral competitive analysis — Discover page immediate value

**Problem:**
Aurral's Discover page prominently shows "Recently Added" artists and "Recent & Upcoming Releases" sections, giving users immediate value even before recommendations kick in. Mixarr's dashboard shows stats but doesn't highlight what's new in the library or what's coming up.

**Proposed Solution:**
- Add "Recently Added" section to dashboard showing last N artists added to Lidarr (with album art)
- Add "Upcoming Releases" section showing future release dates for monitored artists
- Data sourced from Lidarr API (`/api/v1/album?includeArtist=true&sort=releaseDate&order=desc`)
- Clickable cards that link to artist detail or Lidarr
- Both sections visible without any subscriptions configured (immediate first-run value)

**Files Likely Affected:**
- `apps/web/src/app/dashboard/` or `apps/web/src/app/discover/` — new sections
- `apps/api/src/routes/dashboard.ts` or new route — Lidarr recent/upcoming queries
- `apps/api/src/services/lidarr.ts` — new methods for recent albums and upcoming releases

**Complexity:** Low-Medium (1-2 days)

---
