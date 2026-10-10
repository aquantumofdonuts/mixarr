'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArtistLookup, type ResolvedPerson } from './ArtistLookup';
import { api } from '@/lib/api';
import type { PathResult } from '@/types/constellation';

export interface PathFinderProps {
  /** Called with a hop's person id when a chain node is clicked (recenter/open). */
  onSelectPerson?: (personId: number) => void;
  actorId?: number;
  initialFrom?: number | null;
  initialTo?: number | null;
  initialMode?: PathMode;
  names?: Map<number, string>;
  onPathChange?: (from: number, to: number, mode: PathMode) => void;
}

type PathMode = 'shortest' | 'interesting';

type PathState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; result: PathResult }
  | { status: 'empty'; message: string }
  | { status: 'error'; message: string };

const IDLE: PathState = { status: 'idle' };

function pathUrl(from: number, to: number, mode: PathMode): string {
  const params = new URLSearchParams({ from: String(from), to: String(to), mode });
  return `/api/constellation/path?${params.toString()}`;
}

export function PathFinder({ onSelectPerson, actorId, initialFrom, initialTo, initialMode = 'shortest', names, onPathChange }: PathFinderProps) {
  const [fromPerson, setFrom] = useState<ResolvedPerson | null>(null);
  const [toPerson, setTo] = useState<ResolvedPerson | null>(null);
  const [mode, setMode] = useState<PathMode>(initialMode);
  const [state, setState] = useState<PathState>(IDLE);
  const request = useRef<AbortController | null>(null);
  const from = fromPerson?.personId ?? null, to = toPerson?.personId ?? null;
  useEffect(() => { setMode(initialMode); }, [initialMode]);
  useEffect(() => {
    request.current?.abort(); setState(IDLE);
    return () => { request.current?.abort(); };
  }, [from, to, mode, actorId]);
  const sameEndpoints = from !== null && to !== null && from === to;
  const canSubmit =
    from !== null && to !== null && !sameEndpoints && state.status !== 'searching';

  const findPath = useCallback(async () => {
    if (from === null || to === null || from === to) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setState({ status: 'searching' });
    try {
      const { data, error, status } = await api.get<PathResult>(pathUrl(from, to, mode), { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (data) { setState({ status: 'found', result: data }); return; }
      setState(status === 404 ? { status: 'empty', message: error ?? 'no path within reach' } : { status: 'error', message: error ?? 'Path search failed' });
    } catch {
      if (!controller.signal.aborted) setState({ status: 'error', message: 'Path search failed' });
    }
  }, [from, to, mode]);
  useEffect(() => {
    if (initialFrom === from && initialTo === to && from !== null && to !== null && from !== to) void findPath();
  }, [initialFrom, initialTo, from, to, findPath]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (from !== null && to !== null) onPathChange?.(from, to, mode);
      void findPath();
    },
    [findPath, from, to, mode, onPathChange],
  );

  return (
    <form
      onSubmit={onSubmit}
      data-testid="path-finder"
      className="flex flex-col gap-2 rounded-container bg-background p-3 text-xs text-foreground"
    >
      <ArtistLookup label="From artist" actorId={actorId} initialPersonId={initialFrom} onChange={setFrom} />
      <ArtistLookup label="To artist" actorId={actorId} initialPersonId={initialTo} onChange={setTo} />

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
        className="rounded bg-primary min-h-11 px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
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
                  {id === from ? fromPerson?.name : id === to ? toPerson?.name : names?.get(id) || `Person ${id}`}
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
