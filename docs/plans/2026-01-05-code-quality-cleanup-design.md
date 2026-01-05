# Code Quality & Technical Debt Cleanup

**Created:** 2026-01-05  
**Status:** Approved  
**Duration:** 5 sprints (~10 weeks)  
**Approach:** Conservative — quick wins first, monster refactors last

---

## Overview

This plan addresses issues identified in a comprehensive code roast:

- Debug logs left in production code
- Health check endpoint that lies
- Pervasive `as any` defeating TypeScript
- Missing input validation on API endpoints
- SSO secrets stored in plaintext
- Rate limiting gaps on external API calls
- Monster files (1,973 and 1,533 lines) needing split

### Sprint Allocation

| Sprint | Focus | Risk Level |
|--------|-------|------------|
| **Sprint 1** | Immediate fixes (debug logs, health checks, param validation) | Low |
| **Sprint 2** | Type safety (eliminate `as any`, define connection config types) | Low-Medium |
| **Sprint 3** | Validation & error handling (Zod schemas, better 500 errors) | Medium |
| **Sprint 4** | Security hardening (SSO encryption, rate limiting gaps) | Medium |
| **Sprint 5** | Monster file refactors (subscription-worker.ts, subscriptions.ts) | High |

---

## Sprint 1: Immediate Fixes (Low Risk)

**Duration:** 2 weeks  
**Theme:** Remove embarrassing issues that shouldn't have shipped

### Tasks

| # | Task | Effort | Files |
|---|------|--------|-------|
| 1.1 | Delete debug console.logs in subscription-worker.ts | 15 min | `subscription-worker.ts` |
| 1.2 | Fix lying health check — implement actual DB/Redis ping | 30 min | `routes/health.ts` |
| 1.3 | Add route param validation — validate parseInt results aren't NaN | 2 hrs | All route files (~16 files) |
| 1.4 | Extend session types — properly type req.session.plexPinId | 30 min | `routes/auth.ts`, new `types/session.d.ts` |
| 1.5 | Add missing tests for health check, param validation helper | 1 hr | `tests/api/health.test.ts`, `tests/utils/validation.test.ts` |

### Definition of Done
- All tests pass
- Manual smoke test of subscription run
- Deploy to staging, verify `/api/health/ready` returns 503 when DB is down

---

## Sprint 2: Type Safety (Low-Medium Risk)

**Duration:** 2 weeks  
**Theme:** Eliminate `as any` and define proper types

### Tasks

| # | Task | Effort | Files |
|---|------|--------|-------|
| 2.1 | Define connection config types (Spotify, LastFM, Deezer, TIDAL, Lidarr, Tautulli) | 2 hrs | New `types/connections.ts` |
| 2.2 | Type subscription-worker configs — replace all `config as any` (15+ instances) | 3 hrs | `jobs/subscription-worker.ts` |
| 2.3 | Type import-worker configs | 1 hr | `jobs/import-worker.ts` |
| 2.4 | Type auth route session — replace `(req.session as any)` | 30 min | `routes/auth.ts` |
| 2.5 | Type scheduler — fix `resultHandling as any` | 15 min | `jobs/scheduler.ts` |
| 2.6 | Audit remaining `as any` across API | 2 hrs | Various |
| 2.7 | Add strict tsconfig check — enable `noImplicitAny` or add to CI lint | 1 hr | `tsconfig.json`, CI config |

### Type Definitions

```typescript
// types/connections.ts
interface SpotifyConnectionConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenExpiresAt?: number;
}

interface LastFMConnectionConfig {
  apiKey: string;
  username?: string;
}

interface DeezerConnectionConfig {
  accessToken: string;
}

type ConnectionConfig = 
  | SpotifyConnectionConfig 
  | LastFMConnectionConfig 
  | DeezerConnectionConfig;
```

### Definition of Done
- `npx tsc --noEmit` passes
- All existing tests pass
- No new `as any` introduced

---

## Sprint 3: Validation & Error Handling (Medium Risk)

**Duration:** 2 weeks  
**Theme:** Trust nothing, explain failures clearly

