# Database Schema Improvements - Non-Destructive Migration

> **Date:** January 5, 2026  
> **Status:** Approved for implementation

## Overview

Address technical debt identified in database schema rubber duck analysis. All changes are non-destructive and migrate automatically when users update their containers.

## User Upgrade Process

```bash
docker-compose pull   # Get new images
docker-compose up -d  # Migrations run automatically
```

No manual steps required.

---

## Component 1: Migration Infrastructure

### New Files

```
apps/api/
├── scripts/
│   └── run-data-migrations.ts   # Entry point, runs on startup
├── src/
│   └── migrations/
│       ├── index.ts             # Migration registry & runner
│       ├── 001-fix-sources-default.ts
│       ├── 002-normalize-duplicate-ordering.ts
│       └── 003-consolidate-ai-settings.ts
```

### How It Works

1. Each migration is a versioned function returning `Promise<void>`
2. Version tracked in `global_settings` with key `migration_version`
3. On startup, runs any migrations > current version
4. Updates version after each successful migration

### Docker Command Changes

```dockerfile
# Before:
command: sh -c "npx prisma db push --accept-data-loss && node dist/index.js"

# After:
command: sh -c "npx prisma db push && node dist/scripts/run-data-migrations.js && node dist/index.js"
```

**Note:** `--accept-data-loss` removed for production safety.

---

## Component 2: Schema Changes

### 2.1 Fix sources default

```prisma
# Before
sources Json @default("[]")

# After  
sources Json @default([])
```

### 2.2 Add token expiry tracking

```prisma
model Connection {
  # ... existing fields ...
  tokenExpiresAt DateTime? @map("token_expires_at")  # NEW
}
```

---

## Component 3: Data Migrations

### Migration 001: Fix sources default

```typescript
// Fix subscription_results.sources where it's string "[]" instead of array
await prisma.$executeRaw`
  UPDATE subscription_results 
  SET sources = JSON_ARRAY() 
  WHERE sources = '"[]"' OR sources = '[]'
`;
```

### Migration 002: Normalize duplicate ordering

```typescript
// Ensure mbid1 < mbid2 for all dismissed_duplicates
await prisma.$executeRaw`
  UPDATE dismissed_duplicates 
  SET mbid1 = @temp := mbid1, mbid1 = mbid2, mbid2 = @temp
  WHERE mbid1 > mbid2
`;

// Delete any duplicates created by the swap
await prisma.$executeRaw`
  DELETE d1 FROM dismissed_duplicates d1
  INNER JOIN dismissed_duplicates d2 
  ON d1.mbid1 = d2.mbid1 AND d1.mbid2 = d2.mbid2 AND d1.id > d2.id
`;
```

### Migration 003: Consolidate ai_settings

```typescript
// If multiple rows exist, keep id=1, delete others
const count = await prisma.aISettings.count();
if (count > 1) {
  const first = await prisma.aISettings.findFirst({ orderBy: { id: 'asc' } });
  if (first && first.id !== 1) {
    await prisma.aISettings.create({ data: { ...first, id: 1 } });
  }
  await prisma.$executeRaw`DELETE FROM ai_settings WHERE id != 1`;
}
```

---

## Component 4: Cleanup Jobs

Add to `jobs/scheduler.ts`:

| Job | Schedule | Query | Retention |
|-----|----------|-------|-----------|
| `cleanup-expired-sessions` | Daily 3AM | `DELETE FROM sessions WHERE expires_at < NOW()` | Immediate |
| `cleanup-old-runs` | Daily 3AM | `DELETE FROM subscription_runs WHERE started_at < NOW() - INTERVAL 30 DAY` | 30 days |
| `cleanup-old-results` | Daily 3AM | `DELETE FROM subscription_results WHERE created_at < NOW() - INTERVAL 30 DAY` | 30 days |
| `cleanup-old-logs` | Daily 3AM | `DELETE FROM log_entries WHERE created_at < NOW() - INTERVAL 7 DAY` | 7 days |
| `cleanup-zombie-runs` | Hourly | `UPDATE subscription_runs SET status = 'failed' WHERE status = 'running' AND started_at < NOW() - INTERVAL 1 HOUR` | 1 hour |

---

## Component 5: App Logic Changes

### 5.1 Session invalidation on user deactivate

In admin routes when setting `isActive = false`:

```typescript
await prisma.session.deleteMany({ where: { userId: user.id } });
```

### 5.2 Orphaned subscription handling

In subscription-worker when running a subscription:

```typescript
if (!subscription.connection && requiresConnection(subscription.type)) {
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { isActive: false, lastRunStatus: 'error_no_connection' }
  });
  logger.warn('Subscription deactivated - connection deleted', { subscriptionId: subscription.id });
  return;
}
```

### 5.3 AI settings singleton helper

```typescript
// src/services/ai.ts or src/lib/ai-settings.ts
export async function getAISettings() {
  return prisma.aISettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {}
  });
}

export async function updateAISettings(data: Partial<AISettings>) {
  return prisma.aISettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data
  });
}
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `docker-compose.yml` | Remove `--accept-data-loss`, add migration script |
| `docker-compose.dev.yml` | Remove `--accept-data-loss`, add migration script |
| `Dockerfile.unified` | Remove `--accept-data-loss`, add migration script |
| `apps/api/prisma/schema.prisma` | Fix sources default, add tokenExpiresAt |
| `apps/api/src/jobs/scheduler.ts` | Add cleanup jobs |
| `apps/api/src/jobs/subscription-worker.ts` | Add orphan handling |
| `apps/api/src/routes/admin.ts` | Add session invalidation |
| `apps/api/src/services/ai.ts` | Add singleton helpers |

## New Files

| File | Purpose |
|------|---------|
| `apps/api/scripts/run-data-migrations.ts` | Migration entry point |
| `apps/api/src/migrations/index.ts` | Migration registry |
| `apps/api/src/migrations/001-fix-sources-default.ts` | Data migration |
| `apps/api/src/migrations/002-normalize-duplicate-ordering.ts` | Data migration |
| `apps/api/src/migrations/003-consolidate-ai-settings.ts` | Data migration |
