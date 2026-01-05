# Sprint 2: Type Safety Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Eliminate all `as any` casts from the API codebase by defining proper connection config types

**Architecture:** Create centralized `types/connections.ts` with typed interfaces for all connection configs (Spotify, LastFM, Deezer, TIDAL, Lidarr, Tautulli, Jellyfin, ListenBrainz, Discogs). Export type guard functions to safely narrow `Json` types from Prisma. Update all workers and routes to use these types instead of `as any`.

**Tech Stack:** TypeScript, Prisma (Json field typing), Vitest

---

## Task Overview

| # | Task | Effort | Focus |
|---|------|--------|-------|
| 1 | Create connection config types | 45 min | New `types/connections.ts` |
| 2 | Create tests for type guards | 30 min | TDD for type guards |
| 3 | Type subscription-worker (Spotify configs) | 45 min | Replace 15 `as any` |
| 4 | Type subscription-worker (LastFM configs) | 30 min | Replace 6 `as any` |
| 5 | Type subscription-worker (Deezer configs) | 30 min | Replace 5 `as any` |
| 6 | Type subscription-worker (TIDAL configs) | 30 min | Replace 7 `as any` |
| 7 | Type subscription-worker (ListenBrainz configs) | 30 min | Replace 8 `as any` |
| 8 | Type subscription-worker (Tautulli/Jellyfin) | 20 min | Replace 4 `as any` |
| 9 | Type import-worker configs | 20 min | Replace 1 `as any` |
| 10 | Type connections.ts route | 30 min | Replace 6 `as any` |
| 11 | Type remaining files | 30 min | scheduler, auth, imports, deezer-oauth, index.ts |
| 12 | Final verification | 15 min | TypeScript check, all tests pass |

---

## Task 1: Create Connection Config Types

**Files:**
- Create: `apps/api/src/types/connections.ts`

**Step 1: Create the types file with all connection config interfaces**

```typescript
// apps/api/src/types/connections.ts
/**
 * Connection Config Types
 * 
 * Type definitions for all connection config JSON fields stored in the database.
 * These types replace `as any` casts throughout the codebase.
 */

import type { JsonValue } from '@prisma/client/runtime/library';

// =============================================================================
// SPOTIFY
// =============================================================================

export interface SpotifyConnectionConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string | number;
  tokenExpiresAt?: number;
}

export function isSpotifyConfig(config: JsonValue): config is SpotifyConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.clientId === 'string' && typeof c.clientSecret === 'string';
}

// =============================================================================
// LAST.FM
// =============================================================================

export interface LastFMConnectionConfig {
  apiKey: string;
}

export function isLastFMConfig(config: JsonValue): config is LastFMConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.apiKey === 'string';
}

// =============================================================================
// DEEZER
// =============================================================================

export interface DeezerConnectionConfig {
  appId: string;
  appSecret: string;
  accessToken?: string;
  expiresAt?: number;
}

export function isDeezerConfig(config: JsonValue): config is DeezerConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.appId === 'string' && typeof c.appSecret === 'string';
}

// =============================================================================
// TIDAL
// =============================================================================

export interface TidalConnectionConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
}

export function isTidalConfig(config: JsonValue): config is TidalConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.clientId === 'string' && typeof c.clientSecret === 'string';
}

// =============================================================================
// LISTENBRAINZ
// =============================================================================

export interface ListenBrainzConnectionConfig {
  username: string;
  token?: string;
}

export function isListenBrainzConfig(config: JsonValue): config is ListenBrainzConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.username === 'string';
}

// =============================================================================
// LIDARR
// =============================================================================

export interface LidarrConnectionConfig {
  url: string;
  apiKey: string;
}

export function isLidarrConfig(config: JsonValue): config is LidarrConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.url === 'string' && typeof c.apiKey === 'string';
}

// =============================================================================
// TAUTULLI
// =============================================================================

export interface TautulliConnectionConfig {
  tautulliUrl: string;
  tautulliApiKey: string;
  plexLibraryId?: number;
  plexUserId?: number;
}

export function isTautulliConfig(config: JsonValue): config is TautulliConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.tautulliUrl === 'string' && typeof c.tautulliApiKey === 'string';
}

// =============================================================================
// JELLYFIN
// =============================================================================

export interface JellyfinConnectionConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId?: string;
  jellyfinLibraryId?: string;
}

export function isJellyfinConfig(config: JsonValue): config is JellyfinConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.jellyfinUrl === 'string' && typeof c.jellyfinApiKey === 'string';
}

// =============================================================================
// DISCOGS
// =============================================================================

export interface DiscogsConnectionConfig {
  consumerKey: string;
  consumerSecret: string;
  accessToken?: string;
  accessSecret?: string;
}

export function isDiscogsConfig(config: JsonValue): config is DiscogsConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;
  return typeof c.consumerKey === 'string' && typeof c.consumerSecret === 'string';
}

// =============================================================================
// UNION TYPE
// =============================================================================

export type ConnectionConfig =
  | SpotifyConnectionConfig
  | LastFMConnectionConfig
  | DeezerConnectionConfig
  | TidalConnectionConfig
  | ListenBrainzConnectionConfig
  | LidarrConnectionConfig
  | TautulliConnectionConfig
  | JellyfinConnectionConfig
  | DiscogsConnectionConfig;

// =============================================================================
// HELPER: Get typed config with validation
// =============================================================================

/**
 * Safely extract a typed config from a Prisma Json field.
 * Throws if the config doesn't match the expected type.
 */
export function getTypedConfig<T>(
  config: JsonValue,
  validator: (c: JsonValue) => c is T,
  connectionType: string
): T {
  if (!validator(config)) {
    throw new Error(`Invalid ${connectionType} connection config`);
  }
  return config;
}
```

