# Mobile PWA Improvements Design

**Date:** 2024-12-27  
**Status:** Draft  
**Priority:** Tier 3 - Polish  
**Effort:** Medium  

## Problem Statement

Mixarr has PWA support but it's basic. Mobile users want:
- Offline access to review queue
- Push notifications for pending reviews
- Quick-add from mobile
- Better mobile navigation/UX

## Current State

Existing PWA features:
- Installable (manifest.json)
- Basic service worker
- Responsive design

Missing:
- Offline data caching
- Push notifications
- Background sync
- Mobile-optimized actions

## Solution

Enhance PWA capabilities:
1. Offline review queue viewing
2. Push notifications for key events
3. Background sync for adds when back online
4. Mobile-optimized quick actions

## Design

### Offline Review Queue

#### Service Worker Caching

```typescript
// apps/web/public/sw.js

const CACHE_NAME = 'mixarr-v1';
const OFFLINE_URLS = [
  '/',
  '/review',
  '/manifest.json',
  '/icons/icon-192x192.png',
];

// Cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(OFFLINE_URLS);
    })
  );
});

// Network-first with cache fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Clone and cache successful responses
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, clone);
        });
        return response;
      })
      .catch(() => {
        // Fallback to cache
        return caches.match(event.request);
      })
  );
});
```

#### IndexedDB for Review Queue

```typescript
// apps/web/src/lib/offline-store.ts

import { openDB } from 'idb';

const DB_NAME = 'mixarr-offline';
const REVIEW_STORE = 'review-items';

export async function initDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(REVIEW_STORE, { keyPath: 'id' });
    },
  });
}

export async function cacheReviewItems(items: ReviewItem[]) {
  const db = await initDB();
  const tx = db.transaction(REVIEW_STORE, 'readwrite');
  
  for (const item of items) {
    await tx.store.put(item);
  }
  
  await tx.done;
}

export async function getOfflineReviewItems(): Promise<ReviewItem[]> {
  const db = await initDB();
  return db.getAll(REVIEW_STORE);
}
```

#### Offline-Aware Review Page

```typescript
// apps/web/src/app/review/page.tsx

'use client';

import { useEffect, useState } from 'react';
import { getOfflineReviewItems, cacheReviewItems } from '@/lib/offline-store';

export default function ReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [isOffline, setIsOffline] = useState(false);
  
  useEffect(() => {
    // Check online status
    setIsOffline(!navigator.onLine);
    
    window.addEventListener('online', () => setIsOffline(false));
    window.addEventListener('offline', () => setIsOffline(true));
    
    // Fetch data
    if (navigator.onLine) {
      fetch('/api/review')
        .then(r => r.json())
        .then(data => {
          setItems(data.items);
          cacheReviewItems(data.items); // Cache for offline
        });
    } else {
      getOfflineReviewItems().then(setItems);
    }
  }, []);
  
  return (
    <div>
      {isOffline && (
        <div className="bg-yellow-500 p-2 text-center">
          You're offline. Showing cached data.
        </div>
      )}
      {/* Rest of UI */}
    </div>
  );
}
```

### Push Notifications

#### Web Push Setup

**Backend: Generate VAPID keys**

```typescript
// One-time setup
const webpush = require('web-push');
const vapidKeys = webpush.generateVAPIDKeys();
// Store in environment variables
```

**Backend: Push subscription storage**

```prisma
model PushSubscription {
  id          Int      @id @default(autoincrement())
  userId      Int
  endpoint    String
  p256dh      String
  auth        String
  createdAt   DateTime @default(now())
  
  user        User     @relation(fields: [userId], references: [id])
  
  @@unique([userId, endpoint])
}
```

**Frontend: Request permission and subscribe**

```typescript
// apps/web/src/lib/push-notifications.ts

export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return null;
  }
  
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;
  
  const registration = await navigator.serviceWorker.ready;
  
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
  });
  
  // Send to backend
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });
  
  return subscription;
}
```

**Service Worker: Handle push events**

```typescript
// In service worker
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    data: data.url,
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  if (event.action === 'open' && event.notification.data) {
    event.waitUntil(
      clients.openWindow(event.notification.data)
    );
  }
});
```

**Backend: Send push notification**

```typescript
// apps/api/src/services/push-notifications.ts

import webpush from 'web-push';

webpush.setVapidDetails(
  'mailto:admin@mixarr.example.com',
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function sendPushNotification(
  userId: number,
  title: string,
  body: string,
  url?: string
): Promise<void> {
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });
  
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify({ title, body, url })
      );
    } catch (error) {
      if (error.statusCode === 410) {
        // Subscription expired, remove it
        await prisma.pushSubscription.delete({ where: { id: sub.id } });
      }
    }
  }
}
```

