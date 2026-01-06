# Notification Integrations Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 3 - Convenience  
**Effort:** Low  

## Problem Statement

Users want to be notified about Mixarr events without constantly checking the UI:
- New artists discovered by subscriptions
- Review queue items pending
- Subscription run completed/failed
- Artist added to Lidarr

Popular notification tools in the self-hosted community:
- Discord webhooks
- Telegram bots
- Pushover
- Gotify
- Ntfy
- Email

## Solution

Add notification integrations with configurable triggers:
1. Discord webhook (most requested)
2. Generic webhook (for other services)
3. Optional: Native integrations (Telegram, Pushover)

## Design

### Notification Events

| Event | Description | Payload |
|-------|-------------|---------|
| `subscription.completed` | Subscription run finished | Subscription name, artists found |
| `subscription.failed` | Subscription run failed | Error message |
| `review.pending` | New items in review queue | Count, sources |
| `artist.added` | Artist added to Lidarr | Artist name |
| `artist.failed` | Artist add failed | Error message |
| `enrichment.completed` | Metadata enrichment done | Artist count |

### Database Schema

```prisma
model NotificationChannel {
  id          Int      @id @default(autoincrement())
  userId      Int
  
  type        NotificationType
  name        String           // "My Discord"
  config      Json             // Channel-specific config
  isActive    Boolean @default(true)
  
  // Which events to send
  events      String[]         // ['subscription.completed', 'review.pending']
  
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  
  user        User     @relation(fields: [userId], references: [id])
}

enum NotificationType {
  discord
  webhook
  telegram
  pushover
  email
}
```

### Channel Configurations

```typescript
interface DiscordConfig {
  webhookUrl: string;
  username?: string;  // Bot display name
  avatarUrl?: string;
}

interface WebhookConfig {
  url: string;
  method: 'POST' | 'PUT';
  headers?: Record<string, string>;
  template?: string;  // Custom JSON template
}

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface PushoverConfig {
  userKey: string;
  appToken: string;
}

interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  username: string;
  password: string;
  from: string;
  to: string;
}
```

### Notification Service

**File:** `apps/api/src/services/notifications.ts`

```typescript
export class NotificationService {
  async send(
    userId: number,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    // Get active channels for this user and event
    const channels = await prisma.notificationChannel.findMany({
      where: {
        userId,
        isActive: true,
        events: { has: event },
      },
    });
    
    for (const channel of channels) {
      try {
        await this.sendToChannel(channel, event, payload);
      } catch (error) {
        console.error(`Notification failed for channel ${channel.id}:`, error);
      }
    }
  }
  
  private async sendToChannel(
    channel: NotificationChannel,
    event: NotificationEvent,
    payload: Record<string, any>
  ): Promise<void> {
    switch (channel.type) {
      case 'discord':
        return this.sendDiscord(channel.config, event, payload);
      case 'webhook':
        return this.sendWebhook(channel.config, event, payload);
      case 'telegram':
        return this.sendTelegram(channel.config, event, payload);
      // etc
    }
  }
}
```

### Discord Integration

```typescript
async sendDiscord(
  config: DiscordConfig,
  event: NotificationEvent,
  payload: Record<string, any>
): Promise<void> {
  const embed = this.formatDiscordEmbed(event, payload);
  
  await fetch(config.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: config.username || 'Mixarr',
      avatar_url: config.avatarUrl,
      embeds: [embed],
    }),
  });
}

formatDiscordEmbed(event: string, payload: any): DiscordEmbed {
  switch (event) {
    case 'subscription.completed':
      return {
        title: '✅ Subscription Complete',
        description: `**${payload.subscriptionName}** finished`,
        fields: [
          { name: 'Artists Found', value: String(payload.artistCount), inline: true },
          { name: 'Added to Queue', value: String(payload.queuedCount), inline: true },
        ],
        color: 0x00ff00,
        timestamp: new Date().toISOString(),
      };
      
    case 'review.pending':
      return {
        title: '📋 Review Queue',
        description: `${payload.count} artists pending review`,
        color: 0xffaa00,
        timestamp: new Date().toISOString(),
      };
      
    case 'artist.added':
      return {
        title: '🎵 Artist Added',
        description: `**${payload.artistName}** added to Lidarr`,
        color: 0x00aaff,
        thumbnail: payload.imageUrl ? { url: payload.imageUrl } : undefined,
        timestamp: new Date().toISOString(),
      };
      
    // etc
  }
}
```

