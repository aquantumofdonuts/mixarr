/**
 * useOfflineStatus - React hook for tracking online/offline status
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { getPendingActionsCount } from './offline-store';

interface OfflineStatus {
  isOnline: boolean;
  isOffline: boolean;
  pendingActionsCount: number;
  lastOnlineAt: Date | null;
}

export function useOfflineStatus(): OfflineStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingActionsCount, setPendingActionsCount] = useState(0);
  const [lastOnlineAt, setLastOnlineAt] = useState<Date | null>(null);

  const updateOnlineStatus = useCallback(() => {
    const online = navigator.onLine;
    setIsOnline(online);
    if (online) {
      setLastOnlineAt(new Date());
    }
  }, []);

  const updatePendingCount = useCallback(async () => {
    try {
      const count = await getPendingActionsCount();
      setPendingActionsCount(count);
    } catch {
      // IndexedDB might not be available
    }
  }, []);

  useEffect(() => {
    // Set initial status
    setIsOnline(navigator.onLine);

    // Listen for online/offline events
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);

    // Check pending actions count
    updatePendingCount();

    // Poll for pending actions changes
    const interval = setInterval(updatePendingCount, 5000);

    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
      clearInterval(interval);
    };
  }, [updateOnlineStatus, updatePendingCount]);

  return {
    isOnline,
    isOffline: !isOnline,
    pendingActionsCount,
    lastOnlineAt,
  };
}
