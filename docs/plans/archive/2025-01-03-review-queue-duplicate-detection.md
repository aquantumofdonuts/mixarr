# Implementation Task: Review Queue Duplicate Detection

**Date**: 2025-01-03  
**Gap Identified In**: `docs/plans/archive/2024-12-23-community-features-implementation.md`  
**Status**: Not Implemented

## Problem Statement

When artists are added to the Review Queue from multiple sources (imports, subscriptions), duplicate entries can be created. The design specified "Smart Duplicate Detection" but it's not implemented when creating `ReviewItem` records.

**Current behavior**:
- `import-worker.ts` creates `ReviewItem` without checking for existing items
- `subscription-worker.ts` does the same
- User can have multiple identical pending items for the same artist

**Expected behavior**:
- Before creating a `ReviewItem`, check if one already exists with same artist
- Match by: MBID (exact match) > SpotifyId > Normalized artist name
- If exists: Update sources, don't create duplicate

## Current Code Locations

### Import Worker (`apps/api/src/jobs/import-worker.ts`, lines 175-187)

```typescript
// Add to review queue
for (const item of enrichedItems) {
  await prisma.reviewItem.create({
    data: {
      userId,
      artistName: item.artistName,
      albumName: item.albumName,
      releaseYear: item.releaseYear,
      spotifyId: item.spotifyId,
      source: `import-${importSource.type}`,
      status: 'pending',
    },
  });
}
```

### Subscription Worker (`apps/api/src/jobs/subscription-worker.ts`, line 1356)

```typescript
await prisma.reviewItem.create({
  data: {
    userId,
    artistName: artist.name,
    mbid,
    source: `subscription:${subscription.name}`,
    status: 'pending',
  },
});
```

## Required Changes

### Task 1: Create `findOrCreateReviewItem` utility (5 min)

**File**: Create `apps/api/src/utils/review-queue.ts`

```typescript
import { prisma } from '../lib/prisma.js';
import { normalizeArtistName } from './deduplication.js';

export interface ReviewItemInput {
  userId: string;
  artistName: string;
  mbid?: string;
  spotifyId?: string;
  albumName?: string;
  releaseYear?: number;
  source: string;
}

/**
 * Find existing review item or create new one
 * Matches by: MBID > SpotifyId > Normalized artist name
 * If found: appends source to existing item's sources
 * If not found: creates new item
 */
export async function findOrCreateReviewItem(input: ReviewItemInput): Promise<{ id: string; created: boolean }> {
  const { userId, artistName, mbid, spotifyId, source } = input;
  
  // Try to find existing by MBID first (most reliable)
  if (mbid) {
    const existing = await prisma.reviewItem.findFirst({
      where: { userId, mbid, status: 'pending' },
    });
    if (existing) {
      // Update sources if not already included
      if (!existing.source.includes(source)) {
        await prisma.reviewItem.update({
          where: { id: existing.id },
          data: { source: `${existing.source}, ${source}` },
        });
      }
      return { id: existing.id, created: false };
    }
  }
  
  // Try SpotifyId
  if (spotifyId) {
    const existing = await prisma.reviewItem.findFirst({
      where: { userId, spotifyId, status: 'pending' },
    });
    if (existing) {
      if (!existing.source.includes(source)) {
        await prisma.reviewItem.update({
          where: { id: existing.id },
          data: { 
            source: `${existing.source}, ${source}`,
            mbid: existing.mbid || mbid, // Fill in MBID if we have it now
          },
        });
      }
      return { id: existing.id, created: false };
    }
  }
  
  // Try normalized name match
  const normalizedName = normalizeArtistName(artistName);
  const pending = await prisma.reviewItem.findMany({
    where: { userId, status: 'pending' },
  });
  
  for (const item of pending) {
    if (normalizeArtistName(item.artistName) === normalizedName) {
      if (!item.source.includes(source)) {
        await prisma.reviewItem.update({
          where: { id: item.id },
          data: { 
            source: `${item.source}, ${source}`,
            mbid: item.mbid || mbid,
            spotifyId: item.spotifyId || spotifyId,
          },
        });
      }
      return { id: item.id, created: false };
    }
  }
  
  // No match - create new
  const created = await prisma.reviewItem.create({
    data: {
      userId,
      artistName,
      mbid,
      spotifyId,
      albumName: input.albumName,
      releaseYear: input.releaseYear,
      source,
      status: 'pending',
    },
  });
  
  return { id: created.id, created: true };
}
```

