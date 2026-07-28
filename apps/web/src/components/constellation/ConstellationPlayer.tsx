'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import Play from 'lucide-react/dist/esm/icons/play';
import Pause from 'lucide-react/dist/esm/icons/pause';
import X from 'lucide-react/dist/esm/icons/x';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle';
import Music from 'lucide-react/dist/esm/icons/music';
import { api } from '@/lib/api';
import type { PlayResponse } from '@/types/constellation';

/**
 * The persistent audio player bar (Design §8 playback chain).
 *
 * A "now playing" request names an artist (+ optional track) and whether the node
 * is owned. The bar resolves a source via `GET /api/constellation/play` and
 * renders the honest tier it got back:
 *
 *  - **deezer**  → an in-app `<audio>` 30s preview (play/pause + a scrubber),
 *    cover art, title/artist, and a "▶ Deezer preview" source badge.
 *  - **youtube** → an "↗ Open in YouTube" link-out (new tab) + a "no preview
 *    available" note and a "YouTube" source badge. It NEVER autoplays and is a
 *    plain results link, not an embed.
 *  - **owned**   → an extra "● In your library" badge. Full library streaming is
 *    out of scope, so owned is a badge hint layered on whichever source resolved.
 *
 * ## How it is driven (decoupled trigger)
 * The player is mounted once, high in the tree (Task 22 places it at the
 * constellation page). Triggers live deep in the tree (the {@link PersonPanel}
 * header ▶ and per-release ▶). Rather than prop-drill a callback through the
 * graph, this module exposes a tiny React context: wrap the page in
 * {@link ConstellationPlayerProvider} and call {@link useConstellationPlayer} from
 * anywhere to `play(request)`. The provider owns the "now playing" state and
 * renders the bar. `useConstellationPlayer` returns `null` outside a provider, so
 * a trigger can cheaply hide its play affordance when no player is mounted.
 *
 * ## Audio hygiene
 * The `<audio>` element is paused + its `src` cleared whenever the resolved
 * preview changes or the bar unmounts — no leaked/overlapping playback.
 */
export interface NowPlayingRequest {
  artist: string;
  track?: string;
  owned?: boolean;
}

type ResolveState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; result: PlayResponse }
  | { status: 'error'; message: string };

export interface ConstellationPlayerProps {
  /** The current "now playing" request, or `null` when nothing is queued. */
  request: NowPlayingRequest | null;
  /** Stop + dismiss the player. */
  onClose: () => void;
}

const PREVIEW_SECONDS = 30;

/**
 * A YouTube results-page link for an artist (+ optional track). Mirrors the
 * backend's link-out (a plain search link, NOT an embed / Data API) so a broken
 * Deezer preview can degrade to the same always-available bottom tier client-side.
 */
