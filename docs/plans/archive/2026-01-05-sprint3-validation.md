# Sprint 3: Validation & Error Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Add Zod validation to all API endpoints and improve error handling with correlation IDs and structured logging

**Architecture:** Create reusable validation middleware with Zod schemas. Add correlation IDs to all requests for tracing. Improve error responses to distinguish client vs server errors.

**Tech Stack:** Zod 3.23.8 (already installed), Express middleware, Winston-style structured logging

---

## Task Overview

| # | Task | Effort | Focus |
|---|------|--------|-------|
| 1 | Create validation middleware | 30 min | `middleware/validate.ts` |
| 2 | Create subscription schemas | 45 min | `schemas/subscription.ts` |
| 3 | Create connection schemas | 45 min | `schemas/connection.ts` |
| 4 | Create user/admin schemas | 30 min | `schemas/user.ts` |
| 5 | Apply validation to subscription routes | 30 min | `routes/subscriptions.ts` |
| 6 | Apply validation to connection routes | 30 min | `routes/connections.ts` |
| 7 | Apply validation to admin routes | 20 min | `routes/admin.ts` |
| 8 | Add correlation IDs | 30 min | `middleware/correlation.ts`, `index.ts` |
| 9 | Improve error handler | 30 min | `middleware/error-handler.ts` |
| 10 | Add validation tests | 45 min | `tests/middleware/validate.test.ts`, `tests/schemas/` |
| 11 | Final verification | 15 min | TypeScript check, all tests pass |

---

## Task 1: Create Validation Middleware

**Files:**
- Create: `apps/api/src/middleware/validate.ts`

**Step 1: Create the validation middleware**

```typescript
// apps/api/src/middleware/validate.ts
/**
 * Zod Validation Middleware
 * 
 * Validates request body, query params, or route params against Zod schemas.
 */

import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

export interface ValidationError {
  error: string;
  code: string;
  details: Record<string, string[]>;
}

/**
 * Validates request body against a Zod schema.
 * Returns 400 with detailed errors if validation fails.
 */
export function validateBody<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const response: ValidationError = {
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: result.error.flatten().fieldErrors as Record<string, string[]>,
      };
      res.status(400).json(response);
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates query parameters against a Zod schema.
 * Returns 400 with detailed errors if validation fails.
 */
export function validateQuery<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const response: ValidationError = {
        error: 'Invalid query parameters',
        code: 'INVALID_QUERY_PARAMS',
        details: result.error.flatten().fieldErrors as Record<string, string[]>,
      };
      res.status(400).json(response);
      return;
    }
    req.query = result.data;
    next();
  };
}

/**
 * Validates route parameters against a Zod schema.
 * Returns 400 with detailed errors if validation fails.
 */
export function validateParams<T extends z.ZodSchema>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      const response: ValidationError = {
        error: 'Invalid route parameters',
        code: 'INVALID_ROUTE_PARAMS',
        details: result.error.flatten().fieldErrors as Record<string, string[]>,
      };
      res.status(400).json(response);
      return;
    }
    next();
  };
}
```

**Step 2: Verify it compiles**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add apps/api/src/middleware/validate.ts
git commit -m "feat: add Zod validation middleware"
```

---

## Task 2: Create Subscription Schemas

**Files:**
- Create: `apps/api/src/schemas/subscription.ts`

**Step 1: Create subscription validation schemas**

```typescript
// apps/api/src/schemas/subscription.ts
/**
 * Subscription Zod Schemas
 * 
 * Validation schemas for subscription create/update operations.
 */

import { z } from 'zod';

// Valid subscription types based on Prisma enum
export const subscriptionTypes = [
  'lastfm_chart', 'lastfm_tag', 'lastfm_geo', 'lastfm_library', 'lastfm_similar',
  'spotify_playlist', 'spotify_followed', 'spotify_saved_albums', 'spotify_liked_songs',
  'spotify_new_releases', 'spotify_discover_weekly', 'spotify_release_radar',
  'spotify_daily_mix', 'spotify_on_repeat', 'spotify_featured', 'spotify_category',
  'spotify_library', 'spotify_public_playlist',
  'deezer_favorites', 'deezer_history', 'deezer_flow', 'deezer_playlist', 'deezer_playlists',
  'deezer_chart', 'deezer_genre',
  'tidal_favorites', 'tidal_followed_artists', 'tidal_playlist', 'tidal_playlists',
  'tidal_discovery', 'tidal_new_arrivals', 'tidal_mix',
  'tautulli', 'tautulli_similar',
  'jellyfin_similar',
  'listenbrainz_top', 'listenbrainz_similar', 'listenbrainz_recommendations',
  'listenbrainz_weekly_jams', 'listenbrainz_weekly_exploration',
  'listenbrainz_year', 'listenbrainz_playlist', 'listenbrainz_loved',
  'listenbrainz_fresh_releases', 'listenbrainz_radio',
  'musicbrainz_releases', 'musicbrainz_label', 'musicbrainz_tag',
  'ai_recommendation',
  'discogs_label', 'discogs_genre', 'discogs_artist_releases',
  'bandcamp_genre', 'bandcamp_tag',
] as const;