**Step 2: Verify file compiles**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors related to connections.ts

**Step 3: Commit**

```bash
git add apps/api/src/types/connections.ts
git commit -m "feat: add connection config types to eliminate 'as any'"
```

---

## Task 2: Create Tests for Type Guards

**Files:**
- Create: `apps/api/tests/types/connections.test.ts`

**Step 1: Write tests for all type guards**

```typescript
// apps/api/tests/types/connections.test.ts
import { describe, it, expect } from 'vitest';
import {
  isSpotifyConfig,
  isLastFMConfig,
  isDeezerConfig,
  isTidalConfig,
  isListenBrainzConfig,
  isLidarrConfig,
  isTautulliConfig,
  isJellyfinConfig,
  isDiscogsConfig,
  getTypedConfig,
  type SpotifyConnectionConfig,
} from '../../src/types/connections.js';

describe('Connection Config Type Guards', () => {
  describe('isSpotifyConfig', () => {
    it('returns true for valid Spotify config', () => {
      const config = { clientId: 'abc', clientSecret: 'xyz' };
      expect(isSpotifyConfig(config)).toBe(true);
    });

    it('returns true with optional tokens', () => {
      const config = {
        clientId: 'abc',
        clientSecret: 'xyz',
        accessToken: 'token',
        refreshToken: 'refresh',
        expiresAt: 12345,
      };
      expect(isSpotifyConfig(config)).toBe(true);
    });

    it('returns false for missing clientId', () => {
      const config = { clientSecret: 'xyz' };
      expect(isSpotifyConfig(config)).toBe(false);
    });

    it('returns false for null', () => {
      expect(isSpotifyConfig(null)).toBe(false);
    });

    it('returns false for array', () => {
      expect(isSpotifyConfig([])).toBe(false);
    });
  });

  describe('isLastFMConfig', () => {
    it('returns true for valid LastFM config', () => {
      expect(isLastFMConfig({ apiKey: 'abc123' })).toBe(true);
    });

    it('returns false for missing apiKey', () => {
      expect(isLastFMConfig({ username: 'user' })).toBe(false);
    });
  });

  describe('isDeezerConfig', () => {
    it('returns true for valid Deezer config', () => {
      expect(isDeezerConfig({ appId: '123', appSecret: 'xyz' })).toBe(true);
    });

    it('returns false for missing appId', () => {
      expect(isDeezerConfig({ appSecret: 'xyz' })).toBe(false);
    });
  });

  describe('isTidalConfig', () => {
    it('returns true for valid TIDAL config', () => {
      expect(isTidalConfig({ clientId: 'abc', clientSecret: 'xyz' })).toBe(true);
    });

    it('returns false for missing clientSecret', () => {
      expect(isTidalConfig({ clientId: 'abc' })).toBe(false);
    });
  });

  describe('isListenBrainzConfig', () => {
    it('returns true for valid ListenBrainz config', () => {
      expect(isListenBrainzConfig({ username: 'user' })).toBe(true);
    });

    it('returns true with optional token', () => {
      expect(isListenBrainzConfig({ username: 'user', token: 'abc' })).toBe(true);
    });

    it('returns false for missing username', () => {
      expect(isListenBrainzConfig({ token: 'abc' })).toBe(false);
    });
  });

  describe('isLidarrConfig', () => {
    it('returns true for valid Lidarr config', () => {
      expect(isLidarrConfig({ url: 'http://localhost', apiKey: 'abc' })).toBe(true);
    });

    it('returns false for missing apiKey', () => {
      expect(isLidarrConfig({ url: 'http://localhost' })).toBe(false);
    });
  });

  describe('isTautulliConfig', () => {
    it('returns true for valid Tautulli config', () => {
      expect(isTautulliConfig({ tautulliUrl: 'http://localhost', tautulliApiKey: 'abc' })).toBe(true);
    });

    it('returns true with optional plex IDs', () => {
      expect(isTautulliConfig({
        tautulliUrl: 'http://localhost',
        tautulliApiKey: 'abc',
        plexLibraryId: 1,
        plexUserId: 2,
      })).toBe(true);
    });

    it('returns false for missing tautulliApiKey', () => {
      expect(isTautulliConfig({ tautulliUrl: 'http://localhost' })).toBe(false);
    });
  });

  describe('isJellyfinConfig', () => {
    it('returns true for valid Jellyfin config', () => {
      expect(isJellyfinConfig({ jellyfinUrl: 'http://localhost', jellyfinApiKey: 'abc' })).toBe(true);
    });

    it('returns false for missing jellyfinUrl', () => {
      expect(isJellyfinConfig({ jellyfinApiKey: 'abc' })).toBe(false);
    });
  });

  describe('isDiscogsConfig', () => {
    it('returns true for valid Discogs config', () => {
      expect(isDiscogsConfig({ consumerKey: 'abc', consumerSecret: 'xyz' })).toBe(true);
    });

    it('returns false for missing consumerSecret', () => {
      expect(isDiscogsConfig({ consumerKey: 'abc' })).toBe(false);
    });
  });

  describe('getTypedConfig', () => {
    it('returns typed config when valid', () => {
      const config = { clientId: 'abc', clientSecret: 'xyz' };
      const result = getTypedConfig(config, isSpotifyConfig, 'Spotify');
      expect(result.clientId).toBe('abc');
    });

    it('throws for invalid config', () => {
      const config = { invalid: 'config' };
      expect(() => getTypedConfig(config, isSpotifyConfig, 'Spotify'))
        .toThrow('Invalid Spotify connection config');
    });
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `cd /home/chris/Github/mixarr/apps/api && npx vitest run tests/types/connections.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add apps/api/tests/types/connections.test.ts
git commit -m "test: add tests for connection config type guards"
```

---

## Task 3: Type subscription-worker (Spotify configs)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace all `spotifyConn.config as any` with properly typed access (15 instances at lines 172, 194, 207, 225, 269, 303, 324, 345, 366, 387, 400, 422, 458)

**Step 1: Add import at top of file**

After line 25 (after existing imports), add:
```typescript
import { isSpotifyConfig, type SpotifyConnectionConfig } from '../types/connections.js';
```

**Step 2: Replace each `spotifyConfig = spotifyConn.config as any` with typed version**

Pattern to apply for each occurrence:
```typescript
// BEFORE:
const spotifyConfig = spotifyConn.config as any;