### Tasks

| # | Task | Effort | Files |
|---|------|--------|-------|
| 3.1 | Create Zod schemas for subscriptions (create/update) | 2 hrs | New `schemas/subscription.ts`, `routes/subscriptions.ts` |
| 3.2 | Create Zod schemas for connections | 2 hrs | New `schemas/connection.ts`, `routes/connections.ts` |
| 3.3 | Create Zod schemas for admin routes (user create/update) | 1 hr | New `schemas/user.ts`, `routes/admin.ts` |
| 3.4 | Create validation middleware — reusable `validateBody(schema)` | 1 hr | New `middleware/validate.ts` |
| 3.5 | Improve error responses — add correlation IDs, distinguish client vs server errors | 2 hrs | `middleware/error-handler.ts`, all routes |
| 3.6 | Structured error logging — log actual errors server-side with context | 1.5 hrs | `middleware/error-handler.ts`, `lib/logger.ts` |
| 3.7 | Tests for validation | 2 hrs | `tests/schemas/`, `tests/middleware/validate.test.ts` |

### Validation Middleware Pattern

```typescript
// middleware/validate.ts
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export function validateBody<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.flatten().fieldErrors,
      });
    }
    req.body = result.data;
    next();
  };
}
```

### Error Response Format

```typescript
// Before: "Failed to create subscription"
// After:
{
  "error": "Failed to create subscription",
  "code": "SUBSCRIPTION_CREATE_FAILED",
  "correlationId": "abc-123",
  "details": { /* only in dev */ }
}
```

### Definition of Done
- Malformed JSON returns 400 with details
- Valid but wrong-type fields caught by Zod
- Can trace a 500 error from user report to server logs

---

## Sprint 4: Security Hardening (Medium Risk)

**Duration:** 2 weeks  
**Theme:** Lock the doors, encrypt the secrets

### Tasks

| # | Task | Effort | Files |
|---|------|--------|-------|
| 4.1 | Implement SSO config encryption | 4 hrs | `services/sso-provider.ts`, new `lib/crypto.ts` |
| 4.2 | Add encryption key to env — document `SSO_ENCRYPTION_KEY` | 30 min | `.env.example`, `README.md`, startup validation |
| 4.3 | Migration for existing data — encrypt existing plaintext SSO configs | 2 hrs | New `scripts/encrypt-sso-configs.ts` |
| 4.4 | Rate limit subscription endpoints | 1 hr | `routes/subscriptions.ts`, `middleware/rate-limiter.ts` |
| 4.5 | Rate limit search endpoints | 1 hr | `routes/search.ts` |
| 4.6 | Audit CORS config — verify not using `*` in production | 30 min | `index.ts` |
| 4.7 | Security tests | 2 hrs | `tests/security/`, `tests/services/sso-provider.test.ts` |

### Encryption Implementation

```typescript
// lib/crypto.ts
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY = Buffer.from(process.env.SSO_ENCRYPTION_KEY!, 'hex');

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

### Rate Limiters

```typescript
// Subscription run: 10 runs per minute per user
export const subscriptionRunLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
});

