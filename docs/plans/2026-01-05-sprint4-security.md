# Sprint 4: Security & Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Harden security with proper rate limiting, CSRF protection, security headers, and add structured logging.

**Architecture:** Audit and enhance existing security middleware, add rate limiting to auth endpoints, implement structured JSON logging for production.

---

## Task Overview

| # | Task | Effort | Focus |
|---|------|--------|-------|
| 1 | Add rate limiting to auth endpoints | 30 min | `routes/auth.ts`, `middleware/rate-limit.ts` |
| 2 | Audit CSRF protection | 20 min | `middleware/csrf.ts`, `index.ts` |
| 3 | Audit Helmet security headers | 20 min | `index.ts` |
| 4 | Add structured JSON logging | 45 min | `lib/logger.ts`, replace console.log/error |
| 5 | Add request logging middleware | 30 min | `middleware/request-logger.ts` |
| 6 | Add security tests for rate limiting | 30 min | `tests/security/rate-limit.test.ts` |
| 7 | Final verification | 15 min | TypeScript check, all tests pass |

---

## Task 1: Add Rate Limiting to Auth Endpoints

**Files:**
- Create: `apps/api/src/middleware/rate-limit.ts`
- Modify: `apps/api/src/routes/auth.ts`

**Step 1: Create rate limit middleware**

```typescript
// apps/api/src/middleware/rate-limit.ts
/**
 * Rate Limiting Middleware
 * 
 * Protects auth endpoints from brute force attacks.
 */

import rateLimit from 'express-rate-limit';

// Strict rate limit for auth endpoints (login, register, password reset)
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many authentication attempts. Please try again in 15 minutes.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Only count failed attempts
});

// General API rate limit
export const apiRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please slow down.'
    }
  },
  standardHeaders: true,
  legacyHeaders: false
});
```

**Step 2: Apply to auth routes**

In `apps/api/src/routes/auth.ts`:

```typescript
import { authRateLimit } from '../middleware/rate-limit.js';

// Apply to login endpoint
router.post('/login', authRateLimit, async (req, res, next) => { ... });

// Apply to register endpoint (if exists)
router.post('/register', authRateLimit, async (req, res, next) => { ... });
```

**Verification:**
- TypeScript compiles
- Tests pass

---

## Task 2: Audit CSRF Protection

**Files:**
- Review: `apps/api/src/index.ts`
- Review: `apps/api/src/middleware/` for CSRF

**Goal:** Ensure CSRF protection is properly configured for state-changing requests.

**Check:**
1. Is CSRF middleware applied?
2. Is it excluded from API routes that use Bearer tokens?
3. Is it applied to session-based routes?

If CSRF is missing or misconfigured, add proper configuration.

**Verification:**
- Document findings
- Fix any issues found

---

## Task 3: Audit Helmet Security Headers

**Files:**
- Review: `apps/api/src/index.ts`

**Goal:** Ensure Helmet is properly configured with appropriate security headers.

**Check:**
1. Is Helmet applied?
2. Content Security Policy configured?
3. X-Frame-Options set?
4. XSS protection enabled?

**Expected configuration:**
```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
    }
  },
  crossOriginEmbedderPolicy: false // May need to be false for some integrations
}));
```

**Verification:**
- Document findings
- Fix any issues found

---

## Task 4: Add Structured JSON Logging

**Files:**
- Create: `apps/api/src/lib/logger.ts`
- Modify: Files using `console.log`/`console.error`

**Step 1: Create logger module**

```typescript
// apps/api/src/lib/logger.ts
/**
 * Structured Logger
 * 
 * JSON logging for production, pretty logging for development.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== 'production';

function formatLog(entry: LogEntry): string {
  if (isDev) {
    const { timestamp, level, message, ...rest } = entry;
    const meta = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `[${timestamp}] ${level.toUpperCase()}: ${message}${meta}`;
  }
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  
  const formatted = formatLog(entry);
  
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => log('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => log('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => log('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => log('error', message, meta)
};
```

**Step 2: Replace console.log/error in key files**

Priority files to update:
- `index.ts`
- `middleware/error-handler.ts`
- `services/*.ts`

**Verification:**
- TypeScript compiles
- Tests pass

---

## Task 5: Add Request Logging Middleware

**Files:**
- Create: `apps/api/src/middleware/request-logger.ts`
- Modify: `apps/api/src/index.ts`

**Step 1: Create request logger**

```typescript
// apps/api/src/middleware/request-logger.ts
/**
 * Request Logging Middleware
 * 
 * Logs incoming requests with timing and correlation IDs.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      correlationId: req.correlationId
    };
    
    if (res.statusCode >= 500) {
      logger.error('Request completed with error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });
  
  next();
}
```

**Step 2: Add to Express app**

In `apps/api/src/index.ts`, after correlation middleware:
```typescript
import { requestLogger } from './middleware/request-logger.js';

app.use(requestLogger);
```

**Verification:**
- TypeScript compiles
- Tests pass

---

## Task 6: Add Security Tests for Rate Limiting

**Files:**
- Create: `apps/api/tests/security/rate-limit.test.ts`

**Tests to write:**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { authRateLimit, apiRateLimit } from '../../src/middleware/rate-limit.js';

describe('Rate Limiting', () => {
  describe('authRateLimit', () => {
    it('allows requests under the limit', async () => {
      // Test 5 requests succeed
    });
    
    it('blocks requests over the limit', async () => {
      // Test 6th request returns 429
    });
    
    it('includes rate limit headers', async () => {
      // Test X-RateLimit-* headers present
    });
  });
  
  describe('apiRateLimit', () => {
    it('allows 100 requests per minute', async () => {
      // Test general API limit
    });
  });
});
```

**Verification:**
- All tests pass

---

## Task 7: Final Verification

**Commands:**
```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npm test
```

**Checklist:**
- [ ] TypeScript compiles without errors
- [ ] All tests pass (except pre-existing SSO failures)
- [ ] Rate limiting applied to auth routes
- [ ] Structured logging in place
- [ ] Request logging middleware active
- [ ] Commit all changes