// AFTER:
if (!isSpotifyConfig(spotifyConn.config)) {
  throw new Error('Invalid Spotify connection config');
}
const spotifyConfig = spotifyConn.config;
```

Apply this pattern to all 15 Spotify config usages.

**Step 3: Run TypeScript check**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit 2>&1 | grep -i spotify || echo "No Spotify errors"`
Expected: No errors

**Step 4: Run existing tests**

Run: `cd /home/chris/Github/mixarr/apps/api && npx vitest run tests/jobs/subscription-worker.test.ts 2>&1 | tail -10`
Expected: Tests pass

**Step 5: Commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type Spotify configs in subscription-worker (15 'as any' removed)"
```

---

## Task 4: Type subscription-worker (LastFM configs)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace all `lastfmConn.config as any` with properly typed access (6 instances at lines 136, 148, 160, 428, 545, 564, 631, 714)

**Step 1: Add import (extend existing)**

Update the import line to include LastFM:
```typescript
import { 
  isSpotifyConfig, 
  isLastFMConfig,
  type SpotifyConnectionConfig,
  type LastFMConnectionConfig,
} from '../types/connections.js';
```

**Step 2: Replace each LastFM config usage**

Pattern:
```typescript
// BEFORE:
const lastfm = new LastfmService({ apiKey: (lastfmConn.config as any).apiKey });

