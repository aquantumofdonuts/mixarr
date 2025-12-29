# Job Timeout Design

**Date:** 2025-12-29  
**Status:** Approved  
**Priority:** Medium (Reliability)

## Problem

Subscription and import workers run indefinitely. If an external API hangs or a job gets stuck, it blocks the queue forever.

## Solution

Add 15-minute timeout to all background jobs using BullMQ's native `timeout` option. On persistent timeout (after 1 retry), notify admins.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Timeout duration | 15 minutes | Accommodates AI and large playlist processing |
| Retry policy | 1 retry then notify | Give transient issues one more shot |
| Notification target | Admins only | Users don't need to know about infrastructure issues |
| Import timeout | Same 15 min | Keep it consistent |
| Implementation | BullMQ native timeout | Simple, built-in, no custom AbortController needed |

## Implementation

### File 1: `apps/api/src/jobs/queue.ts`

Add timeout to default job options:

```typescript
// Subscription queue
defaultJobOptions: {
  attempts: 2,  // 1 original + 1 retry
  timeout: 15 * 60 * 1000,  // 15 minutes
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 50 },
}

// Import queue - same pattern
```

### File 2: `apps/api/src/jobs/subscription-worker.ts`

Update `failed` event handler:

```typescript
subscriptionWorker.on('failed', async (job, error) => {
  const isTimeout = error.message.includes('timed out');
  const isLastAttempt = job?.attemptsMade >= 2;
  
  if (isTimeout && isLastAttempt) {
    await notificationService.sendToAdmins('job.timeout', {
      jobType: 'subscription',
      subscriptionId: job?.data.subscriptionId,
      error: error.message,
    });
  }
  console.error(`Subscription job ${job?.id} failed:`, error);
});
```

### File 3: `apps/api/src/jobs/import-worker.ts`

Same pattern for import worker `failed` handler.

### File 4: `apps/api/src/services/notifications.ts`

Add `sendToAdmins` method:

```typescript
async sendToAdmins(event: NotificationEvent, payload: Record<string, any>): Promise<void> {
  // Find all admin users
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
  });
  
  // Send to each admin's notification channels
  for (const admin of admins) {
    await this.send(admin.id, event, payload);
  }
}
```

Add `job.timeout` event type and Discord/webhook formatting.

## Testing

### Unit Tests
1. Queue timeout configuration is correctly set
2. Worker `failed` handler detects timeout errors  
3. `sendToAdmins` finds and notifies all admin channels

### Manual Integration Test
- Create subscription that sleeps > 15 min
- Verify timeout and admin notification

## Tasks

1. Add timeout to subscription queue options
2. Add timeout to import queue options
3. Update subscription worker failed handler
4. Update import worker failed handler
5. Add `sendToAdmins` method to notifications service
6. Add `job.timeout` event type and formatting
7. Write unit tests
8. Manual verification
