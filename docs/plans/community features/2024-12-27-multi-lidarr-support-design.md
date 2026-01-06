# Multi-Lidarr Support Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 3 - Power Users  
**Effort:** Medium  

## Problem Statement

Power users run multiple Lidarr instances for different purposes:
- Lossless library (FLAC) vs lossy library (MP3)
- Personal collection vs family-shared library
- Different quality profiles for different genres
- Separate instances for different storage locations

Current Mixarr assumes one Lidarr connection per user (or one global).

## Solution

Extend Mixarr to support multiple Lidarr connections:
1. Allow multiple Lidarr connections per user
2. Specify target Lidarr per subscription
3. Choose Lidarr when adding from review queue
4. Cross-instance duplicate detection

## Design

### Multiple Connections

Current schema allows multiple connections of same type:

```prisma
model Connection {
  id        Int      @id @default(autoincrement())
  userId    Int?     // null = global
  type      ConnectionType
  name      String   // Already supports naming
  config    Json
  isActive  Boolean  @default(true)
  // ...
}
```

Currently, code assumes "first active Lidarr connection" everywhere. Need to support explicit selection.

### Named Lidarr Connections

```typescript
// Example connections
[
  { name: 'Lidarr (FLAC)', type: 'lidarr', config: { url: '...', apiKey: '...' } },
  { name: 'Lidarr (MP3)',  type: 'lidarr', config: { url: '...', apiKey: '...' } },
]
```

### Subscription Target

Add `targetConnectionId` to subscriptions:

```prisma
model Subscription {
  // existing fields...
  
  targetConnectionId Int?  // NEW: Which Lidarr to add artists to
  targetConnection   Connection? @relation(fields: [targetConnectionId], references: [id])
}
```

If null, use default Lidarr connection.

### Subscription Form Update

```
┌──────────────────────────────────────────────────────────────┐
│ Create Subscription                                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Name: [My Discovery Subscription        ]                   │
│                                                              │
│  Type: [Spotify - Discover Weekly  ▼]                        │
│                                                              │
│  Result Handling: [Add to review queue ▼]                    │
│                                                              │
│  Target Lidarr: [Lidarr (FLAC)      ▼]                      │
│                 ├─ Lidarr (FLAC)                             │
│                 └─ Lidarr (MP3)                              │
│                                                              │
│                               [Cancel]  [Create]             │
└──────────────────────────────────────────────────────────────┘
```

### Review Queue Enhancement

When adding from review queue, let user choose target:

```
┌──────────────────────────────────────────────────────────────┐
│ Add Artist to Lidarr                                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Artist: The Midnight                                        │
│                                                              │
│  Target Lidarr:                                              │
│  ○ Lidarr (FLAC) - /music/flac/                              │
│  ● Lidarr (MP3)  - /music/mp3/                               │
│                                                              │
│  Quality Profile: [Any ▼]                                    │
│  Metadata Profile: [Standard ▼]                              │
│                                                              │
│                               [Cancel]  [Add]                │
└──────────────────────────────────────────────────────────────┘
```

### Cross-Instance Duplicate Check

When adding artist, check if exists in ANY connected Lidarr:

```typescript
async function checkCrossInstanceDuplicates(
  mbid: string,
  lidarrConnections: Connection[]
): Promise<DuplicateCheck> {
  const existsIn: string[] = [];
  
  for (const conn of lidarrConnections) {
    const lidarr = new LidarrService(conn.config);
    if (await lidarr.artistExists(mbid)) {
      existsIn.push(conn.name);
    }
  }
  
  return {
    isDuplicate: existsIn.length > 0,
    existsIn,
  };
}
```

Display in UI:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚠️ "The Midnight" already exists in:                        │
│    • Lidarr (FLAC)                                          │
│                                                             │
│ Add to "Lidarr (MP3)" anyway?                               │
│                                                             │
│                        [Cancel]  [Add Anyway]               │
└─────────────────────────────────────────────────────────────┘
```

### API Changes

#### Subscription Creation

```typescript
// POST /api/subscriptions
interface CreateSubscriptionRequest {
  // existing fields...
  targetConnectionId?: number;  // NEW
}
```

#### Review Queue Actions

```typescript
// POST /api/review/:id/add
interface AddToLidarrRequest {
  connectionId: number;  // Required when multiple Lidarr exist
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
}
```

### Default Lidarr Setting

User preference for default Lidarr:

```prisma
model UserSettings {
  // existing...
  defaultLidarrConnectionId Int?
}
```

### Connection Selection Logic

```typescript
async function selectLidarrConnection(
  userId: number,
  explicitConnectionId?: number
): Promise<Connection> {
  // 1. Use explicit if provided
  if (explicitConnectionId) {
    const conn = await prisma.connection.findUnique({
      where: { id: explicitConnectionId },
    });
    if (conn && conn.type === 'lidarr') return conn;
  }
  
  // 2. Use user's default
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    include: { defaultLidarrConnection: true },
  });
  if (settings?.defaultLidarrConnection) {
    return settings.defaultLidarrConnection;
  }
  
  // 3. Fall back to first active Lidarr
  return prisma.connection.findFirst({
    where: {
      type: 'lidarr',
      isActive: true,
      OR: [{ userId }, { userId: null }],
    },
  });
}
```

### Subscription Worker Update

```typescript
// In subscription-worker.ts
async function processSubscription(job: Job<SubscriptionJobData>): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: job.data.subscriptionId },
    include: { targetConnection: true },
  });
  
  // Use target connection if specified
  const lidarrConn = subscription.targetConnection 
    || await selectLidarrConnection(subscription.userId);
  
  if (!lidarrConn) throw new Error('No Lidarr connection found');
  
  const lidarr = new LidarrService(lidarrConn.config);
  // ... rest of processing
}
```

### Library Health Per Instance

Library Health Dashboard should support selecting which Lidarr to analyze:

```
┌──────────────────────────────────────────────────────────────┐
│ Library Health                                               │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Select Lidarr: [Lidarr (FLAC) ▼]                           │
│                                                              │
│  Health Score: 82%                                           │
│  ...                                                         │
└──────────────────────────────────────────────────────────────┘
```

## Migration

Existing single-Lidarr users unaffected:
- Subscriptions without `targetConnectionId` use default logic
- Review queue actions without `connectionId` use default
- No breaking changes

## Implementation Checklist

1. [ ] Add `targetConnectionId` to Subscription schema
2. [ ] Add `defaultLidarrConnectionId` to UserSettings
3. [ ] Update subscription form with Lidarr selector
4. [ ] Update review queue add action with connection choice
5. [ ] Implement cross-instance duplicate detection
6. [ ] Update subscription worker to use target connection
7. [ ] Update Library Health to support instance selection
8. [ ] Add tests for multi-instance scenarios

## Success Metrics

- Power users can manage multiple Lidarr instances
- No regression for single-instance users
- Clear UI for instance selection
- Cross-instance duplicates detected and warned
