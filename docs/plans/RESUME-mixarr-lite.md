# Mixarr Lite — Resume Prompt

> **Paste this entire file as your first message when resuming work.**

---

## Situation

We are building **Mixarr Lite** — a simplified fork of Mixarr — as a greenfield project in a separate repository at `~/Github/mixarr-lite/`. The full Mixarr repo at `~/Github/mixarr/` is the reference for porting business logic (read-only).

A multi-root VS Code workspace file exists at `~/Github/mixarr-dev.code-workspace` that opens both repos side-by-side.

## Relevant Documents

- **Design doc:** `/home/chris/Github/mixarr/docs/plans/2026-03-04-mixarr-lite-design.md`
- **Implementation plan:** `/home/chris/Github/mixarr/docs/plans/2026-03-04-mixarr-lite-plan.md`

## Tech Stack

- **Runtime:** Node.js 20, TypeScript 5, ESM (`"type": "module"`, `.js` extensions in all imports for NodeNext)
- **Backend:** Express 5, Prisma 7 (SQLite via `@prisma/adapter-better-sqlite3`), Socket.IO 4, Zod 4 (`import { z } from 'zod/v4'`)
- **Frontend:** Vite 7, React 19, React Router 7, TanStack Query 5, Tailwind CSS 4 (`@tailwindcss/vite` plugin — no postcss config needed)
- **Testing:** Vitest 4 (globals: true, fileParallelism: false — SQLite requires sequential test files)
- **Key packages:** bcryptjs, cookie-parser, cookie, cookie-signature, helmet, cors, express-rate-limit, concurrently, tsx
- **Prisma:** Output dir is `backend/src/generated/prisma`, adapter pattern (`PrismaBetterSqlite3`), `prisma.config.ts` at root

## Current State: Phase 4 COMPLETE ✅

**28 commits on `main`, 253 tests passing, TypeScript compiles clean.**

### Progress Summary
| Phase | Status | Tests |
|-------|--------|-------|
| Phase 0: Scaffold | ✅ Done | — |
| Phase 1: Backend Foundation (auth, middleware, routes, WebSocket) | ✅ Done | 56 |
| Phase 2: Lidarr Integration | ✅ Done | 84 |
| Phase 3: Discovery Services | ✅ Done | 152 |
| Phase 4: Subscription Engine | ✅ Done | 238 |
| Phase 5: Review Queue | ✅ Done | 253 |
| Phase 6: Frontend Core | ✅ Done | 253 (FE has no unit tests) |
| Phases 7-9 | ⏳ Pending | — |

### Git Log (HEAD = c615401)
```
c615401 feat: add cron-based subscription scheduler
c31df0b feat: add subscription worker with FIFO queue and run engine
d9bc829 feat: add subscription strategies for Spotify, Last.fm, MusicBrainz, Jellyfin, Tautulli
53a49a7 feat: add subscription CRUD routes with Zod validation
ce39018 feat: add search and discover routes
e12f56d feat: add Tautulli service
3fd6f5d feat: add Jellyfin service
41e2599 feat: add Deezer service
c5b5955 feat: add MusicBrainz service
3df4957 feat: add Last.fm service
(earlier commits: Phases 0-2)
```
### Source Files in Place (Phase 6 additions)
```
frontend/src/
  utils/
    api.ts              — typed fetch wrapper: api.get/post/put/patch/delete, ApiError class
  contexts/
    AuthContext.tsx     — AuthProvider (wraps QueryClientProvider), login/logout, session restore on mount.
                          Exports: AuthContext, AuthProvider, isApiError, AuthUser type.
    ThemeContext.tsx    — ThemeProvider/useTheme, persists dark/light to localStorage, sets data-theme on <html>
    ToastContext.tsx    — ToastProvider/useToast with toast.success/error/info/warning, 4s auto-dismiss
  hooks/
    useAuth.ts          — useAuth() → { user, isLoading, isAdmin, login, logout }
    useOffline.ts       — useOffline() → boolean (navigator.onLine + online/offline events)
  components/
    Layout.tsx          — Flex shell: Sidebar (220px) + TopBar (SearchBar + theme toggle) + scrollable main
    Sidebar.tsx         — Collapsible (220px↔56px), nav: Discover/Search/Library/Queue/Settings,
                          active highlighting via useLocation, theme toggle, user logout
    SearchBar.tsx       — Cmd/Ctrl+K focus, #tag encoding, clear button, navigates to /search?q=
    ConnectionCard.tsx  — Connection card with type icon, toggle, test (spinner → ✓/✗), edit, delete
    SubscriptionModal.tsx — Create/edit modal with type-aware subscription type dropdown,
                            schedule, result handling, config fields
    ServiceWorkerRegistration.tsx — OfflineIndicator (fixed banner when offline), SW registration
  pages/
    Login.tsx           — Centered card, auto-redirect if already authed or no users exist
    Onboarding.tsx      — 4-step wizard: admin account → Lidarr → MusicBrainz email → finish
    Settings.tsx        — Tabs: Connections, Subscriptions, Notifications, Users (admin), About
  index.css             — "Listening Room" dark/light CSS variables (--background, --primary copper, etc.),
                          DM Sans font (Google Fonts), scrollbar styling
  App.tsx               — All 6 routes with ProtectedRoute → Layout guard, OfflineIndicator at root
  main.tsx              — Providers: ThemeProvider → AuthProvider (contains QueryClientProvider) → ToastProvider
frontend/public/
  manifest.json         — PWA manifest (standalone, theme #bf7a56, SVG icon)
  icons/icon.svg        — Music note icon (copper on dark)
vite.config.ts          — Updated: VitePWA plugin added (SW disabled in dev, NetworkFirst for /api/)
```

