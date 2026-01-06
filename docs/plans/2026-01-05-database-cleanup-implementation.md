# Database Schema Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement non-destructive database migrations, cleanup jobs, and app logic improvements for production safety.

**Architecture:** Create a data migration framework that runs on startup, add schema changes via Prisma, implement scheduled cleanup jobs, and add app logic for session invalidation and orphan handling.

**Tech Stack:** Prisma ORM, TypeScript, BullMQ scheduler, MySQL 8.0

---

## Task Overview

| # | Task | Effort | Focus |
|---|------|--------|-------|
| 1 | Create migration infrastructure | 30 min | `scripts/run-data-migrations.ts`, `src/migrations/` |
| 2 | Implement Migration 001: Fix sources default | 15 min | `src/migrations/001-fix-sources-default.ts` |
| 3 | Implement Migration 002: Normalize duplicate ordering | 15 min | `src/migrations/002-normalize-duplicate-ordering.ts` |
| 4 | Implement Migration 003: Consolidate ai_settings | 15 min | `src/migrations/003-consolidate-ai-settings.ts` |
| 5 | Update schema.prisma | 10 min | Fix sources default, add tokenExpiresAt |
| 6 | Update Docker startup commands | 10 min | Remove --accept-data-loss, add migration script |
| 7 | Add cleanup jobs to scheduler | 30 min | `src/jobs/scheduler.ts` |
| 8 | Add session invalidation on user deactivate | 15 min | `src/routes/admin.ts` |
| 9 | Add orphan subscription handling | 15 min | `src/jobs/subscription-worker.ts` |
| 10 | Add AI settings singleton helpers | 15 min | `src/services/ai.ts` |
| 11 | Add migration tests | 30 min | `tests/migrations/` |
| 12 | Final verification | 15 min | TypeScript check, all tests pass |

---

## Task 1: Create Migration Infrastructure

**Files:**
- Create: `apps/api/scripts/run-data-migrations.ts`
- Create: `apps/api/src/migrations/index.ts`

**Step 1: Create migration registry**

Create `apps/api/src/migrations/index.ts`:

```typescript
/**
 * Data Migration Registry
 * 
 * Tracks and runs data migrations on startup.
 * Version stored in global_settings with key 'migration_version'.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Migrations');

export interface Migration {
  version: number;
  name: string;
  run: (prisma: PrismaClient) => Promise<void>;
}

// Migration registry - add new migrations here
export const migrations: Migration[] = [];

/**
 * Get current migration version from database
 */
async function getCurrentVersion(prisma: PrismaClient): Promise<number> {
  const setting = await prisma.globalSetting.findUnique({
    where: { key: 'migration_version' }
  });
  return setting ? (setting.value as number) : 0;
}

/**
 * Update migration version in database
 */
async function setVersion(prisma: PrismaClient, version: number): Promise<void> {
  await prisma.globalSetting.upsert({
    where: { key: 'migration_version' },
    create: { key: 'migration_version', value: version },
    update: { value: version }
  });
}

/**
 * Run all pending migrations
 */
export async function runMigrations(prisma: PrismaClient): Promise<void> {
  const currentVersion = await getCurrentVersion(prisma);
  const pendingMigrations = migrations.filter(m => m.version > currentVersion);

  if (pendingMigrations.length === 0) {
    logger.info('No pending data migrations');
    return;
  }

  logger.info(`Running ${pendingMigrations.length} pending migration(s)`, { 
    currentVersion, 
    targetVersion: Math.max(...migrations.map(m => m.version)) 
  });

  for (const migration of pendingMigrations.sort((a, b) => a.version - b.version)) {
    logger.info(`Running migration ${migration.version}: ${migration.name}`);
    
    try {
      await migration.run(prisma);
      await setVersion(prisma, migration.version);
      logger.info(`Migration ${migration.version} completed`);
    } catch (error) {
      logger.error(`Migration ${migration.version} failed`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
      throw error; // Stop on failure
    }
  }

  logger.info('All migrations completed successfully');
}
```

**Step 2: Create migration entry point script**

Create `apps/api/scripts/run-data-migrations.ts`:

