# Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 security findings identified in the Huntarr cross-check review.

**Architecture:** Surgical edits to existing files — no new services, no schema changes, no migrations. One new file (SECURITY.md).

**Tech Stack:** TypeScript, Express, Prisma, Vitest, bcryptjs

**Design doc:** `docs/plans/2026-02-23-security-hardening-design.md`

---

### Task 1: Plex Auth — Add Timeouts to External Fetch Calls

**Files:**
- Modify: `apps/api/src/auth/strategies/plex.ts`
- Test: `apps/api/tests/auth/plex.test.ts` (existing tests still pass)

**Step 1: Add fetchWithTimeout import and replace bare fetch calls**

In `apps/api/src/auth/strategies/plex.ts`, add import and replace 3 calls:

```typescript
// Add at top, after the PrismaClient import:
import { fetchWithTimeout } from '../../lib/fetch-with-timeout.js';
```

Replace the 3 `fetch(` calls with `fetchWithTimeout(` and add `timeout: 15_000`:

1. `createAuthUrl()` — `fetch('https://plex.tv/api/v2/pins', {` → `fetchWithTimeout('https://plex.tv/api/v2/pins', {` and add `timeout: 15_000,` inside the options object.

2. `handleCallback()` first call — `fetch(\`https://plex.tv/api/v2/pins/${pinId}\`, {` → `fetchWithTimeout(\`https://plex.tv/api/v2/pins/${pinId}\`, {` and add `timeout: 15_000,` inside the options object.

3. `handleCallback()` second call — `fetch('https://plex.tv/api/v2/user', {` → `fetchWithTimeout('https://plex.tv/api/v2/user', {` and add `timeout: 15_000,` inside the options object.

**Step 2: Run existing tests**

```bash
cd apps/api && npx vitest run tests/auth/plex.test.ts
```

Expected: All existing tests PASS (they mock fetch at a higher level).

**Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add apps/api/src/auth/strategies/plex.ts
git commit -m "fix(security): add 15s timeout to Plex auth fetch calls"
```

---

### Task 2: Admin Routes — Fix Bcrypt Cost Factor Inconsistency

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/tests/api/admin.test.ts` (existing tests still pass)

**Step 1: Replace inline bcrypt with hashPassword utility**

In `apps/api/src/routes/admin.ts`:

1. Replace the import line:
```typescript
// OLD:
import bcrypt from 'bcryptjs';
// NEW:
import { hashPassword } from '../auth/passport.js';
```

2. In the create user handler (~line 120), replace:
```typescript
// OLD:
const passwordHash = await bcrypt.hash(password, 10);
// NEW:
const passwordHash = await hashPassword(password);
```

3. In the update user handler (~line 190), replace:
```typescript
// OLD:
updateData.passwordHash = await bcrypt.hash(password, 10);
// NEW:
updateData.passwordHash = await hashPassword(password);
```

**Step 2: Run existing tests**

```bash
cd apps/api && npx vitest run tests/api/admin.test.ts
```