// AFTER:
if (!isLastFMConfig(lastfmConn.config)) {
  throw new Error('Invalid Last.fm connection config');
}
const lastfm = new LastfmService({ apiKey: lastfmConn.config.apiKey });
```

For `lastfmConfig` variables:
```typescript
// BEFORE:
const lastfmConfig = lastfmConn.config as any;

// AFTER:
if (!isLastFMConfig(lastfmConn.config)) {
  throw new Error('Invalid Last.fm connection config');
}
const lastfmConfig = lastfmConn.config;
```

**Step 3: Run tests**

Run: `cd /home/chris/Github/mixarr/apps/api && npm test 2>&1 | tail -5`
Expected: Tests pass

**Step 4: Commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type LastFM configs in subscription-worker"
```

---

## Task 5: Type subscription-worker (Deezer configs)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace all `deezerConn.config as any` (5 instances at lines 795, 818, 841, 864, 888)

**Step 1: Add import**

Add `isDeezerConfig` to the import.

**Step 2: Apply pattern to all Deezer usages**

```typescript
// BEFORE:
const deezerConfig = deezerConn.config as any;

// AFTER:
if (!isDeezerConfig(deezerConn.config)) {
  throw new Error('Invalid Deezer connection config');
}
const deezerConfig = deezerConn.config;
```

**Step 3: Run tests and commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type Deezer configs in subscription-worker"
```

---

## Task 6: Type subscription-worker (TIDAL configs)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace all `tidalConn.config as any` (7 instances at lines 955, 981, 999, 1026, 1055, 1082, 1109)

**Step 1: Add import**

Add `isTidalConfig` to the import.

**Step 2: Apply pattern**

```typescript
// BEFORE:
const tidalConfig = tidalConn.config as any;

// AFTER:
if (!isTidalConfig(tidalConn.config)) {
  throw new Error('Invalid TIDAL connection config');
}
const tidalConfig = tidalConn.config;
```

**Step 3: Run tests and commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type TIDAL configs in subscription-worker"
```

---

## Task 7: Type subscription-worker (ListenBrainz configs)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace all `listenbrainzConn.config as any` / `lbConfig` (8 instances at lines 1145, 1166, 1224, 1283, 1306, 1345)

**Step 1: Add import**

Add `isListenBrainzConfig` to the import.

**Step 2: Apply pattern**