```typescript
/**
 * Data Migration Runner
 * 
 * Entry point for running data migrations on container startup.
 * Called from Docker command before starting the API.
 */

import { PrismaClient } from '@prisma/client';
import { runMigrations } from '../src/migrations/index.js';
import { createLogger } from '../src/lib/logger.js';

const logger = createLogger('MigrationRunner');

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  try {
    logger.info('Starting data migrations...');
    await runMigrations(prisma);
    logger.info('Data migrations complete');
    process.exit(0);
  } catch (error) {
    logger.error('Data migrations failed', { 
      error: error instanceof Error ? error.message : String(error) 
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
```

**Verification:**
- TypeScript compiles: `cd apps/api && npx tsc --noEmit`
- Commit: `git add apps/api/scripts/run-data-migrations.ts apps/api/src/migrations/index.ts && git commit -m "feat: add data migration infrastructure"`

---

## Task 2: Implement Migration 001 - Fix sources default

**Files:**
- Create: `apps/api/src/migrations/001-fix-sources-default.ts`
- Modify: `apps/api/src/migrations/index.ts`

**Step 1: Create migration file**

Create `apps/api/src/migrations/001-fix-sources-default.ts`:

```typescript
/**
 * Migration 001: Fix sources default
 * 
 * The subscription_results.sources field was defaulting to the string "[]"
 * instead of an empty JSON array. This migration fixes existing rows.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Migration-001');

export async function run(prisma: PrismaClient): Promise<void> {
  // Count affected rows first
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM subscription_results 
    WHERE JSON_TYPE(sources) = 'STRING' OR sources = '[]' OR sources = '"[]"'
  `;
  const affectedCount = Number(countResult[0]?.count ?? 0);

  if (affectedCount === 0) {
    logger.info('No rows need fixing');
    return;
  }

  logger.info(`Fixing ${affectedCount} rows with invalid sources format`);

  // Fix rows where sources is a string instead of array
  await prisma.$executeRaw`
    UPDATE subscription_results 
    SET sources = JSON_ARRAY() 
    WHERE JSON_TYPE(sources) = 'STRING' OR sources = '[]' OR sources = '"[]"'
  `;

  logger.info('Sources field fixed successfully');
}
```

**Step 2: Register migration**

Add to `apps/api/src/migrations/index.ts` after the migrations array declaration:

```typescript
// Import migrations
import { run as migration001 } from './001-fix-sources-default.js';

// Migration registry - add new migrations here
export const migrations: Migration[] = [
  { version: 1, name: 'fix-sources-default', run: migration001 },
];
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/migrations/ && git commit -m "feat: add migration 001 - fix sources default"`

---

## Task 3: Implement Migration 002 - Normalize duplicate ordering

**Files:**
- Create: `apps/api/src/migrations/002-normalize-duplicate-ordering.ts`
- Modify: `apps/api/src/migrations/index.ts`

**Step 1: Create migration file**

Create `apps/api/src/migrations/002-normalize-duplicate-ordering.ts`:

```typescript
/**
 * Migration 002: Normalize duplicate ordering
 * 
 * The dismissed_duplicates table should have mbid1 < mbid2 to prevent
 * storing both (A,B) and (B,A) as separate dismissals.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Migration-002');

export async function run(prisma: PrismaClient): Promise<void> {
  // Count rows that need swapping
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM dismissed_duplicates WHERE mbid1 > mbid2
  `;
  const swapCount = Number(countResult[0]?.count ?? 0);

  if (swapCount === 0) {
    logger.info('No rows need reordering');
    return;
  }

  logger.info(`Reordering ${swapCount} rows where mbid1 > mbid2`);

  // Swap mbid1 and mbid2 where mbid1 > mbid2
  await prisma.$executeRaw`
    UPDATE dismissed_duplicates 
    SET mbid1 = (@temp := mbid1), mbid1 = mbid2, mbid2 = @temp
    WHERE mbid1 > mbid2
  `;

  // Delete duplicates that may have been created by the swap
  // (if both (A,B) and (B,A) existed, now we have two (A,B) rows)
  const deleteResult = await prisma.$executeRaw`
    DELETE d1 FROM dismissed_duplicates d1
    INNER JOIN dismissed_duplicates d2 
    ON d1.user_id = d2.user_id 
      AND d1.mbid1 = d2.mbid1 
      AND d1.mbid2 = d2.mbid2 
      AND d1.id > d2.id
  `;

  logger.info('Duplicate ordering normalized', { swapped: swapCount, duplicatesRemoved: deleteResult });
}
```

**Step 2: Register migration**

Add to imports and migrations array in `apps/api/src/migrations/index.ts`:

```typescript
import { run as migration002 } from './002-normalize-duplicate-ordering.js';

export const migrations: Migration[] = [
  { version: 1, name: 'fix-sources-default', run: migration001 },
  { version: 2, name: 'normalize-duplicate-ordering', run: migration002 },
];
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/migrations/ && git commit -m "feat: add migration 002 - normalize duplicate ordering"`

---

## Task 4: Implement Migration 003 - Consolidate ai_settings

**Files:**
- Create: `apps/api/src/migrations/003-consolidate-ai-settings.ts`
- Modify: `apps/api/src/migrations/index.ts`

**Step 1: Create migration file**

Create `apps/api/src/migrations/003-consolidate-ai-settings.ts`:

```typescript
/**
 * Migration 003: Consolidate ai_settings
 * 
 * Ensure only one row exists in ai_settings table (id=1).
 * If multiple rows exist, merge them keeping the most recent non-null values.
 */