### Design System Notes (Phase 6)
- **Theme:** "Listening Room" — warm dark (`#1c1b19`), rust/copper primary (`hsl(22,45%,54%)`), muted teal secondary
- **Font:** DM Sans (Google Fonts) — loaded via CSS @import
- **CSS approach:** CSS custom properties (`--background`, `--primary`, etc.) in `:root`/`[data-theme=light]`;
  Tailwind 4 for utilities, inline `style` props for themed colors
- **Auth flow:** On app load, `AuthProvider` calls `/api/auth/me` to restore session.
  Login page additionally checks `/api/users` — if empty → redirect to `/setup` (Onboarding).
### Source Files in Place (Phase 4 additions)
```
backend/src/
  jobs/
    subscription-worker.ts  — SubscriptionWorker class, FIFO queue, runSubscription engine.
                              Exported singleton: subscriptionWorker.
                              Modes: auto (MusicBrainz MBID lookup → SkyHook warm → Lidarr add),
                              queue (create ReviewItem), preview (log only).
                              Stale run cleanup in init().
    scheduler.ts            — SubscriptionScheduler class, isDue() helper.
                              Checks enabled subscriptions every 60s, enqueues due ones.
                              Schedules: manual (never), hourly, daily, weekly, monthly.
                              Exported singleton: scheduler.
    strategies/
      types.ts              — StrategyContext, ArtistToAdd interfaces
      registry.ts           — getStrategy(), registerStrategy()
      spotify.ts            — spotify_followed, spotify_playlist strategies
      lastfm.ts             — lastfm_loved, lastfm_charts strategies
      musicbrainz.ts        — musicbrainz_similar strategy
      jellyfin.ts           — jellyfin_library strategy
      tautulli.ts           — tautulli_history strategy
  routes/
    subscriptions.ts        — Full CRUD + GET /:id/runs + GET /:id/runs/:runId +
                              POST /:id/run (manual trigger → enqueues worker)
  schemas/
    subscriptions.ts        — Zod schemas for subscription create/update
```

### Server Startup Sequence
```typescript
const httpServer = createServer(app);
setupWebSocket(httpServer);
await subscriptionWorker.init(); // cleanup stale runs
scheduler.start();               // start 60s polling loop
httpServer.listen(env.PORT, ...);
```
    constants.ts     — API URLs, rate limits, timeouts (MUSICBRAINZ_API_URL, LASTFM_API_URL,
                       DEEZER_API_URL, SKYHOOK_API_URL, FETCH_TIMEOUT_MS=60000,
                       SKYHOOK_RETRY_ATTEMPTS=3, SKYHOOK_RETRY_DELAY_MS=2000)
    db.ts            — Prisma singleton, WAL mode + busy_timeout=5000
    env.ts           — SESSION_SECRET, PORT, BASE_URL, AUTH_PROXY_*, MUSICBRAINZ_CONTACT_EMAIL, DATABASE_URL
    websocket.ts     — Socket.IO setup, broadcast() helper, getIO() accessor
  generated/prisma/  — Prisma client (generated, do not edit)
  middleware/
    auth.ts          — authMiddleware (cookie + proxy header), requireAuth, requireAdmin
    error-handler.ts — Express 5 error handler
    rate-limiter.ts  — express-rate-limit (5000 req / 15 min)
    request-logger.ts — structured JSON request logging
  routes/
    auth.ts          — POST /login, POST /logout, GET /me, POST /setup
    connections.ts   — CRUD + test endpoint (per-user isolation)
    library.ts       — GET /, GET /stats, GET /health, GET /recent, GET /upcoming, POST /refresh/:id
    settings.ts      — GET/PUT /settings (global admin), GET/PUT /settings/user
    users.ts         — CRUD (admin) + PUT /me/password
  schemas/
    connections.ts   — Zod schemas for connection create/update
    users.ts         — Zod schemas for user create/update/password
  services/
    lidarr.ts        — LidarrService class (14 methods incl. getFutureAlbums)
    library-health.ts — analyzeLibraryHealth() → { stats: LibraryStats, issues: HealthIssue[] }
    skyhook-cache-warmer.ts — SkyHookCacheWarmer class, warmArtist(mbid), singleton skyhookWarmer
  server.ts          — Full Express app + all routes incl. /api/library