```typescript
// BEFORE:
const lbConfig = listenbrainzConn.config as any;

// AFTER:
if (!isListenBrainzConfig(listenbrainzConn.config)) {
  throw new Error('Invalid ListenBrainz connection config');
}
const lbConfig = listenbrainzConn.config;
```

Special case for line 1283 where `listenbrainzConn` is optional:
```typescript
// BEFORE:
const lbConfig = listenbrainzConn?.config as any;
const listenbrainz = new ListenBrainzService(lbConfig?.username || 'anonymous');

// AFTER:
const lbConfig = listenbrainzConn?.config;
const lbUsername = (lbConfig && isListenBrainzConfig(lbConfig)) ? lbConfig.username : 'anonymous';
const listenbrainz = new ListenBrainzService(lbUsername);
```

**Step 3: Run tests and commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type ListenBrainz configs in subscription-worker"
```

---

## Task 8: Type subscription-worker (Tautulli/Jellyfin)

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Goal:** Replace `tautulliConn.config as any` (line 630) and `jellyfinConn.config as any` (line 713)

**Step 1: Add imports**

Add `isTautulliConfig, isJellyfinConfig` to the import.

**Step 2: Apply pattern**

```typescript
// Tautulli (line 630):
if (!isTautulliConfig(tautulliConn.config)) {
  throw new Error('Invalid Tautulli connection config');
}
const tautulliConfig = tautulliConn.config;

// Jellyfin (line 713):
if (!isJellyfinConfig(jellyfinConn.config)) {
  throw new Error('Invalid Jellyfin connection config');
}
const jellyfinConfig = jellyfinConn.config;
```

**Step 3: Run tests and commit**

```bash
git add apps/api/src/jobs/subscription-worker.ts
git commit -m "fix: type Tautulli/Jellyfin configs in subscription-worker"
```

---

## Task 9: Type import-worker configs

**Files:**
- Modify: `apps/api/src/jobs/import-worker.ts`

**Goal:** Replace `spotifyConn.config as any` at line 62

**Step 1: Add import**

```typescript
import { isSpotifyConfig } from '../types/connections.js';
```

**Step 2: Apply pattern**

```typescript
// BEFORE (line 62):
const spotifyConfig = spotifyConn.config as any;

// AFTER:
if (!isSpotifyConfig(spotifyConn.config)) {
  throw new Error('Invalid Spotify connection config');
}
const spotifyConfig = spotifyConn.config;
```

**Step 3: Run tests and commit**

```bash
git add apps/api/src/jobs/import-worker.ts
git commit -m "fix: type Spotify config in import-worker"
```

---

## Task 10: Type connections.ts route

**Files:**
- Modify: `apps/api/src/routes/connections.ts`

**Goal:** Replace 6 `as any` casts (lines 109, 1056, 1135, 1273, 1396, 1545)

These are all Prisma update operations with `config: updatedConfig as any` or `config: restConfig as any`.

**Step 1: Add import**

```typescript
import type { Prisma } from '@prisma/client';
```

**Step 2: Type the config objects**

For each instance, the pattern is:
```typescript
// BEFORE:
data: { config: restConfig as any }

// AFTER:
data: { config: restConfig as Prisma.InputJsonValue }
```

This is the correct Prisma type for Json field inputs. `Prisma.InputJsonValue` accepts the same shapes as our typed configs.

**Step 3: Run tests and commit**

```bash
git add apps/api/src/routes/connections.ts
git commit -m "fix: use Prisma.InputJsonValue for connection config updates"
```

---

## Task 11: Type remaining files

**Files:**
- Modify: `apps/api/src/jobs/scheduler.ts` (line 147: `resultHandling as any`)
- Modify: `apps/api/src/routes/auth.ts` (line 213: SAML strategy `as any`)
- Modify: `apps/api/src/routes/imports.ts` (lines 185-186, 863: status/itemType/config `as any`)
- Modify: `apps/api/src/services/deezer-oauth.ts` (lines 179-180: `data as any`)
- Modify: `apps/api/src/index.ts` (lines 93-108: socket.io session handling `as any`)

### 11a: scheduler.ts (resultHandling)

The `resultHandling as any` is casting a Prisma enum. Fix by importing the type:

```typescript
// BEFORE:
await scheduleImportJob(importSourceId, userId, resultHandling as any);

