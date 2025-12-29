const CACHE_NAME = 'mixarr-v2';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/queue',
  '/library',
  '/subscriptions',
  '/search',
  '/dashboard',
];

// IndexedDB for pending actions
const DB_NAME = 'mixarr-offline';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

// Install service worker and cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('mixarr-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Network-first strategy for API calls, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip external requests
  if (url.origin !== self.location.origin) {
    return;
  }

  // API calls - network first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful API responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Return cached response if network fails
          return caches.match(request);
        })
    );
    return;
  }

  // Static assets - stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        // Update cache with new response
        if (networkResponse.ok) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });

      return cachedResponse || fetchPromise;
    })
  );
});

// Handle push notifications
self.addEventListener('push', (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const options = {
    body: data.body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/',
    },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // Focus existing window if available
      for (const client of clients) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});

// Background sync handler for offline actions
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-actions') {
    event.waitUntil(syncPendingActions());
  }
});

async function syncPendingActions() {
  console.log('[SW] Starting background sync of pending actions');
  
  try {
    const db = await openDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');
    
    const actions = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    console.log(`[SW] Found ${actions.length} pending actions to sync`);

    for (const action of actions) {
      try {
        let response;
        
        if (action.type === 'add') {
          response = await fetch(`/api/review/${action.itemId}/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(action.data || {}),
            credentials: 'include',
          });
        } else if (action.type === 'dismiss') {
          response = await fetch(`/api/review/${action.itemId}/dismiss`, {
            method: 'POST',
            credentials: 'include',
          });
        } else if (action.type === 'skip') {
          response = await fetch(`/api/review/${action.itemId}/skip`, {
            method: 'POST',
            credentials: 'include',
          });
        }

        if (response && response.ok) {
          // Remove the action from IndexedDB
          const deleteTx = db.transaction('pending-actions', 'readwrite');
          deleteTx.objectStore('pending-actions').delete(action.id);
          await new Promise((resolve) => {
            deleteTx.oncomplete = resolve;
          });
          console.log(`[SW] Synced action: ${action.id}`);
        } else {
          console.error(`[SW] Failed to sync action ${action.id}:`, response?.status);
        }
      } catch (error) {
        console.error(`[SW] Error syncing action ${action.id}:`, error);
        // Will retry on next sync
      }
    }

    // Notify clients that sync completed
    const clients = await self.clients.matchAll();
    for (const client of clients) {
      client.postMessage({ type: 'SYNC_COMPLETE', syncedCount: actions.length });
    }

  } catch (error) {
    console.error('[SW] Background sync failed:', error);
    throw error; // Will trigger retry
  }
}

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