export const resultHandlingTypes = ['preview', 'queue', 'auto'] as const;

export const scheduleTypes = ['manual', 'daily', 'weekly', 'monthly'] as const;

// Create subscription schema
export const createSubscriptionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  type: z.enum(subscriptionTypes, {
    errorMap: () => ({ message: 'Invalid subscription type' }),
  }),
  config: z.record(z.unknown()).optional().default({}),
  schedule: z.enum(scheduleTypes).optional().nullable(),
  resultHandling: z.enum(resultHandlingTypes).optional().default('preview'),
  isActive: z.boolean().optional().default(true),
  resultLimit: z.number().int().min(1).max(500).optional().default(50),
});

// Update subscription schema (all fields optional)
export const updateSubscriptionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  type: z.enum(subscriptionTypes).optional(),
  config: z.record(z.unknown()).optional(),
  schedule: z.enum(scheduleTypes).optional().nullable(),
  resultHandling: z.enum(resultHandlingTypes).optional(),
  isActive: z.boolean().optional(),
  resultLimit: z.number().int().min(1).max(500).optional(),
});

// Export types for use in routes
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
```

**Step 2: Verify it compiles**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add apps/api/src/schemas/subscription.ts
git commit -m "feat: add Zod schemas for subscription validation"
```

---

## Task 3: Create Connection Schemas

**Files:**
- Create: `apps/api/src/schemas/connection.ts`

**Step 1: Create connection validation schemas**

```typescript
// apps/api/src/schemas/connection.ts
/**
 * Connection Zod Schemas
 * 
 * Validation schemas for connection create/update operations.
 */

import { z } from 'zod';

export const connectionTypes = [
  'lidarr', 'spotify', 'lastfm', 'tautulli', 'deezer', 'tidal', 
  'listenbrainz', 'discogs', 'jellyfin'
] as const;

// Base connection schema
const baseConnectionSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  type: z.enum(connectionTypes, {
    errorMap: () => ({ message: 'Invalid connection type' }),
  }),
  isActive: z.boolean().optional().default(true),
});

// Lidarr config schema
export const lidarrConfigSchema = z.object({
  url: z.string().url('Invalid URL'),
  apiKey: z.string().min(1, 'API key required'),
});

// Last.fm config schema
export const lastfmConfigSchema = z.object({
  apiKey: z.string().min(1, 'API key required'),
});

// Tautulli config schema
export const tautulliConfigSchema = z.object({
  tautulliUrl: z.string().url('Invalid URL'),
  tautulliApiKey: z.string().min(1, 'API key required'),
  plexLibraryId: z.number().int().optional(),
  plexUserId: z.number().int().optional(),
});

// Jellyfin config schema
export const jellyfinConfigSchema = z.object({
  jellyfinUrl: z.string().url('Invalid URL'),
  jellyfinApiKey: z.string().min(1, 'API key required'),
  jellyfinUserId: z.string().optional(),
  jellyfinLibraryId: z.string().optional(),
});

// ListenBrainz config schema
export const listenbrainzConfigSchema = z.object({
  username: z.string().min(1, 'Username required'),
  token: z.string().optional(),
});

// Generic create connection schema (config validated separately per type)
export const createConnectionSchema = baseConnectionSchema.extend({
  config: z.record(z.unknown()),
});

// Update connection schema
export const updateConnectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

// Test connection schema
export const testConnectionSchema = z.object({
  type: z.enum(connectionTypes),
  config: z.record(z.unknown()),
});

// Export types
export type CreateConnectionInput = z.infer<typeof createConnectionSchema>;
export type UpdateConnectionInput = z.infer<typeof updateConnectionSchema>;
export type TestConnectionInput = z.infer<typeof testConnectionSchema>;
```

**Step 2: Commit**

```bash
git add apps/api/src/schemas/connection.ts
git commit -m "feat: add Zod schemas for connection validation"
```

---

## Task 4: Create User/Admin Schemas

**Files:**
- Create: `apps/api/src/schemas/user.ts`

**Step 1: Create user validation schemas**