frontend/src/
  App.tsx            — React Router shell (placeholder routes)
  main.tsx           — React entry point
  index.css          — @import "tailwindcss" (Tailwind v4 syntax)

prisma/
  schema.prisma      — 12 models: User, Connection, Subscription, SubscriptionRun,
                       SubscriptionResult, ReviewItem, GlobalSetting, UserSetting,
                       NotificationChannel, LogEntry, Flow, FlowJob
```

### Server.ts Middleware Order
1. `helmet({ contentSecurityPolicy: false })`
2. `cors()`
3. `express.json()`
4. `cookieParser(env.SESSION_SECRET)`
5. `requestLogger`
6. `/api` → `apiRateLimiter`
7. `authMiddleware` (global — populates req.user)
8. Routes: `/api/auth`, `/api/users`, `/api/settings`, `/api/connections`, `/api/library`
9. Static serving + SPA catchall
10. `errorHandler`

Socket.IO attached to `httpServer` (not `app`), auth via signed cookie `mixarr_session`.

### Source Files in Place (Phase 6 additions)
```
frontend/src/
  utils/
    api.ts              — typed fetch wrapper: api.get/post/put/patch/delete, ApiError class
  contexts/
    AuthContext.tsx     — AuthProvider (wraps QueryClientProvider), login/logout, session restore on mount.
                          Exports: AuthContext, AuthProvider, isApiError, AuthUser type.
    ThemeContext.tsx    — ThemeProvider/useTheme, persists dark/light to localStorage, sets data-theme on <html>
    ToastContext.tsx    — ToastProvider/useToast with toast.success/error/info/warning, 4s auto-dismiss
  hooks/
    useAuth.ts          — useAuth() → { user, isLoading, isAdmin, login, logout }
    useOffline.ts       — useOffline() → boolean (navigator.onLine + online/offline events)
  components/
    Layout.tsx          — Flex shell: Sidebar (220px) + TopBar (SearchBar + theme toggle) + scrollable main
    Sidebar.tsx         — Collapsible (220px→56px), nav: Discover/Search/Library/Queue/Settings,
                          active highlighting via useLocation, theme toggle, user logout
    SearchBar.tsx       — Cmd/Ctrl+K focus, #tag encoding, clear button, navigates to /search?q=
    ConnectionCard.tsx  — Connection card with type icon, toggle, test (spinner → ✓/✗), edit, delete
    SubscriptionModal.tsx — Create/edit modal: type-aware dropdown, schedule, result handling, config
    ServiceWorkerRegistration.tsx — OfflineIndicator (fixed banner when offline), SW registration
  pages/
    Login.tsx           — Centered card, auto-redirect if already authed or no users exist
    Onboarding.tsx      — 4-step wizard: admin account → Lidarr → MusicBrainz email → finish
    Settings.tsx        — Tabs: Connections, Subscriptions, Notifications, Users (admin), About
  index.css             — "Listening Room" dark/light CSS variables, DM Sans font, scrollbar styling
  App.tsx               — All 6 routes with ProtectedRoute → Layout guard, OfflineIndicator at root
  main.tsx              — ThemeProvider → AuthProvider (contains QueryClientProvider) → ToastProvider
