'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import type { PathResult } from '@/types/constellation';

/**
 * The "six degrees" mode of the constellation (Design §5).
 *
 * Two artists in, a collaboration path out. Two strategies:
 *  - **Shortest** (default, cheap): the fewest-hops path. Tends to route through
 *    hubs (a mega-producer everyone worked with).
 *  - **Interesting** (slower, bridge-ranked): prefers non-obvious connectors and
 *    may run a hop or two longer. Because it enumerates more of the graph it can
 *    take noticeably longer, so we surface an explicit "Searching…" state.
 *
 * ## Inputs
 * Numeric Discogs person ids (documented simplification). A richer artist search
 * box is future work — the backend `/path` endpoint takes raw person ids, so raw
 * ids are the honest, dependency-free input for this task.
 *
 * ## Honest dead-end
 * The backend answers 404 `{ error: "no path within N degrees" }` when no path
 * exists inside the degree bound. We show THAT message verbatim rather than a
 * generic error — "no path" is a real answer, not a failure.
 */
export interface PathFinderProps {
  /** Called with a hop's person id when a chain node is clicked (recenter/open). */
  onSelectPerson?: (personId: number) => void;
}

type PathMode = 'shortest' | 'interesting';

type PathState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; result: PathResult }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string };

const IDLE: PathState = { status: 'idle' };

function parseId(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function pathUrl(from: number, to: number, mode: PathMode): string {
  const params = new URLSearchParams({ from: String(from), to: String(to), mode });
  return `/api/constellation/path?${params.toString()}`;
}

export function PathFinder({ onSelectPerson }: PathFinderProps) {
  const [fromRaw, setFromRaw] = useState('');
  const [toRaw, setToRaw] = useState('');
  const [mode, setMode] = useState<PathMode>('shortest');
  const [state, setState] = useState<PathState>(IDLE);

  const from = parseId(fromRaw);
  const to = parseId(toRaw);
  // A path from an artist to itself is degenerate — block it client-side so we
  // never send a from==to request (the backend would just echo a 0-degree path).
  const sameEndpoints = from !== null && to !== null && from === to;
  const canSubmit =
    from !== null && to !== null && !sameEndpoints && state.status !== 'searching';

  const findPath = useCallback(async () => {
    if (from === null || to === null || from === to) return;
    setState({ status: 'searching' });
    const { data, error, status } = await api.get<PathResult>(pathUrl(from, to, mode));

    if (data) {
      setState({ status: 'found', result: data });
      return;
    }
    // 404 is the honest "no path" answer — surface the server message as-is.
    if (status === 404) {
      setState({ status: 'empty', message: error ?? `no path within reach` });
      return;
    }
    setState({ status: 'error', message: error ?? 'Path search failed' });
  }, [from, to, mode]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void findPath();
    },
    [findPath],
  );

  return (
    <form
      onSubmit={onSubmit}
      data-testid="path-finder"
      className="flex flex-col gap-2 rounded-container bg-background/80 p-3 text-xs text-foreground backdrop-blur"
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">From artist id</span>
          <input
            type="text"
            inputMode="numeric"
            value={fromRaw}
            onChange={(e) => setFromRaw(e.target.value)}
            aria-label="From artist id"
            className="w-24 rounded border border-border bg-background px-2 py-1"
          />
        </label>
        <span aria-hidden="true" className="pb-2 text-muted-foreground">
          →
        </span>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">To artist id</span>
          <input
            type="text"
            inputMode="numeric"
            value={toRaw}
            onChange={(e) => setToRaw(e.target.value)}
            aria-label="To artist id"
            className="w-24 rounded border border-border bg-background px-2 py-1"
          />
        </label>
      </div>

      <fieldset className="flex items-center gap-3">
        <legend className="sr-only">Path mode</legend>
        {(['shortest', 'interesting'] as const).map((m) => (
          <label key={m} className="flex items-center gap-1 capitalize">
            <input
              type="radio"
              name="path-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
            />
            {m}
          </label>
        ))}
      </fieldset>

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
      >
        Find path
      </button>

      {sameEndpoints && (
        <div data-testid="path-finder-same" className="text-muted-foreground">
          Pick two different artists.
        </div>
      )}

      {state.status === 'searching' && (
        <div
          data-testid="path-finder-searching"
          className="flex items-center gap-2 text-muted-foreground"
        >
          <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-primary" />
          Searching…
        </div>
      )}

      {state.status === 'error' && (
        <div role="alert" data-testid="path-finder-error" className="text-destructive">
          {state.message}
        </div>
      )}

      {state.status === 'empty' && (
        <div data-testid="path-finder-empty" className="text-muted-foreground">
          {state.message}
        </div>
      )}

      {state.status === 'found' && (
        <div data-testid="path-finder-result" className="flex flex-col gap-1">
          <div
            data-testid="path-finder-chain"
            className="flex flex-wrap items-center gap-1"
          >
            {state.result.nodes.map((id, i) => (
              <span key={`${id}-${i}`} className="flex items-center gap-1">
                {i > 0 && (
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onSelectPerson?.(id)}
                  className="rounded bg-muted px-1.5 py-0.5 hover:bg-accent hover:text-accent-foreground"
                >
                  {id}
                </button>
              </span>
            ))}
          </div>
          <div className="text-muted-foreground">
            {state.result.degrees} degrees
            {state.result.mode === 'interesting' &&
              typeof state.result.totalBridge === 'number' && (
                <span data-testid="path-finder-total-bridge">
                  {' · bridge '}
                  {state.result.totalBridge}
                </span>
              )}
          </div>
        </div>
      )}
    </form>
  );
}

export default PathFinder;
