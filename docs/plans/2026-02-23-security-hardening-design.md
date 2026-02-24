# Security Hardening Design

**Date:** 2026-02-23  
**Context:** Cross-check against Huntarr.io security review findings applied categorically to Mixarr codebase  
**Scope:** 8 fixes addressing findings that exist in Mixarr (excludes #19 CI/CD pinning and #20 container-as-root)

---

## Fix Inventory

| # | Fix | Severity | Effort | Files |
|---|-----|----------|--------|-------|
| 1 | Plex auth timeouts | Medium | Quick | `apps/api/src/auth/strategies/plex.ts` |
| 2 | Bcrypt cost consistency | Low-Med | Quick | `apps/api/src/routes/admin.ts` |
| 3 | Dead cheerio dependency | Info | Quick | `apps/api/package.json` |
| 4 | Misleading "encrypted" schema comments | Info | Quick | `apps/api/prisma/schema.prisma` |
| 5 | Notification secrets masking | Medium | Medium | `apps/api/src/routes/notifications.ts` |
| 6 | SSRF protection on connection test | Medium | Medium | `apps/api/src/routes/connections.ts` |
| 7 | Poll job path validation | Low-Med | Medium | `apps/api/src/jobs/slskd-poll.ts` |
| 8 | SECURITY.md | Best Practice | New file | `SECURITY.md` |

---

## Detailed Specifications

### Fix 1: Plex Auth Timeouts

**Problem:** 3 bare `fetch()` calls to `plex.tv` with no timeout — can hang indefinitely during auth flow.

**Change:**
- Import `fetchWithTimeout` from `../../lib/fetch-with-timeout.js`
- Replace all 3 `fetch()` calls (lines ~42, ~73, ~91) with `fetchWithTimeout()` adding `timeout: 15_000`
- 15s matches other external service timeout conventions in the codebase

**Error handling:** `AbortError` from timeout propagates to existing try/catch blocks. `createAuthUrl()` throws → caller handles. `handleCallback()` returns null on error → caller handles.

### Fix 2: Bcrypt Cost Consistency

**Problem:** Admin routes use `bcrypt.hash(password, 10)` while auth routes use cost 12. An exported `hashPassword()` utility exists at cost 12 but admin routes don't use it.

**Change:**
- Import `hashPassword` from `../auth/passport.js`
- Replace `bcrypt.hash(password, 10)` on lines ~120 and ~190 with `await hashPassword(password)`
- Remove unused `bcrypt` import

**Backward compat:** bcrypt stores cost factor in the hash, so existing cost-10 hashes verify correctly. No migration needed.

### Fix 3: Dead Cheerio Dependency

**Problem:** `cheerio` is listed in dependencies but never imported anywhere.

**Change:** Remove `cheerio` from `dependencies` and `@types/cheerio` from `devDependencies` in `apps/api/package.json`.

### Fix 4: Misleading Schema Comments

**Problem:** Prisma schema labels `config Json` fields as "Encrypted" but no encryption exists.

**Change:**
- `SsoProvider.config`: `// Encrypted credentials, URLs, mappings` → `// Credentials, URLs, mappings (stored as JSON)`
- `Connection.config`: `// Encrypted sensitive data` → `// Sensitive data (stored as JSON)`

### Fix 5: Notification Secrets Masking

**Problem:** `GET /channels` returns full config including Discord webhook URLs, Telegram bot tokens, Pushover API keys.

**Change — Masking helper:**
```typescript
const MASK = '••••••••';

function sanitizeChannelConfig(type: string, config: Record<string, any>): Record<string, any> {
  const sanitized = { ...config };
  const sensitiveKeys: Record<string, string[]> = {
    discord: ['webhookUrl'],
    telegram: ['botToken'],
    pushover: ['apiToken', 'userKey'],
    email: ['password'],
    webhook: ['headers'],  // May contain auth tokens
  };
  for (const key of sensitiveKeys[type] || []) {
    if (sanitized[key]) sanitized[key] = MASK;
  }
  return sanitized;
}
```

**Apply to:**
- `GET /channels` response — map channels through sanitizer
- `POST /channels` response — sanitize before returning created channel
- `PUT /channels/:id` response — sanitize before returning updated channel

**PUT handler sentinel detection (CRITICAL):**
When updating, if config contains the mask sentinel `••••••••` for a field, preserve the existing DB value for that field instead of saving the sentinel. This prevents accidental data loss when frontend sends back masked values.

```typescript
// In PUT handler, before saving:
if (data.config) {
  const existing = await prisma.notificationChannel.findUnique({ where: { id } });
  const existingConfig = existing?.config as Record<string, any> || {};
  for (const [key, value] of Object.entries(data.config)) {
    if (value === MASK) {
      data.config[key] = existingConfig[key];
    }
  }
}
```

### Fix 6: SSRF Protection on Connection Test

**Problem:** `POST /connections/test` is public — accepts URL + API key, makes HTTP request. SSRF vector.

**Change:** Add inline auth check (same pattern as `POST /settings/base-url`):
```typescript
// Before the switch statement:
const userCount = await prisma.user.count();
if (userCount > 0) {
  if (!req.isAuthenticated()) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  if (req.user?.role !== 'admin') {
    res.status(403).json({ success: false, error: 'Admin access required' });
    return;
  }
}
```

**Trade-off:** During setup (0 users), endpoint remains open for the setup wizard. Window closes as soon as first user is created.

### Fix 7: Poll Job Path Validation

**Problem:** `download.username` and `slskdStatus.directory` flow into path construction without validation. Soulseek peers could inject traversal sequences.

**Change:** Import `isPathSafe` from `../services/slskd-organizer.js` and validate the relative path before constructing absolute path:

```typescript
import { isPathSafe } from '../services/slskd-organizer.js';

// Before line 83:
const relativePath = `${download.username}/${slskdStatus.directory}/${basename}`;
if (!isPathSafe(relativePath, downloadDir)) {
  log.warn('Unsafe download path detected — possible path traversal', {
    downloadId: download.id,
    username: download.username,
    directory: slskdStatus.directory,
  });
  continue;
}
const downloadPath = path.resolve(downloadDir, relativePath);
```

**Note:** `isPathSafe` internally calls `sanitizePath` (Unicode normalization, null byte removal) then verifies the resolved path stays within the base directory. Directory separators in Soulseek paths are legitimate — the containment check handles them.

### Fix 8: SECURITY.md

Create a standard vulnerability disclosure policy:
- Contact method (GitHub security advisories or email)
- Expected response timeline (48h acknowledge, 7d assessment, 30d fix)
- Scope (what's covered)
- Safe harbor language

---

## Design Attack Gate

### Rubber-Duck
All fixes trace cleanly. Fix 5 sentinel pattern and Fix 7 containment check were refined during this review.

### Attack
- Fix 2: bcrypt cost backward compat ✅ (cost stored in hash)
- Fix 5: PUT data corruption risk ✅ (sentinel detection added)
- Fix 6: Setup-window SSRF ✅ (accepted trade-off, matches existing pattern)
- Fix 7: Directory separators in Soulseek paths ✅ (containment check, not component check)

### Best Practices
✅ No new dependencies. All imports from existing modules. No async boundary issues.

### Verdict
Design attack passed — one amendment made (Fix 5 PUT sentinel handling). No architectural contradictions.
