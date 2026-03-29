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

## Current State: Phase 2 COMPLETE ✅

**14 commits on `main`, 84 tests passing, TypeScript compiles clean.**

### Progress Summary
| Phase | Status | Tests |
|-------|--------|-------|
| Phase 0: Scaffold | ✅ Done | — |
| Phase 1: Backend Foundation (auth, middleware, routes, WebSocket) | ✅ Done | 56 |
| Phase 2: Lidarr Integration | ✅ Done | 84 |
| Phase 3: Discovery Services | ⏳ Next | — |
| Phases 4-9 | ⏳ Pending | — |

### Git Log (HEAD = b4950a0)
```
b4950a0 feat: add library health service and routes
e117058 feat: add SkyHook cache warmer for reliable artist adds
8cce017 feat: add Lidarr service with core artist and library methods
cccdc11 feat: add connection management routes
996a6c3 feat: add Socket.IO WebSocket server with auth
022ff74 feat: add global and user settings routes
13b0171 feat: add user management routes with Zod validation
e5d2972 feat: add error handling, rate limiting, and request logging middleware
77e6269 feat: add local auth with signed cookies and proxy header support
39e5663 feat: add environment configuration and constants
bf351c9 feat: add Prisma schema with SQLite and all 12 models
da91981 feat: add Express server and Vite React SPA entry points
9f2bdc8 chore: add TypeScript, Vite, and Tailwind configuration
62c3df0 chore: initialize project
```

### Source Files in Place
```
backend/src/
  config/
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

## Next Task: Phase 3 — Discovery Services

### Task 3.1: Spotify Service
**File:** `backend/src/services/spotify.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/spotify.ts` (736 lines)
- OAuth2 client credentials flow (no user OAuth needed — just `client_id` + `client_secret`)
- Token caching with auto-refresh
- Key methods: `searchArtists`, `getArtist`, `getArtistAlbums`, `getArtistTopTracks`, `getRelatedArtists`, `getNewReleases`, `getFeaturedPlaylists`
- `SpotifyService` class, constructor `({ clientId, clientSecret })`
- Config stored in Connection table as `{ clientId, clientSecret }`

### Task 3.2: Last.fm Service
**File:** `backend/src/services/lastfm.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/lastfm.ts` (638 lines)
- API key only (no OAuth)
- Key methods: `searchArtist`, `getArtistInfo`, `getSimilarArtists`, `getTopArtists`, `getTopArtistsByTag`, `getTopTags`, `getArtistTopAlbums`, `getUserTopArtists`
- `LastfmService` class, constructor `({ apiKey })`
- Base URL: `https://ws.audioscrobbler.com/2.0/`

### Task 3.3: MusicBrainz Service
**File:** `backend/src/services/musicbrainz.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/musicbrainz.ts` (345 lines)
- No auth required — but must set `User-Agent` header with `MUSICBRAINZ_CONTACT_EMAIL` from env
- Rate limit: 1 request/second (`MUSICBRAINZ_RATE_LIMIT_MS`)
- Key methods: `searchArtist`, `getArtist`, `getArtistReleaseGroups`, `getReleaseGroup`, `browseReleaseGroups`
- Singleton export (shared rate limiter state)

### Task 3.4: Deezer Service
**File:** `backend/src/services/deezer.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/deezer.ts` (303 lines)
- No auth required
- Used for: album artwork + 30s preview URLs only
- Key methods: `searchArtist`, `getArtist`, `getArtistAlbums`, `getAlbum`
- Singleton export

### Task 3.5: Jellyfin Service
**File:** `backend/src/services/jellyfin.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/jellyfin.ts` (297 lines)
- API key auth (`X-Emby-Token` header)
- Key methods: `testConnection`, `getLibraries`, `getArtists`, `getAlbums`, `getRecentlyPlayed`, `getArtistById`
- `JellyfinService` class, constructor `({ url, apiKey })`

### Task 3.6: Tautulli Service
**File:** `backend/src/services/tautulli.ts`
**Port from:** `/home/chris/Github/mixarr/apps/api/src/services/tautulli.ts` (278 lines)
- API key auth (`apikey` query param)
- Key methods: `testConnection`, `getRecentlyPlayed`, `getMostPlayedArtists`, `getPlayHistory`
- `TautulliService` class, constructor `({ url, apiKey })`

### Task 3.7: Search + Discover Routes
**Files:** `backend/src/routes/search.ts`, `backend/src/routes/discover.ts`
**Mount at:** `/api/search`, `/api/discover`

Search routes:
- `GET /api/search/artists?q=` — searches MusicBrainz + Last.fm + Spotify (parallel), merges results
- `GET /api/search/artist/:mbid` — unified artist detail (MusicBrainz + Lidarr in-library check + Deezer previews)

Discover routes:
- `GET /api/discover/new-releases` — Lidarr upcoming + Spotify new releases
- `GET /api/discover/top-artists` — Last.fm top artists (global)
- `GET /api/discover/similar/:mbid` — Last.fm similar artists
- `GET /api/discover/by-tag/:tag` — Last.fm artists by genre tag
- `GET /api/discover/recently-played` — Jellyfin and/or Tautulli recently played
- `POST /api/library/add` — add artist to Lidarr (also warms SkyHook cache)

Routes instantiate services from user's stored connections. Services with no per-user config (MusicBrainz, Deezer) use global singletons. Services with API keys (Spotify, Last.fm, Jellyfin, Tautulli) look up from user's Connection records.

## Patterns to Follow

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
npx vitest run          # 84 tests must pass + new tests
```

## Reference Sources (Read Only)
```
Phase 3 reference — all in /home/chris/Github/mixarr/apps/api/src/services/:
  spotify.ts        (736 lines)
  lastfm.ts         (638 lines)
  musicbrainz.ts    (345 lines)
  deezer.ts         (303 lines)
  jellyfin.ts       (297 lines)
  tautulli.ts       (278 lines)
```

## How to Proceed
1. Read this file fully
2. Read the skills: `.github/skills/subagent-driven-development/SKILL.md`
3. Dispatch a subagent for Task 3.1 (Spotify Service), verify it passes, then 3.2 through 3.7 in order
4. After Phase 3, proceed to Phase 4 (Subscription Engine) per the plan at `docs/plans/2026-03-04-mixarr-lite-plan.md`