import { PrismaClient } from '@prisma/client';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('Migration-003');

export async function run(prisma: PrismaClient): Promise<void> {
  const count = await prisma.aISettings.count();

  if (count === 0) {
    logger.info('No ai_settings rows, creating default');
    await prisma.aISettings.create({ data: { id: 1 } });
    return;
  }

  if (count === 1) {
    // Ensure the single row has id=1
    const existing = await prisma.aISettings.findFirst();
    if (existing && existing.id !== 1) {
      logger.info('Moving ai_settings row to id=1');
      await prisma.$executeRaw`UPDATE ai_settings SET id = 1 WHERE id = ${existing.id}`;
    } else {
      logger.info('ai_settings already has single row with id=1');
    }
    return;
  }

  // Multiple rows exist - consolidate
  logger.info(`Consolidating ${count} ai_settings rows into one`);

  // Get all rows ordered by updatedAt desc (most recent first)
  const allSettings = await prisma.aISettings.findMany({
    orderBy: { updatedAt: 'desc' }
  });

  // Merge settings - prefer non-null values from most recent
  const merged = {
    openaiApiKey: allSettings.find(s => s.openaiApiKey)?.openaiApiKey ?? null,
    openaiEnabled: allSettings.find(s => s.openaiEnabled)?.openaiEnabled ?? false,
    openaiStrategy: allSettings.find(s => s.openaiStrategy)?.openaiStrategy ?? 'similar',
    anthropicApiKey: allSettings.find(s => s.anthropicApiKey)?.anthropicApiKey ?? null,
    anthropicEnabled: allSettings.find(s => s.anthropicEnabled)?.anthropicEnabled ?? false,
    anthropicStrategy: allSettings.find(s => s.anthropicStrategy)?.anthropicStrategy ?? 'similar',
  };

  // Delete all rows
  await prisma.$executeRaw`DELETE FROM ai_settings`;

  // Create single merged row with id=1
  await prisma.aISettings.create({
    data: {
      id: 1,
      ...merged,
    }
  });

  logger.info('ai_settings consolidated to single row');
}
```

**Step 2: Register migration**

Add to imports and migrations array in `apps/api/src/migrations/index.ts`:

```typescript
import { run as migration003 } from './003-consolidate-ai-settings.js';

export const migrations: Migration[] = [
  { version: 1, name: 'fix-sources-default', run: migration001 },
  { version: 2, name: 'normalize-duplicate-ordering', run: migration002 },
  { version: 3, name: 'consolidate-ai-settings', run: migration003 },
];
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/migrations/ && git commit -m "feat: add migration 003 - consolidate ai_settings"`

---

## Task 5: Update schema.prisma

**Files:**
- Modify: `apps/api/prisma/schema.prisma`

**Step 1: Fix sources default**

Find and update:

```prisma
# Before
sources        Json      @default("[]")