// Search: 30 searches per minute per user  
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.id?.toString() || req.ip,
});
```

### Migration Path
1. Deploy code with encryption support (reads both encrypted and plaintext)
2. Run migration script to encrypt existing configs
3. Remove plaintext read fallback in next release

### Definition of Done
- Database SSO configs are encrypted
- Rate limit returns 429 after threshold
- Existing SSO logins still work after migration

---

## Sprint 5: Monster File Refactors (High Risk)

**Duration:** 2 weeks  
**Theme:** Tame the beasts, split the monoliths

### Prerequisites
By this point, all earlier sprints provide a safety net:
- Type safety catches config errors at compile time
- Validation catches bad inputs at runtime
- Tests cover critical paths

### Tasks

| # | Task | Effort | Files |
|---|------|--------|-------|
| 5.1 | Design subscription handler architecture | 2 hrs | Design doc |
| 5.2 | Extract Spotify handlers (all `spotify_*` types) | 3 hrs | New `jobs/handlers/spotify.ts` |
| 5.3 | Extract LastFM handlers | 2 hrs | New `jobs/handlers/lastfm.ts` |
| 5.4 | Extract Deezer handlers | 2 hrs | New `jobs/handlers/deezer.ts` |
| 5.5 | Extract TIDAL handlers | 1.5 hrs | New `jobs/handlers/tidal.ts` |
| 5.6 | Extract other handlers (ListenBrainz, Discogs, Bandcamp, Tautulli, AI) | 3 hrs | New `jobs/handlers/*.ts` |
| 5.7 | Refactor subscription-worker.ts to thin dispatcher | 2 hrs | `jobs/subscription-worker.ts` |
| 5.8 | Split subscriptions.ts routes | 4 hrs | `routes/subscriptions/*.ts` |
| 5.9 | Integration tests for handlers | 3 hrs | `tests/jobs/handlers/*.test.ts` |
| 5.10 | E2E regression test | 2 hrs | `tests/e2e/subscription-run.test.ts` |

### Handler Architecture

```typescript
// jobs/handlers/types.ts
export interface SubscriptionHandler {
  type: string;
  execute(
    subscription: Subscription,
    connectionMap: Map<string, Connection>,
    config: Record<string, unknown>
  ): Promise<HandlerResult>;
}

export interface HandlerResult {
  artists?: ArtistToAdd[];
  albums?: AlbumToAdd[];
}

// jobs/handlers/spotify.ts
export const spotifyPlaylistHandler: SubscriptionHandler = {
  type: 'spotify_playlist',
  async execute(subscription, connectionMap, config) {
    const spotify = getSpotifyService(connectionMap);
    const tracks = await spotify.getAllPlaylistTracks(config.playlistId);
    return { artists };
  },
};

// jobs/handlers/index.ts
export const handlers: Record<string, SubscriptionHandler> = {
  'spotify_playlist': spotifyPlaylistHandler,
  'spotify_followed': spotifyFollowedHandler,
  'lastfm_top_artists': lastfmTopArtistsHandler,
};
```

### Refactored subscription-worker.ts (~200 lines)

```typescript
import { handlers } from './handlers/index.js';

async function processSubscription(job: Job<SubscriptionJobData>) {
  const { subscriptionId } = job.data;
  const subscription = await getSubscription(subscriptionId);
  const connectionMap = await buildConnectionMap(subscription.userId);
  
  const handler = handlers[subscription.type];
  if (!handler) throw new Error(`Unknown subscription type: ${subscription.type}`);
  
  const result = await handler.execute(subscription, connectionMap, subscription.config);
  await processResults(subscription, result);
}
```

### Routes Split Structure

```
routes/
  subscriptions/
    index.ts          # Router aggregator
    crud.ts           # GET/POST/PUT/DELETE subscription
    results.ts        # GET results, approve/reject
    runs.ts           # POST run, GET run details
    bulk.ts           # Bulk operations
```

### Definition of Done
- All existing tests pass
- E2E test covers at least one subscription of each source type
- No single file over 500 lines
- Manual test: create, run, view results for Spotify playlist subscription

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Regression in subscription runs | E2E test before Sprint 5; smoke test after each deploy |
| SSO encryption breaks existing logins | Dual-read migration (encrypted + plaintext fallback) |
| Monster refactor introduces bugs | Do last, after type safety and validation in place |
| Scope creep | Each sprint has clear DoD; defer new issues to backlog |

## Rollback Plan

- Each sprint is a separate PR/branch
- Feature flags not needed (all changes are transparent improvements)
- If Sprint 5 goes badly, revert to pre-refactor; earlier sprints remain stable

## Success Metrics

- [ ] Zero `as any` in connection configs
- [ ] 100% of POST/PUT endpoints validated with Zod
- [ ] Health check correctly reports unhealthy when DB/Redis down
- [ ] No file over 500 lines in `jobs/` or `routes/`
- [ ] SSO configs encrypted at rest