```typescript
// apps/api/src/schemas/user.ts
/**
 * User Zod Schemas
 * 
 * Validation schemas for user create/update operations (admin routes).
 */

import { z } from 'zod';

export const userRoles = ['admin', 'user'] as const;

// Create user schema
export const createUserSchema = z.object({
  username: z.string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username too long')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password too long'),
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email('Invalid email').optional().nullable(),
  role: z.enum(userRoles).optional().default('user'),
  isActive: z.boolean().optional().default(true),
});

// Update user schema (all fields optional, password optional for updates)
export const updateUserSchema = z.object({
  username: z.string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_-]+$/)
    .optional(),
  password: z.string().min(8).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
  email: z.string().email().optional().nullable(),
  role: z.enum(userRoles).optional(),
  isActive: z.boolean().optional(),
});

// Change password schema
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password required'),
  newPassword: z.string()
    .min(8, 'New password must be at least 8 characters')
    .max(100, 'Password too long'),
});

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});

// Export types
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

**Step 2: Commit**

```bash
git add apps/api/src/schemas/user.ts
git commit -m "feat: add Zod schemas for user validation"
```

---

## Task 5: Apply Validation to Subscription Routes

**Files:**
- Modify: `apps/api/src/routes/subscriptions.ts`

**Step 1: Add imports**

At top of file, add:
```typescript
import { validateBody } from '../middleware/validate.js';
import { createSubscriptionSchema, updateSubscriptionSchema } from '../schemas/subscription.js';
```

**Step 2: Apply middleware to POST /**

Change:
```typescript
subscriptionsRouter.post('/', async (req, res) => {
```
To:
```typescript
subscriptionsRouter.post('/', validateBody(createSubscriptionSchema), async (req, res) => {
```

And remove the manual validation:
```typescript
// Remove these lines:
if (!name || !type) {
  res.status(400).json({ error: 'Name and type required' });
  return;
}
```

**Step 3: Apply middleware to PUT /:id**

Change:
```typescript
subscriptionsRouter.put('/:id', async (req, res) => {
```
To:
```typescript
subscriptionsRouter.put('/:id', validateBody(updateSubscriptionSchema), async (req, res) => {
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/subscriptions.ts
git commit -m "feat: apply Zod validation to subscription routes"
```

---

## Task 6: Apply Validation to Connection Routes

**Files:**
- Modify: `apps/api/src/routes/connections.ts`

**Step 1: Add imports**

```typescript
import { validateBody } from '../middleware/validate.js';
import { createConnectionSchema, updateConnectionSchema, testConnectionSchema } from '../schemas/connection.js';
```

**Step 2: Apply to POST, PUT, and test endpoints**

Apply `validateBody(createConnectionSchema)` to POST /
Apply `validateBody(updateConnectionSchema)` to PUT /:id
Apply `validateBody(testConnectionSchema)` to POST /test

**Step 3: Commit**

```bash
git add apps/api/src/routes/connections.ts
git commit -m "feat: apply Zod validation to connection routes"
```

---

## Task 7: Apply Validation to Admin Routes

**Files:**
- Modify: `apps/api/src/routes/admin.ts`

**Step 1: Add imports**

```typescript
import { validateBody } from '../middleware/validate.js';
import { createUserSchema, updateUserSchema } from '../schemas/user.js';
```

**Step 2: Apply to user create/update endpoints**

Apply `validateBody(createUserSchema)` to POST /users
Apply `validateBody(updateUserSchema)` to PUT /users/:id

**Step 3: Commit**

```bash
git add apps/api/src/routes/admin.ts
git commit -m "feat: apply Zod validation to admin routes"
```

---

## Task 8: Add Correlation IDs

**Files:**
- Create: `apps/api/src/middleware/correlation.ts`
- Modify: `apps/api/src/index.ts`

**Step 1: Create correlation middleware**

```typescript
// apps/api/src/middleware/correlation.ts
/**
 * Correlation ID Middleware
 * 
 * Adds a unique correlation ID to each request for tracing.
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use existing header or generate new UUID
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}
```

**Step 2: Add to Express app in index.ts**

After other middleware, add:
```typescript
import { correlationMiddleware } from './middleware/correlation.js';
// ...
app.use(correlationMiddleware);
```

**Step 3: Commit**

```bash
git add apps/api/src/middleware/correlation.ts apps/api/src/index.ts
git commit -m "feat: add correlation ID middleware for request tracing"
```

---

## Task 9: Improve Error Handler

**Files:**
- Modify: `apps/api/src/middleware/error-handler.ts`

**Step 1: Update error handler with correlation IDs and structured response**

```typescript
// apps/api/src/middleware/error-handler.ts
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { createLogger } from '../lib/logger.js';

const log = createLogger('ErrorHandler');

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  isOperational?: boolean;
}

interface ErrorResponse {
  error: string;
  code: string;
  correlationId?: string;
  details?: unknown;
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;
  const correlationId = req.correlationId;

  // Log server errors with full details
  if (isServerError) {
    log.error(`Server error [${correlationId}]:`, {
      error: err.message,
      stack: err.stack,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
    });
  } else {
    log.warn(`Client error [${correlationId}]: ${err.message}`);
  }

  const response: ErrorResponse = {
    error: isServerError ? 'Internal server error' : err.message,
    code: err.code || (isServerError ? 'INTERNAL_ERROR' : 'CLIENT_ERROR'),
    correlationId,
  };

  // Include details in development
  if (process.env.NODE_ENV === 'development') {
    response.details = {
      message: err.message,
      stack: err.stack,
    };
  }

  res.status(statusCode).json(response);
};
```

**Step 2: Commit**

```bash
git add apps/api/src/middleware/error-handler.ts
git commit -m "feat: improve error handler with correlation IDs and structured logging"
```

---

## Task 10: Add Validation Tests

**Files:**
- Create: `apps/api/tests/middleware/validate.test.ts`
- Create: `apps/api/tests/schemas/subscription.test.ts`

**Step 1: Create validation middleware tests**

```typescript
// apps/api/tests/middleware/validate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { validateBody, validateQuery } from '../../src/middleware/validate.js';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

describe('Validation Middleware', () => {
  const mockRes = () => {
    const res = {} as Response;
    res.status = vi.fn().mockReturnThis();
    res.json = vi.fn().mockReturnThis();
    return res;
  };

  describe('validateBody', () => {
    const schema = z.object({
      name: z.string().min(1),
      count: z.number().int().positive(),
    });

    it('passes valid body to next', () => {
      const req = { body: { name: 'test', count: 5 } } as Request;
      const res = mockRes();
      const next = vi.fn();

      validateBody(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('returns 400 for invalid body', () => {
      const req = { body: { name: '', count: -1 } } as Request;
      const res = mockRes();
      const next = vi.fn();

      validateBody(schema)(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
      }));
    });

    it('includes field-level errors in details', () => {
      const req = { body: { count: 'not a number' } } as Request;
      const res = mockRes();
      const next = vi.fn();

      validateBody(schema)(req, res, next);

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({
          name: expect.any(Array),
          count: expect.any(Array),
        }),
      }));
    });
  });

  describe('validateQuery', () => {
    const schema = z.object({
      page: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().positive().optional(),
    });

    it('passes valid query to next', () => {
      const req = { query: { page: '1', limit: '10' } } as unknown as Request;
      const res = mockRes();
      const next = vi.fn();

      validateQuery(schema)(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });
});
```

**Step 2: Create subscription schema tests**

```typescript
// apps/api/tests/schemas/subscription.test.ts
import { describe, it, expect } from 'vitest';
import { createSubscriptionSchema, updateSubscriptionSchema } from '../../src/schemas/subscription.js';

describe('Subscription Schemas', () => {
  describe('createSubscriptionSchema', () => {
    it('accepts valid subscription', () => {
      const result = createSubscriptionSchema.safeParse({
        name: 'My Subscription',
        type: 'spotify_playlist',
        config: { playlistId: '123' },
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing name', () => {
      const result = createSubscriptionSchema.safeParse({
        type: 'spotify_playlist',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid type', () => {
      const result = createSubscriptionSchema.safeParse({
        name: 'Test',
        type: 'invalid_type',
      });
      expect(result.success).toBe(false);
    });

    it('applies defaults', () => {
      const result = createSubscriptionSchema.safeParse({
        name: 'Test',
        type: 'lastfm_chart',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultHandling).toBe('preview');
        expect(result.data.isActive).toBe(true);
        expect(result.data.resultLimit).toBe(50);
      }
    });
  });

  describe('updateSubscriptionSchema', () => {
    it('accepts partial update', () => {
      const result = updateSubscriptionSchema.safeParse({
        name: 'Updated Name',
      });
      expect(result.success).toBe(true);
    });

    it('accepts empty update', () => {
      const result = updateSubscriptionSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });
});
```

**Step 3: Commit**

```bash
git add apps/api/tests/middleware/validate.test.ts apps/api/tests/schemas/subscription.test.ts
git commit -m "test: add tests for validation middleware and subscription schemas"
```

---

## Task 11: Final Verification

**Step 1: TypeScript check**

Run: `cd /home/chris/Github/mixarr/apps/api && npx tsc --noEmit`
Expected: No errors

**Step 2: Full test suite**

Run: `cd /home/chris/Github/mixarr/apps/api && npm test`
Expected: All new tests pass (pre-existing failures okay)

**Step 3: Manual smoke test**

Test validation with curl:
```bash
curl -X POST http://localhost:3001/api/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"name": "", "type": "invalid"}' | jq
```
Expected: 400 with validation errors

---

## Definition of Done

- [ ] `middleware/validate.ts` exists with validateBody, validateQuery, validateParams
- [ ] Zod schemas for subscriptions, connections, users
- [ ] Validation applied to POST/PUT routes
- [ ] Correlation IDs added to all requests
- [ ] Error handler includes correlation ID and structured response
- [ ] All new tests pass
- [ ] `npx tsc --noEmit` passes