Expected: All existing tests PASS (they use mock Prisma, don't test hashing directly).

**Step 3: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 4: Commit**

```bash
git add apps/api/src/routes/admin.ts
git commit -m "fix(security): use hashPassword utility (cost 12) in admin routes"
```

---

### Task 3: Remove Dead Cheerio Dependency

**Files:**
- Modify: `apps/api/package.json`

**Step 1: Remove cheerio from dependencies and @types/cheerio from devDependencies**

In `apps/api/package.json`:
- Remove line: `"cheerio": "^1.1.2",` from `dependencies`
- Remove line: `"@types/cheerio": "^0.22.35",` from `devDependencies`

**Step 2: Install to update lockfile**

```bash
cd /home/chris/Github/mixarr && pnpm install
```

Expected: Clean install, no errors.

**Step 3: Type check to confirm nothing depended on it**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors (nothing imports cheerio).

**Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore: remove unused cheerio dependency"
```

---

### Task 4: Fix Misleading "Encrypted" Comments in Prisma Schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Update comments**

1. On the `SsoProvider` model (~line 76):
```prisma
// OLD:
config    Json            // Encrypted credentials, URLs, mappings
// NEW:
config    Json            // Credentials, URLs, mappings (stored as JSON)
```

2. On the `Connection` model (~line 111):
```prisma
// OLD:
config    Json           // Encrypted sensitive data
// NEW:
config    Json           // Sensitive data (stored as JSON)
```

**Step 2: Commit**

```bash
git add apps/api/prisma/schema.prisma
git commit -m "docs: fix misleading 'encrypted' comments in Prisma schema"
```

---

### Task 5: Notification Channels — Mask Secrets in API Responses

**Files:**
- Modify: `apps/api/src/routes/notifications.ts`
- Test: `apps/api/tests/api/notifications.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/api/notifications.test.ts`, in the `GET /api/notifications/channels` describe block:

```typescript
it('should mask sensitive fields in channel config', async () => {
  const { default: prisma } = await import('../../src/lib/db.js');
  (prisma.notificationChannel.findMany as any).mockResolvedValue([
    {
      id: 1,
      userId: 1,
      type: 'discord',
      name: 'My Discord',
      config: { webhookUrl: 'https://discord.com/api/webhooks/123456/abcdef-secret-token' },
      events: ['subscription.completed'],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 2,
      userId: 1,
      type: 'telegram',
      name: 'My Telegram',
      config: { botToken: '123456:ABC-DEF-secret-token', chatId: '99999' },
      events: ['subscription.failed'],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  const res = await request(app).get('/api/notifications/channels');

  expect(res.status).toBe(200);
  expect(res.body).toHaveLength(2);
  // Discord webhook URL should be masked
  expect(res.body[0].config.webhookUrl).toBe('••••••••');
  // Telegram bot token should be masked, chatId should be visible
  expect(res.body[1].config.botToken).toBe('••••••••');
  expect(res.body[1].config.chatId).toBe('99999');
});
```

**Step 2: Run to verify it fails**

```bash
cd apps/api && npx vitest run tests/api/notifications.test.ts
```

Expected: FAIL — config is returned unsanitized.

**Step 3: Implement the sanitizer**

In `apps/api/src/routes/notifications.ts`, add the masking constant and helper function after the `VALID_EVENTS` array (before the first route handler):

```typescript
/** Sentinel value for masked secrets — detected in PUT to preserve existing values */
const SECRET_MASK = '••••••••';

/** Keys containing secrets per channel type */
const SENSITIVE_KEYS: Record<string, string[]> = {
  discord: ['webhookUrl'],
  telegram: ['botToken'],
  pushover: ['apiToken', 'userKey'],
  email: ['password'],
  webhook: ['headers'],
};

/** Mask sensitive fields in channel config for API responses */
function sanitizeChannelConfig(type: string, config: Record<string, any>): Record<string, any> {
  const sanitized = { ...config };
  for (const key of SENSITIVE_KEYS[type] || []) {
    if (sanitized[key] != null) {
      sanitized[key] = SECRET_MASK;
    }
  }
  return sanitized;
}
```

Then update the `GET /channels` handler to sanitize before responding:

```typescript
// OLD:
    res.json(channels);
// NEW:
    res.json(channels.map(ch => ({
      ...ch,
      config: sanitizeChannelConfig(ch.type, ch.config as Record<string, any>),
    })));
```

Also update the `POST /channels` response:

```typescript
// OLD:
    res.status(201).json(channel);
// NEW:
    res.status(201).json({
      ...channel,
      config: sanitizeChannelConfig(channel.type, channel.config as Record<string, any>),
    });
```

Also update the `PUT /channels/:id` handler. First, add sentinel detection BEFORE the Prisma update call to preserve masked values:

```typescript
    // Preserve secrets when frontend sends back masked values
    if (data.config) {
      const existingConfig = existing.config as Record<string, any>;
      for (const [key, value] of Object.entries(data.config)) {
        if (value === SECRET_MASK) {
          data.config[key] = existingConfig[key];
        }
      }
    }
```

Insert this block after the config validation check and before the `prisma.notificationChannel.update` call.

Then sanitize the PUT response:

```typescript
// OLD:
    res.json(channel);
// NEW:
    res.json({
      ...channel,
      config: sanitizeChannelConfig(channel.type, channel.config as Record<string, any>),
    });
```

**Step 4: Run tests to verify they pass**

```bash
cd apps/api && npx vitest run tests/api/notifications.test.ts
```

Expected: All tests PASS.

**Step 5: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 6: Commit**

```bash
git add apps/api/src/routes/notifications.ts apps/api/tests/api/notifications.test.ts
git commit -m "fix(security): mask notification channel secrets in API responses"
```

---

### Task 6: Connection Test Endpoint — Add SSRF Protection

**Files:**
- Modify: `apps/api/src/routes/connections.ts`
- Test: `apps/api/tests/api/connections.test.ts`

**Step 1: Write the failing test**

This test requires a supertest-based test. Add a new test file `apps/api/tests/api/connections-test-auth.test.ts`:

```typescript
/**
 * Connection Test Endpoint Auth Tests
 * 
 * Verifies SSRF protection: POST /api/connections/test requires
 * authentication after setup (users exist), open during setup (no users).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

const mockUserCount = vi.fn();
const mockIsAuthenticated = vi.fn();

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: { count: mockUserCount },
    connection: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    globalSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

// Mock auth middleware (no-op — we test inline checks)
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock validate middleware (passthrough)
vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateParams: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateQuery: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock services
vi.mock('../../src/services/lidarr.js', () => ({ LidarrService: vi.fn() }));
vi.mock('../../src/services/slskd.js', () => ({ SlskdService: vi.fn() }));
vi.mock('../../src/services/lastfm.js', () => ({ LastfmService: vi.fn() }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: vi.fn() }));
vi.mock('../../src/lib/settings.js', () => ({ getBaseUrl: vi.fn() }));

describe('POST /api/connections/test — SSRF protection', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Simulate unauthenticated request
    app.use((req: any, _res, next) => {
      req.isAuthenticated = mockIsAuthenticated;
      req.user = undefined;
      next();
    });
    const { connectionsRouter } = await import('../../src/routes/connections.js');
    app.use('/api/connections', connectionsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject unauthenticated requests after setup', async () => {
    mockUserCount.mockResolvedValue(1); // Users exist = setup complete
    mockIsAuthenticated.mockReturnValue(false);

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'lidarr', url: 'http://169.254.169.254/latest/meta-data', apiKey: 'test' });

    expect(res.status).toBe(401);
  });

  it('should allow authenticated non-admin requests after setup', async () => {
    mockUserCount.mockResolvedValue(1);
    mockIsAuthenticated.mockReturnValue(true);
    // Patch user onto request as regular user
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => true;
      req.user = { id: 1, role: 'user' };
      next();
    });
    const { connectionsRouter } = await import('../../src/routes/connections.js');
    app.use('/api/connections', connectionsRouter);

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'spotify', clientId: 'abcdefghijklmnop', clientSecret: 'abcdefghijklmnop' });

    // Regular users can test connections — should not get 401/403
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('should allow unauthenticated requests during setup (no users)', async () => {
    mockUserCount.mockResolvedValue(0); // No users = setup in progress

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'spotify', clientId: 'abcdefghijklmnop', clientSecret: 'abcdefghijklmnop' });

    // Should reach the handler (may succeed or fail based on mocks, but not 401/403)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd apps/api && npx vitest run tests/api/connections-test-auth.test.ts
```

Expected: First test FAILS — unauthenticated request is currently allowed.

**Step 3: Add inline auth check to connections.ts**

In `apps/api/src/routes/connections.ts`, add a `prisma` import reference (it's already imported as `default`). Inside the `POST /test` handler, add the auth check right after `try {` and before `const { type, ... } = req.body;`:

```typescript
    // SSRF protection: require authentication after setup (any logged-in user can test)
    const userCount = await prisma.user.count();
    if (userCount > 0) {
      if (!req.isAuthenticated()) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }
    }
```

**Step 4: Run tests**

```bash
cd apps/api && npx vitest run tests/api/connections-test-auth.test.ts
```

Expected: All 3 tests PASS.

**Step 5: Run all connection tests to check for regressions**

```bash
cd apps/api && npx vitest run tests/api/connections
```

Expected: All PASS.

**Step 6: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 7: Commit**

```bash
git add apps/api/src/routes/connections.ts apps/api/tests/api/connections-test-auth.test.ts
git commit -m "fix(security): require authentication for connection test endpoint after setup"
```

---

### Task 7: Poll Job — Add Path Traversal Validation

**Files:**
- Modify: `apps/api/src/jobs/slskd-poll.ts`
- Test: `apps/api/tests/jobs/slskd-poll.test.ts`

**Step 1: Write the failing test**

Add to `apps/api/tests/jobs/slskd-poll.test.ts`, in the `pollSlskdDownloads` describe block:

```typescript
    it('should skip downloads with path traversal in username', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: '../../etc', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: '../../etc',
          directories: [{
            directory: 'cron.d',
            files: [{ filename: '/music/track.flac', state: 'Completed' }],
          }],
        },
      ]);

      mockDownloadUpdateMany.mockResolvedValue({ count: 0 });

      await pollSlskdDownloads();

      // Should NOT attempt to organize — path traversal detected
      expect(mockDownloadUpdateMany).not.toHaveBeenCalled();
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });

    it('should skip downloads with path traversal in directory', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'normaluser', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'normaluser',
          directories: [{
            directory: '../../../etc/cron.d',
            files: [{ filename: '/music/track.flac', state: 'Completed' }],
          }],
        },
      ]);

      mockDownloadUpdateMany.mockResolvedValue({ count: 0 });

      await pollSlskdDownloads();

      // Should NOT attempt to organize — path traversal detected
      expect(mockDownloadUpdateMany).not.toHaveBeenCalled();
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });
```

**Step 2: Run to verify tests fail**

```bash
cd apps/api && npx vitest run tests/jobs/slskd-poll.test.ts
```

Expected: New tests FAIL — path traversal downloads are currently processed.

**Step 3: Add path validation to slskd-poll.ts**

In `apps/api/src/jobs/slskd-poll.ts`:

1. Add import at top:
```typescript
import { isPathSafe } from '../services/slskd-organizer.js';
```

2. In the `slskdStatus.state === 'Completed'` block, BEFORE the line `const downloadPath = ...`, add validation:

```typescript
        // Validate the constructed path stays within downloadDir (path traversal protection)
        const relativePath = `${download.username}/${slskdStatus.directory}/${basename}`;
        if (!isPathSafe(relativePath, downloadDir)) {
          log.warn('Unsafe download path detected — possible path traversal', {
            downloadId: download.id,
            username: download.username,
            directory: slskdStatus.directory,
          });
          continue;
        }
```

Then change the `downloadPath` construction to use `path.resolve` for consistency:

```typescript
        // OLD:
        const downloadPath = `${downloadDir}/${download.username}/${slskdStatus.directory}/${basename}`;
        // NEW:
        const downloadPath = path.resolve(downloadDir, relativePath);
```

**Step 4: Update the mock to export isPathSafe**

The test file already mocks `../../src/services/slskd-organizer.js`. Update that mock to include `isPathSafe`:

In the existing mock block in `slskd-poll.test.ts`, change:

```typescript
// OLD:
vi.mock('../../src/services/slskd-organizer.js', () => ({
  SlskdOrganizerService: class MockSlskdOrganizerService {
    organizeFile = mockOrganizeFile;
  },
}));
// NEW:
vi.mock('../../src/services/slskd-organizer.js', async () => {
  const actual = await vi.importActual('../../src/services/slskd-organizer.js');
  return {
    ...(actual as any),
    SlskdOrganizerService: class MockSlskdOrganizerService {
      organizeFile = mockOrganizeFile;
    },
  };
});
```

This imports the real `isPathSafe` and `sanitizePath` functions while still mocking the service class.

**Step 5: Run tests**

```bash
cd apps/api && npx vitest run tests/jobs/slskd-poll.test.ts
```

Expected: All tests PASS (including new ones).

**Step 6: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 7: Commit**

```bash
git add apps/api/src/jobs/slskd-poll.ts apps/api/tests/jobs/slskd-poll.test.ts
git commit -m "fix(security): add path traversal validation to slskd poll job"
```

---

### Task 8: Create SECURITY.md

**Files:**
- Create: `SECURITY.md` (repo root)

**Step 1: Create the file**

```markdown
# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest | :x:               |

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please report them through one of these channels:

1. **GitHub Security Advisories** (preferred): Navigate to the [Security tab](../../security/advisories) of this repository and click "Report a vulnerability"
2. **Email**: Send details to the maintainers listed in the repository

### What to include

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 7 days |
| Fix or mitigation | Within 30 days for critical/high severity |

### What to Expect

- You'll receive an acknowledgment within 48 hours
- We'll work with you to understand and validate the issue
- We'll keep you informed of our progress
- We'll credit you in the fix (unless you prefer anonymity)

## Scope

The following are in scope:
- The Mixarr application code (API and web frontend)
- Authentication and authorization mechanisms
- Data handling and storage
- Docker container configurations
- Third-party integration security

The following are out of scope:
- Vulnerabilities in upstream dependencies (report these to the dependency maintainer)
- Social engineering attacks
- Denial of service attacks that require excessive resources
- Issues in third-party services that Mixarr integrates with (Lidarr, Spotify, etc.)

## Security Best Practices for Deployers

- Always set a strong `SESSION_SECRET` environment variable
- Use HTTPS in production (the default Caddy configuration handles this)
- Change default database passwords before deploying
- Keep your Mixarr installation updated to the latest version
- Do not expose the API port (3005) directly — use the reverse proxy
```

**Step 2: Commit**

```bash
git add SECURITY.md
git commit -m "docs: add SECURITY.md vulnerability disclosure policy"
```

---

### Task 9: Final Verification

**Step 1: Run all API tests**

```bash
cd apps/api && npx vitest run
```

Expected: All tests PASS, no regressions.

**Step 2: Type check**

```bash
cd apps/api && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Run web tests**

```bash
cd apps/web && npx vitest run
```

Expected: All tests PASS (no web changes, just confirming no breakage).

---

## Plan Review Gate

### Wiring Completeness ✅
- Fix 5: Masking applied to GET, POST, and PUT responses. Sentinel detection in PUT handler preserves real secrets.
- Fix 6: Auth check runs before any HTTP request is made to user-supplied URL.
- Fix 7: Validation runs before path construction and DB write.

### Resource Lifecycle ✅
- No new resources created (connections, files, sessions).
- Fix 1: AbortSignal auto-cleans up on timeout.

### Dependency Completeness ✅
- All imports reference existing modules (`fetchWithTimeout`, `hashPassword`, `isPathSafe`).
- Fix 3 removes a dependency, doesn't add one.

### Config Consistency ✅
- No Docker/config changes.

### Async/Sync Boundaries ✅
- All changes are within existing async handlers.
- `prisma.user.count()` in Fix 6 is async and properly awaited.

### Missing Integration Steps ✅
- Fix 5 sentinel detection ensures frontend → PUT → DB round-trip preserves secrets.
- Fix 7 mock update ensures `isPathSafe` is the real function in tests.

**Plan review passed.**