### Task 2: Update import-worker.ts (3 min)

**File**: `apps/api/src/jobs/import-worker.ts`

Add import at top:
```typescript
import { findOrCreateReviewItem } from '../utils/review-queue.js';
```

Replace lines 175-187:
```typescript
// Add to review queue (with deduplication)
let queued = 0;
let deduplicated = 0;

for (const item of enrichedItems) {
  const result = await findOrCreateReviewItem({
    userId,
    artistName: item.artistName,
    spotifyId: item.spotifyId,
    albumName: item.albumName,
    releaseYear: item.releaseYear,
    source: `import-${importSource.type}`,
  });
  
  if (result.created) {
    queued++;
  } else {
    deduplicated++;
  }
}

await job.updateProgress({
  phase: 'complete',
  queued,
  deduplicated,
});
```

### Task 3: Update subscription-worker.ts (3 min)

**File**: `apps/api/src/jobs/subscription-worker.ts`

Add import at top:
```typescript
import { findOrCreateReviewItem } from '../utils/review-queue.js';
```

Replace line 1356:
```typescript
const reviewResult = await findOrCreateReviewItem({
  userId,
  artistName: artist.name,
  mbid,
  source: `subscription:${subscription.name}`,
});

// Only count as queued if actually created
if (reviewResult.created) {
  // ... existing subscriptionResult creation
}
```

### Task 4: Add tests (5 min)

**File**: Create `apps/api/tests/utils/review-queue.test.ts`

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findOrCreateReviewItem } from '../../src/utils/review-queue.js';
import { prisma } from '../../src/lib/prisma.js';

vi.mock('../../src/lib/prisma.js');

describe('findOrCreateReviewItem', () => {
  const mockPrisma = prisma as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds existing item by MBID and updates sources', async () => {
    mockPrisma.reviewItem.findFirst.mockResolvedValueOnce({
      id: 'existing-1',
      mbid: 'mbid-123',
      source: 'import-spotify',
    });
    mockPrisma.reviewItem.update.mockResolvedValue({});

    const result = await findOrCreateReviewItem({
      userId: 'user-1',
      artistName: 'Test Artist',
      mbid: 'mbid-123',
      source: 'subscription:weekly',
    });

    expect(result.id).toBe('existing-1');
    expect(result.created).toBe(false);
    expect(mockPrisma.reviewItem.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: { source: 'import-spotify, subscription:weekly' },
    });
  });

  it('creates new item when no match found', async () => {
    mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
    mockPrisma.reviewItem.findMany.mockResolvedValue([]);
    mockPrisma.reviewItem.create.mockResolvedValue({ id: 'new-1' });

    const result = await findOrCreateReviewItem({
      userId: 'user-1',
      artistName: 'New Artist',
      source: 'import-spotify',
    });

    expect(result.id).toBe('new-1');
    expect(result.created).toBe(true);
  });

  it('matches by normalized artist name', async () => {
    mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
    mockPrisma.reviewItem.findMany.mockResolvedValue([
      { id: 'name-match', artistName: 'The Beatles', source: 'import-1' },
    ]);
    mockPrisma.reviewItem.update.mockResolvedValue({});

    const result = await findOrCreateReviewItem({
      userId: 'user-1',
      artistName: 'Beatles',  // Will normalize to match "The Beatles"
      source: 'subscription:weekly',
    });

    expect(result.id).toBe('name-match');
    expect(result.created).toBe(false);
  });
});
```

## Verification Steps

1. Run `npx vitest run tests/utils/review-queue.test.ts` - all tests pass
2. Run `npm run build` - compiles without errors
3. Create a subscription that adds "The Beatles" to review queue
4. Import from Spotify with "Beatles" - should NOT create duplicate
5. Check review queue - single item with "import-spotify, subscription:..." in source

## Estimated Time

- Task 1: 5 minutes (new utility file)
- Task 2: 3 minutes (update import-worker)
- Task 3: 3 minutes (update subscription-worker)
- Task 4: 5 minutes (unit tests)
- Testing: 5 minutes

**Total: ~20 minutes**