# After
sources        Json      @default([])
```

**Step 2: Add tokenExpiresAt to Connection**

Add new field to Connection model:

```prisma
model Connection {
  id        Int            @id @default(autoincrement())
  userId    Int?           @map("user_id")
  type      ConnectionType
  name      String         @db.VarChar(100)
  config    Json
  isActive  Boolean        @default(true) @map("is_active")
  lastTest  DateTime?      @map("last_test")
  tokenExpiresAt DateTime? @map("token_expires_at")  // NEW - OAuth token expiry
  createdAt DateTime       @default(now()) @map("created_at")
  updatedAt DateTime       @updatedAt @map("updated_at")
  // ... rest of model
}
```

**Verification:**
- Prisma validates: `cd apps/api && npx prisma validate`
- Commit: `git add apps/api/prisma/schema.prisma && git commit -m "feat: fix sources default, add tokenExpiresAt column"`

---

## Task 6: Update Docker startup commands

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.dev.yml`
- Modify: `Dockerfile.unified`

**Step 1: Update docker-compose.yml**

Find and replace the api command:

```yaml
# Before
command: sh -c "npx prisma db push --accept-data-loss && node dist/index.js"

# After
command: sh -c "npx prisma db push && node dist/scripts/run-data-migrations.js && node dist/index.js"
```

**Step 2: Update docker-compose.dev.yml**

Find and replace the api command:

```yaml
# Before
command: sh -c "cd /app/apps/api && npx prisma generate && npx prisma db push --accept-data-loss && cd /app && npm run dev --workspace=@mixarr/api"

# After
command: sh -c "cd /app/apps/api && npx prisma generate && npx prisma db push && npx tsx scripts/run-data-migrations.ts && cd /app && npm run dev --workspace=@mixarr/api"
```

**Step 3: Update Dockerfile.unified**

Find and replace:

```dockerfile
# Before
npx prisma db push --accept-data-loss || echo "Warning: Database migration had issues, continuing..."

# After
npx prisma db push || { echo "ERROR: Database schema sync failed"; exit 1; }
node dist/scripts/run-data-migrations.js || { echo "ERROR: Data migrations failed"; exit 1; }
```

**Verification:**
- Commit: `git add docker-compose.yml docker-compose.dev.yml Dockerfile.unified && git commit -m "feat: remove --accept-data-loss, add migration script to startup"`

---

## Task 7: Add cleanup jobs to scheduler

**Files:**
- Modify: `apps/api/src/jobs/scheduler.ts`

**Step 1: Add cleanup job functions**

Add these functions to scheduler.ts:

```typescript
/**
 * Cleanup expired sessions
 */
async function cleanupExpiredSessions(): Promise<void> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } }
  });
  if (result.count > 0) {
    logger.info('Cleaned up expired sessions', { count: result.count });
  }
}

/**
 * Cleanup old subscription runs (older than 30 days)
 */
async function cleanupOldRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.subscriptionRun.deleteMany({
    where: { startedAt: { lt: cutoff } }
  });
  if (result.count > 0) {
    logger.info('Cleaned up old subscription runs', { count: result.count });
  }
}

/**
 * Cleanup old subscription results (older than 30 days)
 */
async function cleanupOldResults(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const result = await prisma.subscriptionResult.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  if (result.count > 0) {
    logger.info('Cleaned up old subscription results', { count: result.count });
  }
}

/**
 * Cleanup old log entries (older than 7 days)
 */
async function cleanupOldLogs(): Promise<void> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const result = await prisma.logEntry.deleteMany({
    where: { createdAt: { lt: cutoff } }
  });
  if (result.count > 0) {
    logger.info('Cleaned up old log entries', { count: result.count });
  }
}

/**
 * Mark zombie runs as failed (running > 1 hour)
 */
async function cleanupZombieRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
  const result = await prisma.subscriptionRun.updateMany({
    where: {
      status: 'running',
      startedAt: { lt: cutoff }
    },
    data: {
      status: 'failed',
      errorMessage: 'Job timed out (running > 1 hour)',
      completedAt: new Date()
    }
  });
  if (result.count > 0) {
    logger.warn('Marked zombie runs as failed', { count: result.count });
  }
}
```

**Step 2: Schedule the cleanup jobs**

Add to the scheduler initialization (where other cron jobs are scheduled):