### Generic Webhook

```typescript
async sendWebhook(
  config: WebhookConfig,
  event: NotificationEvent,
  payload: Record<string, any>
): Promise<void> {
  let body: string;
  
  if (config.template) {
    // Custom template with placeholder replacement
    body = config.template
      .replace('{{event}}', event)
      .replace('{{payload}}', JSON.stringify(payload));
  } else {
    // Default format
    body = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  }
  
  await fetch(config.url, {
    method: config.method || 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...config.headers,
    },
    body,
  });
}
```

### Integration Points

Add notification calls to existing code:

```typescript
// In subscription-worker.ts
try {
  // ... process subscription
  
  await notificationService.send(userId, 'subscription.completed', {
    subscriptionName: subscription.name,
    artistCount: artists.length,
    queuedCount: queued,
  });
} catch (error) {
  await notificationService.send(userId, 'subscription.failed', {
    subscriptionName: subscription.name,
    error: error.message,
  });
}
```

```typescript
// In review queue add route
await notificationService.send(req.user.id, 'artist.added', {
  artistName: result.artistName,
  imageUrl: result.imageUrl,
});
```

### API Routes

**File:** `apps/api/src/routes/notifications.ts`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/notifications/channels` | GET | List notification channels |
| `/api/notifications/channels` | POST | Create channel |
| `/api/notifications/channels/:id` | PUT | Update channel |
| `/api/notifications/channels/:id` | DELETE | Delete channel |
| `/api/notifications/channels/:id/test` | POST | Send test notification |

### Frontend UI

**Settings > Notifications Page:**

```
┌──────────────────────────────────────────────────────────────┐
│ Notification Channels                         [Add Channel]  │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 🎮 My Discord                                 [Active] │  │
│  │    Type: Discord Webhook                               │  │
│  │    Events: Subscription Complete, Artist Added          │  │
│  │                                                        │  │
│  │    [Edit]  [Test]  [Delete]                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 📱 Telegram                              [Inactive]    │  │
│  │    Type: Telegram Bot                                  │  │
│  │    Events: Subscription Failed                          │  │
│  │                                                        │  │
│  │    [Edit]  [Test]  [Delete]                            │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Add Channel Modal:**

```
┌──────────────────────────────────────────────────────────────┐
│ Add Notification Channel                                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Channel Type: [Discord ▼]                                   │
│                                                              │
│  Name: [My Discord Server         ]                          │
│                                                              │
│  Webhook URL:                                                │
│  [https://discord.com/api/webhooks/...                    ]  │
│                                                              │
│  Events to notify:                                           │
│  ☑ Subscription completed                                    │
│  ☑ Subscription failed                                       │
│  ☐ Review queue has pending items                            │
│  ☑ Artist added to Lidarr                                    │
│  ☐ Artist add failed                                         │
│  ☐ Metadata enrichment completed                             │
│                                                              │
│                        [Cancel]  [Test]  [Save]              │
└──────────────────────────────────────────────────────────────┘
```

## Implementation Checklist

1. [ ] Create NotificationChannel schema
2. [ ] Implement NotificationService with Discord support
3. [ ] Add generic webhook support
4. [ ] Create API routes for channel management
5. [ ] Integrate notification calls into existing code
6. [ ] Build settings UI for channel management
7. [ ] Optional: Add Telegram, Pushover integrations
8. [ ] Write tests

## Future Extensions

- Daily/weekly digest notifications
- Quiet hours setting
- Per-subscription notification override
- Notification history/log

## Success Metrics

- Users receive Discord notifications within 30 seconds of events
- Test notification feature works reliably
- Clear configuration UI