// AFTER (ensure ResultHandling is imported from Prisma):
import { ResultHandling } from '@prisma/client';
await scheduleImportJob(importSourceId, userId, resultHandling);
```

The function signature should already accept `ResultHandling`.

### 11b: auth.ts (SAML strategy)

Line 213 has a legitimate `as any` for passport-saml compatibility. Add a comment explaining why:
```typescript
// Type assertion required: passport-saml's Strategy type doesn't perfectly match passport's expected type
}, prisma) as any);
```

This is an acceptable `as any` — it's at a library boundary. Mark with `// eslint-disable-line @typescript-eslint/no-explicit-any` or leave documented.

### 11c: imports.ts (status/itemType/config)

Lines 185-186: These are Prisma enum casts from query params:
```typescript
// BEFORE:
status: status as any,
...(itemType ? { itemType: itemType as any } : {}),

// AFTER (validate and cast properly):
import { ImportItemStatus, ImportItemType } from '@prisma/client';

// Validate status is a valid enum value
const validStatuses = Object.values(ImportItemStatus);
if (status && !validStatuses.includes(status as ImportItemStatus)) {
  return res.status(400).json({ error: 'Invalid status' });
}
// Then use: status: status as ImportItemStatus

// Same for itemType
```

Line 863: `config: { ...config, ...tokens } as any` — use `Prisma.InputJsonValue`.

### 11d: deezer-oauth.ts

Lines 179-180: Runtime check on API response, acceptable pattern:
```typescript
// BEFORE:
if ((data as any).error) {
  throw new Error((data as any).error.message || 'Deezer API error');
}

// AFTER (add proper type):
interface DeezerErrorResponse {
  error?: { message?: string; type?: string; code?: number };
}
const responseData = data as DeezerErrorResponse;
if (responseData.error) {
  throw new Error(responseData.error.message || 'Deezer API error');
}
```

### 11e: index.ts (socket.io)

Lines 93-108: Socket.io with express-session requires type assertions. Create proper types:

```typescript
// Add to types/socket.d.ts or inline:
import type { Socket } from 'socket.io';
import type { Request } from 'express';

interface SocketWithSession extends Socket {
  request: Request;
  userId?: number;
}

// Then use SocketWithSession instead of Socket with (socket as any)
```

**Step: Commit all remaining fixes**

```bash
git add apps/api/src/jobs/scheduler.ts apps/api/src/routes/auth.ts apps/api/src/routes/imports.ts apps/api/src/services/deezer-oauth.ts apps/api/src/index.ts
git commit -m "fix: type remaining 'as any' usages across API"
```

---

## Task 12: Final Verification

**Step 1: TypeScript check**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit`
Expected: No errors

**Step 2: Full test suite**

Run: `cd /home/chris/Github/mixarr/apps/api && npm test`
Expected: All tests pass (or only pre-existing failures)

**Step 3: Grep for remaining `as any`**

Run: `cd /home/chris/Github/mixarr/apps/api && grep -r "as any" src/ --include="*.ts" | wc -l`
Expected: 0-3 (only documented/justified cases)

**Step 4: Update ISSUES.md**

Add entry noting Sprint 2 is complete:
```markdown
### 2026-01-05: Sprint 2 - Type Safety Complete
- Created centralized connection config types (`types/connections.ts`)
- Eliminated 50+ `as any` casts from subscription-worker, import-worker, routes
- All connection configs now properly typed with type guards
```

---

## Definition of Done

- [ ] `types/connections.ts` exists with all connection config types
- [ ] Type guard tests pass
- [ ] `npx tsc --noEmit` passes with no errors
- [ ] All existing tests pass
- [ ] `grep -r "as any" src/` shows only documented justified cases
- [ ] Each task committed separately with descriptive message