frontend/public/
  manifest.json         — PWA manifest (standalone, theme #bf7a56, SVG icon)
  icons/icon.svg        — Music note icon (copper on dark)
vite.config.ts          — VitePWA plugin added (SW disabled in dev, NetworkFirst for /api/)
```

### Design System Notes (Phase 6)
- **Theme:** "Listening Room" — warm dark (`#1c1b19`), rust/copper primary (`hsl(22,45%,54%)`), muted teal secondary
- **Font:** DM Sans (Google Fonts) — loaded via CSS @import
- **CSS approach:** CSS custom properties in `:root`/`[data-theme=light]`; Tailwind 4 utilities + inline `style` props for themed colors
- **Auth flow:** AuthProvider calls `/api/auth/me` on mount. Login page checks `/api/users` — if empty → redirect to `/setup`.

### Source Files in Place (Phase 5 additions)
- **LidarrService**: Constructor `({ url, apiKey })`. Private `request<T>(path)` using `fetchWithTimeout` with `AbortSignal.timeout`. Methods: `testConnection`, `getArtists`, `getArtist`, `getArtistByMbid`, `searchArtist`, `lookupByMbid`, `addArtist`, `getAlbums`, `getRecentAlbums`, `getFutureAlbums`, `getQualityProfiles`, `getMetadataProfiles`, `getRootFolders`, `refreshArtist`
- **SkyHookCacheWarmer**: Hits `https://api.lidarr.audio/api/v0.4/artist/{mbid}`. 404 → fail fast. 503/504 → exponential backoff (2s, 4s, 8s cap). UUID MBID validation. Singleton `skyhookWarmer` exported.
- **Library routes**: Look up user's Lidarr connection via `prisma.connection.findFirst({ where: { userId, type: 'lidarr', enabled: true } })`, parse `JSON.parse(conn.config)` → `{ url, apiKey }`, instantiate `new LidarrService(config)`. Returns 400 if no connection.
- **analyzeLibraryHealth**: Detects `no_albums` (monitored + 0 albums), `unmonitored`, `no_metadata` (no overview + no images). Returns `LibraryStats` + `HealthIssue[]`.

## Next Task: Phase 7 — Frontend Discovery Pages

Phase 7 has 3 tasks. All are frontend.

### Task 7.1: Discover Page
**Files:** `frontend/src/pages/Discover.tsx`, `frontend/src/components/ArtistCard.tsx`, `frontend/src/components/AlbumCard.tsx`, `frontend/src/hooks/useDiscovery.ts`
- `useDiscovery` hook: React Query data fetching from `/api/discover` endpoints
- Discover page sections: New Releases, Top Artists, Similar Artists, by Tag, Recently Played
- Artist cards: image (Deezer), name, genre tags, "Add to Lidarr" button
- Album cards: cover, title, artist, release date
Commit: `"feat: add discover page with artist and album cards"`

### Task 7.2: Search Page
**Files:** `frontend/src/pages/Search.tsx`, `frontend/src/hooks/useSearch.ts`
- `GET /api/search/artists?q=` → debounced search
- `GET /api/search/artist/:mbid` → detail view
- Results grid: ArtistCard components, clickable for detail
- Detail panel/modal: stats, similar artists, "Add to Lidarr" button
- `#tag` search prefix routes to by-tag discover endpoint
Commit: `"feat: add search page with artist detail view"`

### Task 7.3: Library & Queue Pages
**Files:** `frontend/src/pages/Library.tsx`, `frontend/src/pages/Queue.tsx`, `frontend/src/hooks/useLibrary.ts`, `frontend/src/hooks/useQueue.ts`
- Library page: artist grid from Lidarr, health stats, upcoming releases
- Queue page: list pending ReviewItems, approve/reject buttons, bulk select
Commit: `"feat: add library and queue pages"`

## How to Proceed
1. Read this file fully
2. Read the skills: `.github/skills/subagent-driven-development/SKILL.md`
3. Dispatch subagents for Tasks 7.1–7.3 sequentially (they share ArtistCard component)
4. After Phase 7, proceed to Phase 8 per the plan at `docs/plans/2026-03-04-mixarr-lite-plan.md`

### fetchWithTimeout Pattern
```typescript
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response;
}
```

### Service Constructor Pattern
```typescript
export class LidarrService {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: { url: string; apiKey: string }) {
    this.baseUrl = config.url.replace(/\/$/, ''); // remove trailing slash
    this.apiKey = config.apiKey;
  }

  private async request<T>(path: string): Promise<T> {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/v1${path}`, {
      headers: { 'X-Api-Key': this.apiKey },
    });
    return response.json() as Promise<T>;
  }
}
```

### Test Pattern (integration tests use supertest + real SQLite)
```typescript
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import supertest from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import { prisma } from '../../src/config/db.js';
import { env } from '../../src/config/env.js';
import { authMiddleware } from '../../src/middleware/auth.js';
import authRoutes from '../../src/routes/auth.js';
import { errorHandler } from '../../src/middleware/error-handler.js';

// Services tested with vi.fn() mocks on fetch
```

### Zod v4 Import
```typescript
import { z } from 'zod/v4';
```

### Express 5 Route (no try/catch needed — async errors propagate to errorHandler)
```typescript
router.get('/', requireAuth, async (req, res) => {
  const results = await prisma.something.findMany({ where: { userId: req.user!.id } });
  res.json({ results });
});
```

## Verification Commands
```bash
cd ~/Github/mixarr-lite
npx tsc --noEmit        # must be clean
npx vitest run          # 253 tests must pass (frontend has no unit tests)
```

## Reference Sources (Read Only)
```
/home/chris/Github/mixarr/apps/api/src/   — full reference implementation
/home/chris/Github/mixarr/docs/plans/2026-03-04-mixarr-lite-plan.md  — full plan
```