### Background Sync

Queue actions when offline, sync when back online:

```typescript
// Service worker
self.addEventListener('sync', (event) => {
  if (event.tag === 'add-artist') {
    event.waitUntil(syncPendingAdds());
  }
});

async function syncPendingAdds() {
  const db = await openDB('mixarr-offline', 1);
  const pending = await db.getAll('pending-adds');
  
  for (const add of pending) {
    try {
      await fetch('/api/review/' + add.id + '/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(add.data),
      });
      await db.delete('pending-adds', add.id);
    } catch (error) {
      // Will retry on next sync
    }
  }
}
```

```typescript
// Frontend: Queue add when offline
async function addArtist(id: number, options: AddOptions) {
  if (navigator.onLine) {
    return fetch(`/api/review/${id}/add`, { /* ... */ });
  }
  
  // Queue for background sync
  const db = await openDB('mixarr-offline', 1);
  await db.add('pending-adds', { id, data: options, timestamp: Date.now() });
  
  // Register sync
  const registration = await navigator.serviceWorker.ready;
  await registration.sync.register('add-artist');
  
  return { queued: true };
}
```

### Mobile-Optimized Quick Actions

#### Swipe Actions on Review Items

```tsx
// apps/web/src/components/SwipeableReviewItem.tsx

import { useSwipeable } from 'react-swipeable';

export function SwipeableReviewItem({ item, onAdd, onDismiss }) {
  const handlers = useSwipeable({
    onSwipedLeft: () => onDismiss(item.id),
    onSwipedRight: () => onAdd(item.id),
    trackMouse: false,
    trackTouch: true,
  });
  
  return (
    <div {...handlers} className="relative overflow-hidden">
      <div className="absolute inset-y-0 left-0 bg-green-500 flex items-center px-4">
        <PlusIcon className="h-6 w-6 text-white" />
      </div>
      <div className="absolute inset-y-0 right-0 bg-red-500 flex items-center px-4">
        <XIcon className="h-6 w-6 text-white" />
      </div>
      <div className="relative bg-background">
        {/* Item content */}
      </div>
    </div>
  );
}
```

#### Bottom Navigation on Mobile

```tsx
// apps/web/src/components/MobileNav.tsx

export function MobileNav() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background border-t md:hidden">
      <div className="flex justify-around py-2">
        <NavLink href="/dashboard" icon={<HomeIcon />} label="Home" />
        <NavLink href="/review" icon={<ListIcon />} label="Review" badge={pendingCount} />
        <NavLink href="/subscriptions" icon={<CalendarIcon />} label="Subs" />
        <NavLink href="/discover" icon={<CompassIcon />} label="Discover" />
      </div>
    </nav>
  );
}
```

### Manifest Enhancements

```json
// apps/web/public/manifest.json
{
  "name": "Mixarr",
  "short_name": "Mixarr",
  "description": "Music discovery for Lidarr",
  "start_url": "/",
  "display": "standalone",
  "theme_color": "#1a1a2e",
  "background_color": "#1a1a2e",
  "icons": [
    { "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512x512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Review Queue",
      "short_name": "Review",
      "url": "/review",
      "icons": [{ "src": "/icons/review-96x96.png", "sizes": "96x96" }]
    },
    {
      "name": "Discover",
      "short_name": "Discover", 
      "url": "/discover",
      "icons": [{ "src": "/icons/discover-96x96.png", "sizes": "96x96" }]
    }
  ]
}
```

## Implementation Checklist

1. [ ] Enhance service worker with smart caching
2. [ ] Add IndexedDB for offline review queue
3. [ ] Implement offline-aware review page
4. [ ] Set up VAPID keys for push notifications
5. [ ] Create push subscription API
6. [ ] Integrate push sends into notification service
7. [ ] Add background sync for offline actions
8. [ ] Build swipeable review items for mobile
9. [ ] Add bottom navigation for mobile
10. [ ] Create app shortcuts in manifest
11. [ ] Design maskable icon
12. [ ] Test on iOS and Android

## Platform Considerations

- **iOS Safari:** Limited service worker support, no background sync
- **Android Chrome:** Full PWA support including background sync
- **Desktop:** PWA works but less critical

## Success Metrics

- Users can view review queue while offline
- Push notifications arrive within 1 minute of events
- Offline adds sync successfully when back online
- Mobile swipe gestures are intuitive
