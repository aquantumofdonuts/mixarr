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

**23 commits on `main`, 253 tests passing, TypeScript compiles clean.**

### Progress Summary
| Phase | Status | Tests |
|-------|--------|-------|
| Phase 0: Scaffold | ✅ Done | — |
| Phase 1: Backend Foundation (auth, middleware, routes, WebSocket) | ✅ Done | 56 |
| Phase 2: Lidarr Integration | ✅ Done | 84 |
| Phase 3: Discovery Services | ✅ Done | 152 |
| Phase 4: Subscription Engine | ✅ Done | 238 |
| Phase 5: Review Queue | ✅ Done | 253 |
| Phases 6-9 | ⏳ Pending | — |

### Git Log (HEAD = c4a5ffa)
```
c4a5ffa feat: add review queue routes with bulk approve/reject and SkyHook integration
c615401 feat: add cron-based subscription scheduler
c31df0b feat: add subscription worker with FIFO queue and run engine
d9bc829 feat: add subscription strategies for Spotify, Last.fm, MusicBrainz, Jellyfin, Tautulli
53a49a7 feat: add subscription CRUD routes with Zod validation
ce39018 feat: add search and discover routes
(earlier commits: Phases 0-3)
```

### Source Files in Place (Phase 5 additions)
```
backend/src/
  routes/
    queue.ts            — 6 routes: GET /, GET /:id, POST /bulk, POST /:id/approve,
                          POST /:id/reject, DELETE /:id.
                          Approve flow: skyhookWarmer.warmArtist → LidarrService.addArtist →
                          update status → broadcast('queue', 'approved', ...).
                          Bulk: iterate all items, skip those without artistMbid.
  schemas/
    queue.ts            — bulkQueueActionSchema: { ids: number[], action: 'approve'|'reject' }
```

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

### Key Implementation Details: Phase 2
- **LidarrService**: Constructor `({ url, apiKey })`. Private `request<T>(path)` using `fetchWithTimeout` with `AbortSignal.timeout`. Methods: `testConnection`, `getArtists`, `getArtist`, `getArtistByMbid`, `searchArtist`, `lookupByMbid`, `addArtist`, `getAlbums`, `getRecentAlbums`, `getFutureAlbums`, `getQualityProfiles`, `getMetadataProfiles`, `getRootFolders`, `refreshArtist`
- **SkyHookCacheWarmer**: Hits `https://api.lidarr.audio/api/v0.4/artist/{mbid}`. 404 → fail fast. 503/504 → exponential backoff (2s, 4s, 8s cap). UUID MBID validation. Singleton `skyhookWarmer` exported.
- **Library routes**: Look up user's Lidarr connection via `prisma.connection.findFirst({ where: { userId, type: 'lidarr', enabled: true } })`, parse `JSON.parse(conn.config)` → `{ url, apiKey }`, instantiate `new LidarrService(config)`. Returns 400 if no connection.
- **analyzeLibraryHealth**: Detects `no_albums` (monitored + 0 albums), `unmonitored`, `no_metadata` (no overview + no images). Returns `LibraryStats` + `HealthIssue[]`.

## Next Task: Phase 6 — Frontend Core

Phase 6 has 5 tasks. All are frontend (Vite + React 19 + React Router 7 + TanStack Query 5 + Tailwind CSS 4).

### Task 6.1: API Client & Auth Context
**Files:** `frontend/src/utils/api.ts`, `frontend/src/contexts/AuthContext.tsx`, `frontend/src/hooks/useAuth.ts`
- API client: fetch wrapper with base URL, credentials include, JSON parsing, error handling
- Auth context: login/logout/me state, redirect to `/login` if unauthenticated
- `useAuth` hook: expose `user`, `login()`, `logout()`, `isAdmin`
Commit: `"feat: add API client and auth context"`

### Task 6.2: Theme, Toast, & Layout
**Files:** `frontend/src/contexts/ThemeContext.tsx`, `frontend/src/contexts/ToastContext.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/Sidebar.tsx`, `frontend/src/components/SearchBar.tsx`
- Theme context: dark/light toggle (default dark, persist localStorage)
- Toast context: success/error/info, auto-dismiss
- Layout: sidebar + top bar + content area
- Sidebar: nav items (Discover, Search, Library, Queue, Flow, Settings), active indicator, mobile hamburger
- Tailwind dark theme based on Mixarr's color palette
Commit: `"feat: add layout, sidebar, theme, and toast components"`

### Task 6.3: Login & Onboarding Pages
**Files:** `frontend/src/pages/Login.tsx`, `frontend/src/pages/Onboarding.tsx`
- Login page: username/password form → `/api/auth/login`
- Onboarding (when no users exist): Step 1 create admin → Step 2 Lidarr → Step 3 MusicBrainz email → Step 4 optional services
Commit: `"feat: add login and onboarding pages"`

### Task 6.4: Settings Page
**Files:** `frontend/src/pages/Settings.tsx`, `frontend/src/components/ConnectionCard.tsx`, `frontend/src/components/SubscriptionModal.tsx`
- Tabs: Connections, Subscriptions, Notifications, Users (admin), About
- Connections: test/edit/delete, add new per type
- Subscriptions: enable/disable, edit/delete, create modal with schedule + result handling
Commit: `"feat: add settings page with connections, subscriptions, and user management"`

### Task 6.5: PWA Manifest & Service Worker
**Files:** `frontend/public/manifest.json`, icons, ServiceWorkerRegistration.tsx, useOffline.ts
- vite-plugin-pwa for SW generation
- Offline indicator component
Commit: `"feat: add PWA manifest and service worker"`

## How to Proceed
1. Read this file fully
2. Read the skills: `.github/skills/subagent-driven-development/SKILL.md`
3. Dispatch subagents for Tasks 6.1–6.5 sequentially (frontend tasks build on each other)
4. After Phase 6, proceed to Phase 7 (Frontend Discovery Pages) per the plan

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
npx vitest run          # 253 tests must pass + new tests
```

## Reference Sources (Read Only)
```
/home/chris/Github/mixarr/apps/api/src/   — full reference implementation
/home/chris/Github/mixarr/docs/plans/2026-03-04-mixarr-lite-plan.md  — full plan
```
