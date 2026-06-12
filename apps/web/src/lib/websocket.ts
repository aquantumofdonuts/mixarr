'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface UseWebSocketOptions {
  onMessage?: (data: any) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  reconnectAttempts?: number;
  reconnectInterval?: number;
}

export function useWebSocket(
  url: string | null,
  options: UseWebSocketOptions = {}
) {
  const {
    onMessage,
    onConnect,
    onDisconnect,
    reconnectAttempts = 5,
    reconnectInterval = 3000,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<any>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  // Keep the latest callbacks in a ref so `connect` never depends on
  // caller-provided function identity — inline callbacks would otherwise
  // tear down and reopen the socket on every render.
  const callbacksRef = useRef({ onMessage, onConnect, onDisconnect });
  useEffect(() => {
    callbacksRef.current = { onMessage, onConnect, onDisconnect };
  });

  const connect = useCallback(() => {
    if (!url) return;

    try {
      const ws = new WebSocket(url);

      ws.onopen = () => {
        setIsConnected(true);
        attemptRef.current = 0;
        callbacksRef.current.onConnect?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);
          callbacksRef.current.onMessage?.(data);
        } catch {
          // Non-JSON message
          setLastMessage(event.data);
          callbacksRef.current.onMessage?.(event.data);
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        wsRef.current = null;
        callbacksRef.current.onDisconnect?.();

        // Attempt reconnection with exponential backoff + jitter so a
        // server restart doesn't trigger a synchronized client stampede
        if (attemptRef.current < reconnectAttempts) {
          attemptRef.current++;
          const base = Math.min(reconnectInterval * 2 ** (attemptRef.current - 1), 30_000);
          const delay = base * (0.5 + Math.random() * 0.5);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = () => {
        ws.close();
      };

      wsRef.current = ws;
    } catch (error) {
      console.error('WebSocket connection error:', error);
    }
  }, [url, reconnectAttempts, reconnectInterval]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    attemptRef.current = reconnectAttempts; // Prevent reconnection
    wsRef.current?.close();
  }, [reconnectAttempts]);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    isConnected,
    lastMessage,
    send,
    disconnect,
    reconnect: connect,
  };
}

// Hook for job updates
export function useJobUpdates(onUpdate?: (job: any) => void) {
  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/jobs`
    : null;

  return useWebSocket(wsUrl, {
    onMessage: onUpdate,
  });
}

// Hook for live log streaming
export function useLiveLog(onLog?: (log: any) => void) {
  const wsUrl = typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws/logs`
    : null;

  return useWebSocket(wsUrl, {
    onMessage: onLog,
  });
}
