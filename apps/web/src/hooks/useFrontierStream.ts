'use client';

import { useEffect, useRef, useState } from 'react';
import type { StreamToken, StreamPayload, ExpansionStatus } from '@/types/constellation';

/**
 * Base path for the constellation SSE endpoint. Relative URL so the browser
 * hits the Next.js `/api/:path*` rewrite same-origin — session cookies ride
 * along automatically (EventSource sends same-origin credentials).
 */
const STREAM_BASE = '/api/constellation/stream';

/**
 * Consecutive `onerror` callbacks (without an intervening successful `onopen`)
 * tolerated before we give up. Native EventSource auto-reconnects roughly every
 * 3s forever; on a permanent failure (403 cross-user token, 404, 500) that is a
 * silent reconnect storm, so we cap it and surface an error instead.
 */
const MAX_CONSECUTIVE_ERRORS = 3;

export interface FrontierStreamStatus {
  /** True once the stream has opened; false before open / after a fatal close. */
  connected: boolean;
  /** Non-null after the stream is abandoned following repeated failures. */
  error: string | null;
}

/**
 * Re-center race guard (client half). Every SSE payload is stamped with the
 * generation it was published under; a payload whose generation differs from
 * the token's current generation is stale (it belongs to a superseded center)
 * and MUST be discarded.
 *
 * Exported for unit testing — this predicate is the crux of the race guard.
 */
export function isCurrentGeneration(
  payload: { generation?: unknown },
  generation: number,
): boolean {
  return payload.generation === generation;
}

/**
 * Subscribe to the background-expand SSE stream for `token` and forward only
 * the payloads matching the token's current generation to `onNodes`.
 *
 * The EventSource is torn down on unmount and whenever the token id or
 * generation changes (re-centering mints a new generation → old stream closed),
 * so there is never a leaked connection or a cross-generation event.
 *
 * Returns a `{ connected, error }` status. After {@link MAX_CONSECUTIVE_ERRORS}
 * consecutive `onerror` callbacks with no successful open in between, the
 * EventSource is closed (stopping the native auto-reconnect storm) and `error`
 * is set so the consumer can show a "live updates unavailable" state.
 */
export function useFrontierStream(
  token: StreamToken | null,
  onNodes: (payload: StreamPayload) => void,
  onStatus?: (payload: ExpansionStatus) => void,
): FrontierStreamStatus {
  // Keep the latest callback in a ref so an inline `onNodes` doesn't tear down
  // and reopen the EventSource on every render (matches useWebSocket).
  const onNodesRef = useRef(onNodes);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onNodesRef.current = onNodes;
    onStatusRef.current = onStatus;
  });

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenId = token?.id ?? null;
  const generation = token?.generation ?? null;

  useEffect(() => {
    setConnected(false); setError(null);
    if (tokenId === null || generation === null) return;

    // Fresh connection for this token/generation: reset status.
    setConnected(false);
    setError(null);

    const source = new EventSource(`${STREAM_BASE}/${encodeURIComponent(tokenId)}`);
    let consecutiveErrors = 0;
    let abandoned = false;
    let retired = false;

    source.onopen = () => {
      if (retired || abandoned) return;
      // A successful (re)connect clears the failure streak.
      consecutiveErrors = 0;
      setConnected(true);
      setError(null);
    };

    source.onmessage = (event: MessageEvent) => {
      if (retired || abandoned) return;
      let payload: StreamPayload;
      try {
        payload = JSON.parse(event.data) as StreamPayload;
      } catch {
        // Ignore non-JSON frames (e.g. heartbeat comments never reach onmessage,
        // but be defensive against malformed data).
        return;
      }
      // Discard events from a superseded generation (the re-center race guard).
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !isCurrentGeneration(payload, generation)) return;
      if ('status' in payload) {
        if ((payload.status !== 'budget-exhausted' && payload.status !== 'source-unavailable') ||
            !Number.isSafeInteger(payload.focusId) || Number(payload.focusId) <= 0 ||
            !Array.isArray(payload.nodes) || payload.nodes.length !== 0 || !Array.isArray(payload.edges) || payload.edges.length !== 0) return;
        onStatusRef.current?.({ generation, focusId: Number(payload.focusId), status: payload.status,
          ...(payload.status === 'source-unavailable' ? { detail: 'Collaborator source is unavailable. Please retry.' } : {}) });
        return;
      }
      if (!Array.isArray(payload.nodes) || !Array.isArray(payload.edges)) return;
      const validNodes = payload.nodes.every(node => node && typeof node === 'object' &&
        Number.isSafeInteger(node.personId) && node.personId > 0 && typeof node.displayName === 'string' &&
        (node.genre === null || typeof node.genre === 'string') && Number.isFinite(node.size) && typeof node.owned === 'boolean');
      const validEdges = payload.edges.every(edge => edge && typeof edge === 'object' &&
        Number.isSafeInteger(edge.source) && edge.source > 0 && Number.isSafeInteger(edge.target) && edge.target > 0 &&
        Number.isFinite(edge.weight) && (edge.bridge === null || Number.isFinite(edge.bridge)) &&
        typeof edge.bridgeConfident === 'boolean' && Number.isSafeInteger(edge.roleBitmask));
      if (!validNodes || !validEdges) return;
      onNodesRef.current(payload);
    };

    source.onerror = () => {
      if (retired || abandoned) return;
      setConnected(false);
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        // Stop the native auto-reconnect storm and surface the failure.
        abandoned = true;
        source.close();
        setError('Live updates unavailable');
      }
    };

    return () => {
      retired = true;
      // Avoid overwriting a fatal error state during teardown of an abandoned
      // stream, but always close (idempotent) so nothing leaks.
      if (!abandoned) setConnected(false);
      source.close();
    };
    // Re-subscribe (and tear down the old stream) whenever the token identity or
    // its generation changes.
  }, [tokenId, generation]);

  return { connected, error };
}