function youtubeSearchUrl(artist: string, track?: string): string {
  const q = [artist, track].filter((s) => s && s.trim()).join(' ');
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export function ConstellationPlayer({ request, onClose }: ConstellationPlayerProps) {
  const [state, setState] = useState<ResolveState>({ status: 'idle' });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(PREVIEW_SECONDS);
  // A resolved-but-broken Deezer preview (dead CDN / 404 on load or play). When
  // set we swap the audio UI for a YouTube link-out so a broken preview is never
  // a silent dead end.
  const [previewFailed, setPreviewFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Resolve the playback source whenever the request changes.
  useEffect(() => {
    if (!request) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(PREVIEW_SECONDS);
    setPreviewFailed(false);

    const params = new URLSearchParams({ artist: request.artist });
    if (request.track) params.set('track', request.track);
    if (request.owned) params.set('owned', 'true');

    api
      .get<PlayResponse>(`/api/constellation/play?${params.toString()}`)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setState({ status: 'error', message: error ?? 'Could not resolve playback' });
          return;
        }
        setState({ status: 'ready', result: data });
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  const previewUrl =
    state.status === 'ready' && state.result.source === 'deezer'
      ? state.result.previewUrl
      : null;

  // Audio hygiene: pause + clear src of the PREVIOUS preview when the source
  // changes or the bar unmounts. `el` is captured on run so cleanup works even
  // after React detaches the ref on unmount.
  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (el) {
        el.pause();
        el.removeAttribute('src');
        el.load?.();
      }
    };
  }, [previewUrl]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      // play() returns a promise in real browsers. A rejection AFTER a user
      // gesture (this click) means the media itself won't play — a broken/dead
      // preview — so surface the YouTube fallback rather than swallow it.
      void Promise.resolve(el.play()).catch(() => setPreviewFailed(true));
    } else {
      el.pause();
    }
  }, []);

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current;
    if (!el) return;
    const t = Number(e.target.value);
    el.currentTime = t;
    setCurrentTime(t);
  }, []);

  if (!request) return null;

  return (
    <div
      role="region"
      aria-label="Constellation player"
      data-testid="constellation-player"
      className="fixed bottom-0 left-0 right-0 z-30 flex items-center gap-3 border-t border-border bg-card px-4 py-2 shadow-lg"
    >
      {state.status === 'loading' && (
        <p
          data-testid="player-loading"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          Resolving playback…
        </p>
      )}

      {state.status === 'error' && (
        <p role="alert" data-testid="player-error" className="text-sm text-destructive">
          {state.message}
        </p>
      )}

      {state.status === 'ready' && state.result.source === 'deezer' && !previewFailed && (
        <>
          {state.result.coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={state.result.coverUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
          ) : (
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
              <Music className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </span>
          )}

          <button
            type="button"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
            data-testid="player-play-toggle"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {state.result.title}
              </p>
              <SourceBadge kind="deezer" />
              {state.result.owned && <OwnedBadge />}
            </div>
            <p className="truncate text-xs text-muted-foreground">{state.result.artist}</p>
            <input
              type="range"
              min={0}
              max={duration || PREVIEW_SECONDS}
              step={0.1}
              value={currentTime}
              onChange={onSeek}
              aria-label="Seek preview"
              data-testid="player-scrubber"
              className="mt-1 w-full accent-primary"
            />
          </div>

          <audio
            ref={audioRef}
            src={state.result.previewUrl}
            data-testid="player-audio"
            preload="metadata"
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (Number.isFinite(d) && d > 0) setDuration(d);
            }}
            // A dead CDN / 404 on the (non-empty) preview URL — fall back to a
            // YouTube link-out rather than fail silently.
            onError={() => setPreviewFailed(true)}
          />
        </>
      )}

      {/* Deezer resolved but its preview URL is broken: honest link-out fallback. */}
      {state.status === 'ready' && state.result.source === 'deezer' && previewFailed && (
        <>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
            <Music className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {state.result.title}
              </p>
              <SourceBadge kind="youtube" />
              {state.result.owned && <OwnedBadge />}
            </div>
            <p data-testid="player-preview-unavailable" className="text-xs text-muted-foreground">
              Preview unavailable — open on YouTube instead.
            </p>
          </div>
          <a
            href={youtubeSearchUrl(request.artist, request.track)}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="player-youtube-link"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in YouTube
          </a>
        </>
      )}

      {state.status === 'ready' && state.result.source === 'youtube' && (
        <>
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
            <Music className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-medium text-foreground">
                {request.track ? `${request.artist} — ${request.track}` : request.artist}
              </p>
              <SourceBadge kind="youtube" />
              {state.result.owned && <OwnedBadge />}
            </div>
            <p data-testid="player-no-preview" className="text-xs text-muted-foreground">
              No preview available — open on YouTube instead.
            </p>
          </div>
          <a
            href={state.result.youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="player-youtube-link"
            className="flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open in YouTube
          </a>
        </>
      )}

      <button
        type="button"
        onClick={onClose}
        aria-label="Close player"
        data-testid="player-close"
        className="ml-auto shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );
}

function SourceBadge({ kind }: { kind: 'deezer' | 'youtube' }) {
  if (kind === 'deezer') {
    return (
      <span
        data-testid="player-source-deezer"
        className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary"
      >
        ▶ Deezer preview
      </span>
    );
  }
  return (
    <span
      data-testid="player-source-youtube"
      className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
    >
      YouTube
    </span>
  );
}

function OwnedBadge() {
  return (
    <span
      data-testid="player-owned-badge"
      className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
    >
      ● In your library
    </span>
  );
}

// ---------------------------------------------------------------------------
// Context: the decoupled trigger for the page-level player.
// ---------------------------------------------------------------------------

interface PlayerContextValue {
  play: (request: NowPlayingRequest) => void;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

/**
 * Access the page-level player's `play(request)` trigger. Returns `null` when no
 * {@link ConstellationPlayerProvider} is mounted, letting a caller cheaply hide
 * its play affordance in that case.
 */
export function useConstellationPlayer(): PlayerContextValue | null {
  return useContext(PlayerContext);
}

/**
 * Mounts a single {@link ConstellationPlayer} and exposes `play(request)` to the
 * subtree via context. Wrap the constellation page in this (Task 22) so nodes and
 * release rows can start playback without prop-drilling.
 */
export function ConstellationPlayerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<NowPlayingRequest | null>(null);
  const play = useCallback((req: NowPlayingRequest) => setRequest(req), []);
  const close = useCallback(() => setRequest(null), []);

  return (
    <PlayerContext.Provider value={{ play }}>
      {children}
      <ConstellationPlayer request={request} onClose={close} />
    </PlayerContext.Provider>
  );
}

export default ConstellationPlayer;
