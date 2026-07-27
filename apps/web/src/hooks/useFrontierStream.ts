'use client';

import { useEffect, useRef } from 'react';
import type { StreamToken, StreamPayload } from '@/types/constellation';

/**
 * Base path for the constellation SSE endpoint. Relative URL so the browser
 * hits the Next.js `/api/:path*` rewrite same-origin — session cookies ride
 * along automatically (EventSource sends same-origin credentials).
 */
const STREAM_BASE = '/api/constellation/stream';

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
 */
export function useFrontierStream(
  token: StreamToken | null,
  onNodes: (payload: StreamPayload) => void,
): void {
  // Keep the latest callback in a ref so an inline `onNodes` doesn't tear down
  // and reopen the EventSource on every render (matches useWebSocket).
  const onNodesRef = useRef(onNodes);
  useEffect(() => {
    onNodesRef.current = onNodes;
  });

  const tokenId = token?.id ?? null;
  const generation = token?.generation ?? null;

  useEffect(() => {
    if (tokenId === null || generation === null) return;

    const source = new EventSource(`${STREAM_BASE}/${encodeURIComponent(tokenId)}`);

    source.onmessage = (event: MessageEvent) => {
      let payload: StreamPayload;
      try {
        payload = JSON.parse(event.data) as StreamPayload;
      } catch {
        // Ignore non-JSON frames (e.g. heartbeat comments never reach onmessage,
        // but be defensive against malformed data).
        return;
      }
      // Discard events from a superseded generation (the re-center race guard).
      if (!isCurrentGeneration(payload, generation)) return;
      onNodesRef.current(payload);
    };

    return () => {
      source.close();
    };
    // Re-subscribe (and tear down the old stream) whenever the token identity or
    // its generation changes.
  }, [tokenId, generation]);
}