```typescript
// Daily cleanup at 3 AM UTC
cron.schedule('0 3 * * *', async () => {
  logger.info('Running daily cleanup jobs');
  await cleanupExpiredSessions();
  await cleanupOldRuns();
  await cleanupOldResults();
  await cleanupOldLogs();
});

// Hourly zombie run detection
cron.schedule('0 * * * *', async () => {
  await cleanupZombieRuns();
});
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/jobs/scheduler.ts && git commit -m "feat: add cleanup jobs for sessions, runs, results, logs"`

---

## Task 8: Add session invalidation on user deactivate

**Files:**
- Modify: `apps/api/src/routes/admin.ts`

**Step 1: Update user deactivation logic**

Find the PUT /users/:id endpoint and add session cleanup when isActive is set to false:

```typescript
// After updating user, if isActive was set to false, invalidate sessions
if (data.isActive === false) {
  const deletedSessions = await prisma.session.deleteMany({
    where: { userId: user.id }
  });
  logger.info('Invalidated sessions for deactivated user', { 
    userId: user.id, 
    sessionsDeleted: deletedSessions.count 
  });
}
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/routes/admin.ts && git commit -m "feat: invalidate sessions when user is deactivated"`

---

## Task 9: Add orphan subscription handling

**Files:**
- Modify: `apps/api/src/jobs/subscription-worker.ts`

**Step 1: Create helper to check if subscription type requires connection**

```typescript
/**
 * Check if subscription type requires a connection to run
 */
function requiresConnection(type: string): boolean {
  const connectionRequired = [
    'spotify_', 'lastfm_', 'deezer_', 'tidal_', 
    'listenbrainz_', 'tautulli_', 'jellyfin_', 'discogs_'
  ];
  return connectionRequired.some(prefix => type.startsWith(prefix));
}
```

**Step 2: Add orphan check before running subscription**

At the start of subscription processing, add:

```typescript
// Check for orphaned subscription (connection deleted)
if (requiresConnection(subscription.type) && !subscription.connection) {
  logger.warn('Subscription has no connection - deactivating', { 
    subscriptionId: subscription.id,
    type: subscription.type 
  });
  
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { 
      isActive: false, 
      lastRunStatus: 'error_no_connection' 
    }
  });
  
  return; // Skip this run
}
```

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/jobs/subscription-worker.ts && git commit -m "feat: handle orphaned subscriptions gracefully"`

---

## Task 10: Add AI settings singleton helpers

**Files:**
- Modify: `apps/api/src/services/ai.ts`

**Step 1: Add singleton helper functions**

```typescript
/**
 * Get AI settings (singleton at id=1)
 */
export async function getAISettings(): Promise<AISettings> {
  return prisma.aISettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {}
  });
}

/**
 * Update AI settings (singleton at id=1)
 */
export async function updateAISettings(data: Partial<Omit<AISettings, 'id' | 'createdAt' | 'updatedAt'>>): Promise<AISettings> {
  return prisma.aISettings.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data
  });
}
```

**Step 2: Update existing code to use helpers**

Replace direct prisma.aISettings calls with getAISettings() and updateAISettings().

**Verification:**
- TypeScript compiles
- Commit: `git add apps/api/src/services/ai.ts && git commit -m "feat: add AI settings singleton helpers"`

---

## Task 11: Add migration tests

**Files:**
- Create: `apps/api/tests/migrations/migration-runner.test.ts`

**Step 1: Create migration infrastructure tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Migration Runner', () => {
  it('skips migrations when current version matches latest', async () => {
    // Test that no migrations run when version is up to date
  });

  it('runs pending migrations in order', async () => {
    // Test that migrations run sequentially by version
  });

  it('stops on migration failure', async () => {
    // Test that a failing migration stops the process
  });

  it('updates version after each successful migration', async () => {
    // Test that version is incremented properly
  });
});
```

**Verification:**
- Tests pass
- Commit: `git add apps/api/tests/migrations/ && git commit -m "test: add migration infrastructure tests"`

---

## Task 12: Final verification

**Commands:**
```bash
cd apps/api && npx tsc --noEmit
cd apps/api && npm test
```

**Checklist:**
- [ ] TypeScript compiles without errors
- [ ] All tests pass (except pre-existing SSO failures)
- [ ] Docker commands updated in all files
- [ ] Schema changes applied
- [ ] Migrations registered in correct order
- [ ] Cleanup jobs scheduled

**Final commit:**
```bash
git add -A && git commit -m "feat: complete database schema cleanup implementation"
```
