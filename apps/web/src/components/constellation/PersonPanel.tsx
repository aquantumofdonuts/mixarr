'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import { api } from '@/lib/api';
import type {
  ReleaseItem,
  ReleasesResponse,
  SubscribeResponse,
} from '@/types/constellation';

/**
 * The side panel a constellation node opens (Design §8 acquisition grain).
 *
 * Nodes are PEOPLE, but Lidarr monitors ARTISTS — so blind-subscribing a
 * session-player node would monitor an empty artist. Instead, selecting a node
 * lands the user HERE, where they explicitly choose the grain: monitor the whole
 * artist, or add a single release (album). This is the "graph IS the download
 * interface" loop.
 *
 * The honest dead-end: a person MusicBrainz can't link/corroborate can't be
 * auto-added. The subscribe endpoint answers 409; we render an inline message +
 * a MusicBrainz search link instead of a generic error. The node stays browsable.
 */
export interface PersonPanelProps {
  /** The Discogs person id to show, or `null` for a closed panel. */
  personId: number | null;
  /** The node's display name (for the header + MusicBrainz search link). */
  displayName?: string;
  onClose: () => void;
}

/** Per-target acquisition state, keyed by 'artist' or a release id. */
type AcquireState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'added'; target: 'artist' | 'album' }
  | { status: 'needsManual' }
  | { status: 'error'; message: string };

const IDLE: AcquireState = { status: 'idle' };

function musicBrainzSearchUrl(name: string): string {
  return `https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=artist&method=indexed`;
}

export function PersonPanel({ personId, displayName, onClose }: PersonPanelProps) {
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acquisition state per action: 'artist' for the whole-artist monitor, or the
  // release id for a single-album add. Reset whenever the person changes.
  const [artistState, setArtistState] = useState<AcquireState>(IDLE);
  const [releaseState, setReleaseState] = useState<Record<number, AcquireState>>({});

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const name = displayName ?? (personId !== null ? `Person ${personId}` : '');

  // A11y: move focus into the panel (the close button) when it opens on a new
  // person, and close on Escape.
  useEffect(() => {
    if (personId === null) return;
    closeButtonRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [personId, onClose]);

  // Fetch the discography whenever the panel opens on a new person.
  useEffect(() => {
    if (personId === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReleases([]);
    setArtistState(IDLE);
    setReleaseState({});

    api
      .get<ReleasesResponse>(`/api/constellation/person/${personId}/releases`)
      .then(({ data, error: err }) => {
        if (cancelled) return;
        if (err || !data) {
          setError(err ?? 'Failed to load discography');
          return;
        }
        setReleases(data.releases);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [personId]);

  const subscribe = useCallback(
    async (
      releaseTitle: string | undefined,
      setState: (s: AcquireState) => void,
    ) => {
      if (personId === null) return;
      setState({ status: 'pending' });
      const { data, error: err, status } = await api.post<SubscribeResponse>(
        `/api/constellation/person/${personId}/subscribe`,
        { releaseTitle, name: displayName },
      );
      // 409 = the honest dead-end: not linked to MusicBrainz.
      if (status === 409) {
        setState({ status: 'needsManual' });
        return;
      }
      if (err || !data) {
        setState({ status: 'error', message: err ?? 'Failed to add to Lidarr' });
        return;
      }
      setState({ status: 'added', target: data.target });
    },
    [personId, displayName],
  );

  const monitorArtist = useCallback(
    () => subscribe(undefined, setArtistState),
    [subscribe],
  );

  const addRelease = useCallback(
    (release: ReleaseItem) =>
      subscribe(release.title, (s) =>
        setReleaseState((prev) => ({ ...prev, [release.releaseId]: s })),
      ),
    [subscribe],
  );

  if (personId === null) return null;

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${name} details`}
      data-testid="person-panel"
      className="absolute right-0 top-0 z-20 flex h-full w-full max-w-sm flex-col border-l border-border bg-card shadow-lg"
    >
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border p-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">{name}</h2>
          <p className="text-xs text-muted-foreground">Discography</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Whole-artist monitor (the coarse grain) */}
      <div className="border-b border-border p-4">
        <button
          type="button"
          onClick={monitorArtist}
          disabled={artistState.status === 'pending'}
          className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {artistState.status === 'pending' ? 'Adding…' : 'Monitor artist in Lidarr'}
        </button>
        {artistState.status === 'added' && (
          <p role="status" className="mt-2 text-xs text-muted-foreground">
            Added to Lidarr — monitoring this artist.
          </p>
        )}
        {artistState.status === 'error' && (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {artistState.message}
          </p>
        )}
        {artistState.status === 'needsManual' && (
          <NeedsManualNotice name={name} />
        )}
      </div>

      {/* Discography */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading && (
          <p data-testid="person-panel-loading" className="text-sm text-muted-foreground">
            Loading discography…
          </p>
        )}

        {!loading && error && (
          <p role="alert" data-testid="person-panel-error" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {!loading && !error && releases.length === 0 && (
          <p data-testid="person-panel-empty" className="text-sm text-muted-foreground">
            No releases found for this person.
          </p>
        )}

        {!loading && !error && releases.length > 0 && (
          <ul className="flex flex-col gap-2">
            {releases.map((release) => {
              const state = releaseState[release.releaseId] ?? IDLE;
              return (
                <li
                  key={release.releaseId}
                  className="flex items-start justify-between gap-2 rounded-lg border border-border p-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{release.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {release.year ?? 'Unknown year'}
                      {release.master !== null && ' · master'}
                    </p>
                    {state.status === 'added' && (
                      <p role="status" className="mt-1 text-xs text-muted-foreground">
                        Added to Lidarr.
                      </p>
                    )}
                    {state.status === 'error' && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {state.message}
                      </p>
                    )}
                    {state.status === 'needsManual' && <NeedsManualNotice name={name} />}
                  </div>
                  <button
                    type="button"
                    onClick={() => addRelease(release)}
                    disabled={state.status === 'pending' || state.status === 'added'}
                    className="shrink-0 rounded-lg border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-60"
                  >
                    {state.status === 'pending'
                      ? 'Adding…'
                      : state.status === 'added'
                        ? 'Added'
                        : 'Add to Lidarr'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * The honest acquisition dead-end: not in MusicBrainz, so no auto-add. We offer a
 * MusicBrainz search link rather than a generic error; the node stays browsable.
 */
function NeedsManualNotice({ name }: { name: string }) {
  return (
    <p role="status" data-testid="person-panel-needs-manual" className="mt-2 text-xs text-muted-foreground">
      Not in MusicBrainz — can&apos;t auto-add.{' '}
      <a
        href={musicBrainzSearchUrl(name)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:no-underline"
      >
        Search MusicBrainz
      </a>
    </p>
  );
}

export default PersonPanel;
