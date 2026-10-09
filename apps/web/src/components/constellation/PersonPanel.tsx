'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Play from 'lucide-react/dist/esm/icons/play';
import { api } from '@/lib/api';
import { ArtistLink, canonicalArtistMbid } from '@/components/artists/ArtistLink';
import type { IdentityResponse } from './ArtistLookup';
import { useConstellationPlayer } from './ConstellationPlayer';
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
  /** Whether this person is in the user's library (drives the player's owned badge). */
  owned?: boolean;
  onClose: () => void;
  actorId?: number;
  credits?: React.ReactNode;
}

/** Per-target acquisition state, keyed by 'artist' or a release id. */
type AcquireState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'added'; target: 'artist' | 'album'; added: boolean }
  | { status: 'needsManual' }
  | { status: 'error'; message: string };

const IDLE: AcquireState = { status: 'idle' };

function musicBrainzSearchUrl(name: string): string {
  return `https://musicbrainz.org/search?query=${encodeURIComponent(name)}&type=artist&method=indexed`;
}

export function PersonPanel({ personId, displayName, owned, onClose, actorId, credits }: PersonPanelProps) {
  const player = useConstellationPlayer();
  const [releases, setReleases] = useState<ReleaseItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Acquisition state per action: 'artist' for the whole-artist monitor, or the
  // release id for a single-album add. Reset whenever the person changes.
  const [artistState, setArtistState] = useState<AcquireState>(IDLE);
  const [releaseState, setReleaseState] = useState<Record<number, AcquireState>>({});

  const [identity, setIdentity] = useState<string | null>(null);
  const [identityError, setIdentityError] = useState(false);
  const [identityRetry, setIdentityRetry] = useState(0);
  const generation = useRef(0);
  const acquisitionRequests = useRef(new Set<AbortController>());
  useEffect(() => {
    generation.current += 1;
    return () => { generation.current += 1; for (const controller of acquisitionRequests.current) controller.abort(); acquisitionRequests.current.clear(); };
  }, [personId, actorId]);
  useEffect(() => {
    setIdentity(null); setIdentityError(false);
    if (personId === null) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ personId: String(personId) });
    if (displayName && displayName.length <= 200) params.set('name', displayName);
    void api.get<IdentityResponse>(`/api/constellation/identity?${params}`, { signal: controller.signal }).then(({ data, error }) => {
      if (controller.signal.aborted) return;
      if (error || !data) { setIdentityError(true); return; }
      if (!data.needsManual && data.personId === personId) setIdentity(canonicalArtistMbid(data.mbid));
    }).catch(() => { if (!controller.signal.aborted) setIdentityError(true); });
    return () => controller.abort();
  }, [personId, displayName, actorId, identityRetry]);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const name = displayName ?? (personId !== null ? `Person ${personId}` : '');

  // A11y: move focus into the panel (the close button) when it opens on a new
  // person, and close on Escape.
  useEffect(() => {
    if (personId === null) return;
    closeButtonRef.current?.focus();

  }, [personId, actorId]);

  // Fetch the discography whenever the panel opens on a new person.
  useEffect(() => {
    if (personId === null) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setReleases([]);
    setArtistState(IDLE);
    setReleaseState({});

    api
      .get<ReleasesResponse>(`/api/constellation/person/${personId}/releases`, { signal: controller.signal })
      .then(({ data, error: err }) => {
        if (controller.signal.aborted) return;
        if (err || !data) {
          setError(err ?? 'Failed to load discography');
          return;
        }
        setReleases(data.releases);
      })
      .catch(() => { if (!controller.signal.aborted) setError('Failed to load discography'); })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [personId, actorId]);

  const subscribe = useCallback(
    async (
      releaseTitle: string | undefined,
      setState: (s: AcquireState) => void,
    ) => {
      if (personId === null) return;
      const currentGeneration = generation.current;
      const controller = new AbortController(); acquisitionRequests.current.add(controller);
      setState({ status: 'pending' });
      try {
        const { data, error: err, status } = await api.post<SubscribeResponse>(
          `/api/constellation/person/${personId}/subscribe`,
          { releaseTitle, name: displayName }, { signal: controller.signal },
        );
        if (controller.signal.aborted || generation.current !== currentGeneration) return;
        if (status === 409) { setState({ status: 'needsManual' }); return; }
        if (err || !data) { setState({ status: 'error', message: err ?? 'Failed to add to Lidarr' }); return; }
        setState({ status: 'added', target: data.target, added: data.added });
      } catch {
        if (!controller.signal.aborted && generation.current === currentGeneration) setState({ status: 'error', message: 'Failed to add to Lidarr' });
      } finally { acquisitionRequests.current.delete(controller); }
    },
    [personId, displayName, actorId],
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

  // Play affordance (Design §8): the header ▶ plays the person's representative
  // track (their name as the artist), and each release row has a ▶ that plays
  // `{artist: name, track: release.title}`. Both only render when a page-level
  // player is mounted (the context provides `play`); otherwise they are hidden.
  const playArtist = useCallback(
    () => player?.play({ artist: name, owned }),
    [player, name, owned],
  );
  const playRelease = useCallback(
    (release: ReleaseItem) => player?.play({ artist: name, track: release.title, owned }),
    [player, name, owned],
  );

  if (personId === null) return null;

  return (
    <aside
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}
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
          {identity && <ArtistLink mbid={identity} className="inline-flex min-h-11 items-center text-sm">Open artist inspector</ArtistLink>}
          {identityError ? <p className="text-xs">Identity unavailable. <button type="button" className="min-h-11 text-link underline" onClick={() => setIdentityRetry(value => value + 1)}>Retry identity</button></p> : !identity && <p className="text-xs text-muted-foreground">Inspector available after verified identity resolution.</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {player && (
            <button
              type="button"
              onClick={playArtist}
              aria-label={`Play ${name}`}
              data-testid="person-panel-play"
              className="min-h-11 min-w-11 rounded-button p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Play className="h-5 w-5" />
            </button>
          )}
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="min-h-11 min-w-11 rounded-button p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {credits && <div className="max-h-40 overflow-auto border-b p-4 text-xs">{credits}</div>}

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
            {artistState.added ? 'Added to Lidarr — monitoring this artist.' : 'Already in Lidarr.'}
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
                        {state.added ? 'Added to Lidarr.' : 'Already in Lidarr.'}
                      </p>
                    )}
                    {state.status === 'error' && (
                      <p role="alert" className="mt-1 text-xs text-destructive">
                        {state.message}
                      </p>
                    )}
                    {state.status === 'needsManual' && <NeedsManualNotice name={name} />}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {player && (
                      <button
                        type="button"
                        onClick={() => playRelease(release)}
                        aria-label={`Play ${release.title}`}
                        data-testid={`person-panel-play-release-${release.releaseId}`}
                        className="min-h-11 min-w-11 rounded-button border border-border p-1 text-foreground hover:bg-accent"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => addRelease(release)}
                      disabled={state.status === 'pending' || state.status === 'added'}
                      className="min-h-11 rounded-button border border-border px-2 py-1 text-xs text-foreground hover:bg-accent disabled:opacity-60"
                    >
                      {state.status === 'pending'
                        ? 'Adding…'
                        : state.status === 'added'
                          ? 'Added'
                          : 'Add to Lidarr'}
                    </button>
                  </div>
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
      No verified MusicBrainz identity — can&apos;t auto-add.{' '}
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
