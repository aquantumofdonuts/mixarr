/**
 * Offline Store - IndexedDB for caching review queue and pending actions
 * 
 * Enables offline viewing of review queue and queuing adds when offline.
 */

const DB_NAME = 'mixarr-offline';
const DB_VERSION = 1;

interface ReviewItem {
  id: string;
  artistName: string;
  source: string;
  sourceId: string;
  addedAt: string;
  imageUrl?: string;
  genres?: string[];
  metadata?: Record<string, unknown>;
}

interface PendingAction {
  id: string;
  type: 'add' | 'dismiss' | 'skip';
  itemId: string;
  data?: Record<string, unknown>;
  timestamp: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Initialize IndexedDB
 */
function initDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[OfflineStore] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Review items store
      if (!db.objectStoreNames.contains('review-items')) {
        const reviewStore = db.createObjectStore('review-items', { keyPath: 'id' });
        reviewStore.createIndex('source', 'source', { unique: false });
        reviewStore.createIndex('addedAt', 'addedAt', { unique: false });
      }

      // Pending actions store (for background sync)
      if (!db.objectStoreNames.contains('pending-actions')) {
        const actionsStore = db.createObjectStore('pending-actions', { keyPath: 'id' });
        actionsStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Cached library artists
      if (!db.objectStoreNames.contains('library-artists')) {
        const artistsStore = db.createObjectStore('library-artists', { keyPath: 'id' });
        artistsStore.createIndex('artistName', 'artistName', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Cache review items for offline access
 */
export async function cacheReviewItems(items: ReviewItem[]): Promise<void> {
  try {
    const db = await initDB();
    const tx = db.transaction('review-items', 'readwrite');
    const store = tx.objectStore('review-items');

    // Clear existing items
    store.clear();

    // Add new items
    for (const item of items) {
      store.put(item);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log(`[OfflineStore] Cached ${items.length} review items`);
  } catch (error) {
    console.error('[OfflineStore] Failed to cache review items:', error);
  }
}

/**
 * Get cached review items for offline viewing
 */
export async function getOfflineReviewItems(): Promise<ReviewItem[]> {
  try {
    const db = await initDB();
    const tx = db.transaction('review-items', 'readonly');
    const store = tx.objectStore('review-items');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[OfflineStore] Failed to get offline review items:', error);
    return [];
  }
}

/**
 * Queue an action for background sync
 */
export async function queuePendingAction(
  type: PendingAction['type'],
  itemId: string,
  data?: Record<string, unknown>
): Promise<string> {
  try {
    const db = await initDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');

    const action: PendingAction = {
      id: `${type}-${itemId}-${Date.now()}`,
      type,
      itemId,
      data,
      timestamp: Date.now(),
    };

    store.put(action);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    // Register for background sync if available
    if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
      const registration = await navigator.serviceWorker.ready;
      await (registration as ServiceWorkerRegistration & { sync: { register: (tag: string) => Promise<void> } }).sync.register('sync-actions');
    }

    console.log(`[OfflineStore] Queued action: ${action.id}`);
    return action.id;
  } catch (error) {
    console.error('[OfflineStore] Failed to queue action:', error);
    throw error;
  }
}

/**
 * Get all pending actions for sync
 */
export async function getPendingActions(): Promise<PendingAction[]> {
  try {
    const db = await initDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[OfflineStore] Failed to get pending actions:', error);
    return [];
  }
}

/**
 * Remove a completed action
 */
export async function removePendingAction(actionId: string): Promise<void> {
  try {
    const db = await initDB();
    const tx = db.transaction('pending-actions', 'readwrite');
    const store = tx.objectStore('pending-actions');

    store.delete(actionId);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log(`[OfflineStore] Removed action: ${actionId}`);
  } catch (error) {
    console.error('[OfflineStore] Failed to remove action:', error);
  }
}

/**
 * Cache library artists for offline viewing
 */
export async function cacheLibraryArtists(artists: Array<{ id: number; artistName: string; [key: string]: unknown }>): Promise<void> {
  try {
    const db = await initDB();
    const tx = db.transaction('library-artists', 'readwrite');
    const store = tx.objectStore('library-artists');

    // Clear existing
    store.clear();

    // Add new
    for (const artist of artists) {
      store.put(artist);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    console.log(`[OfflineStore] Cached ${artists.length} library artists`);
  } catch (error) {
    console.error('[OfflineStore] Failed to cache library artists:', error);
  }
}

/**
 * Get cached library artists
 */
export async function getOfflineLibraryArtists(): Promise<Array<{ id: number; artistName: string; [key: string]: unknown }>> {
  try {
    const db = await initDB();
    const tx = db.transaction('library-artists', 'readonly');
    const store = tx.objectStore('library-artists');

    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[OfflineStore] Failed to get offline library artists:', error);
    return [];
  }
}

/**
 * Get count of pending actions
 */
export async function getPendingActionsCount(): Promise<number> {
  try {
    const db = await initDB();
    const tx = db.transaction('pending-actions', 'readonly');
    const store = tx.objectStore('pending-actions');

    return new Promise((resolve, reject) => {
      const request = store.count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[OfflineStore] Failed to count pending actions:', error);
    return 0;
  }
}

/**
 * Clear all cached data
 */
export async function clearOfflineData(): Promise<void> {
  try {
    const db = await initDB();
    
    const stores = ['review-items', 'pending-actions', 'library-artists'];
    
    for (const storeName of stores) {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    console.log('[OfflineStore] Cleared all offline data');
  } catch (error) {
    console.error('[OfflineStore] Failed to clear offline data:', error);
  }
}
