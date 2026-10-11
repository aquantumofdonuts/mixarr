'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { flushSync } from 'react-dom';
import dynamic from 'next/dynamic';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import type { ForceGraphProps, NodeObject } from 'react-force-graph-2d';
import {
  useConstellation,
  type ConstellationSeed,
} from '@/hooks/useConstellation';
import { ResultState } from '@/components/ui/result-state';
import { useFrontierStream } from '@/hooks/useFrontierStream';
import {
  genreColor,
  genreHighlightAlpha,
  nodeRadius,
  edgeWidth,
  edgeColor,
  ownedRingStyle,
  FOCUS_NODE_COLOR,
} from './encoding';
import { PersonPanel } from './PersonPanel';
import { ConstellationControls } from './ConstellationControls';
import { PathFinder } from './PathFinder';
import { ROLE_BITS, ROLE_LABELS, type BaseRole } from './roleBits';

/**
 * A single visited person in the wander trail (each hop expands in place).
 */
export interface Breadcrumb {
  personId: number;
  displayName: string;
}

/** Node shape handed to the force-graph canvas. */
interface CanvasNode {
  id: number;
  name: string;
  genre: string | null;
  size: number;
  owned: boolean;
  isFocus: boolean;
}

/** Link shape handed to the force-graph canvas. */
interface CanvasLink {
  source: number;
  target: number;
  weight: number;
  bridge: number | null;
  bridgeConfident: boolean;
  isFocusLink: boolean;
}

/**
 * Client-only force-graph, loaded via `next/dynamic` with `ssr: false`. The lib
 * touches `window`/`canvas` at module scope, so it must never run on the server
 * — importing it dynamically keeps it out of the SSR bundle. The cast pins the
 * generic node/link types so our accessor props are type-checked.
 */
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), {
  ssr: false,
}) as ComponentType<ForceGraphProps<CanvasNode, CanvasLink>>;

export interface ConstellationViewProps {
  /**
   * The artist the graph is seeded from, or `null` for "no graph loaded". The
   * component owns the data layer itself via {@link useConstellation}; clicking a
   * node expands it in place (it does not lift the seed back to the parent).
   */
  seed: ConstellationSeed;
  actorId?: number;
  requestedFocus?: number | null;
  pathFrom?: number | null;
  pathTo?: number | null;
  pathMode?: 'shortest' | 'interesting';
  onFocusChange?: (personId: number, replace?: boolean) => void;
  onPathChange?: (from: number, to: number, mode: 'shortest' | 'interesting') => void;
}

/**
 * The dense collaboration field. Node color = genre, radius = prominence, gold
 * ring = owned, edge width = tie strength, warm edge glow = confident bridge.
 * Clicking a node expands it IN PLACE — its collaborators are merged into the
 * field so the walk accumulates ("wander down a path") — and records the hop in
 * a breadcrumb trail; background-expanded nodes stream in via the frontier SSE
 * and are merged the same way. The seed (focus) only changes when the parent
 * remounts the view with a new `seed`.
 */
export function ConstellationView({ seed, actorId, requestedFocus, pathFrom, pathTo, pathMode, onFocusChange, onPathChange }: ConstellationViewProps) {
  // Controls-bar state. `roleMask` is the SERVER-SIDE role filter —
  // it is passed into the data hook so a change re-seeds through the backend's
  // filtered `subgraph`. `hideHotness` and `genreHighlight` are CLIENT-SIDE paint
  // adjustments only (no re-fetch).
  const [labelColor, setLabelColor] = useState('#191C1F');
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const foreground = getComputedStyle(root).getPropertyValue('--foreground').trim();
      if (foreground) setLabelColor(`hsl(${foreground})`);
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => observer.disconnect();
  }, []);
  const canvasContainer = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1, height: 420 });
  useEffect(() => {
    const element = canvasContainer.current;
    if (!element) return;
    const measure = () => setCanvasSize({ width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [roleMask, setRoleMask] = useState<number | undefined>(undefined);
  const [hideHotness, setHideHotness] = useState(false);
  const [genreHighlight, setGenreHighlight] = useState<string | null>(null);

  // The full trail stays in view state even when its older graph nodes leave the field.
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<(Breadcrumb & { owned: boolean }) | null>(null);
  // A local walk owns focus until its URL push commits or another URL arrives.
  const [pendingWalk, setPendingWalk] = useState<{ from: number | null | undefined; to: number } | null>(null);
  useEffect(() => { setPendingWalk(null); }, [requestedFocus, actorId, seed?.type, seed?.id]);
  const walkingFocus = pendingWalk && pendingWalk.from === requestedFocus
    ? pendingWalk.to : requestedFocus !== undefined ? requestedFocus : selectedPerson?.personId;
  const { nodes: mergedNodes, edges: mergedEdges, focusId, streamToken, loading, error, expandMore,
    onFrame, onStatus, availability, creditSource } = useConstellation(seed, {
      roleMask, actorId, walkingFocus,
      breadcrumbIds: breadcrumbs.map(crumb => crumb.personId),
    });
  const streamKey = streamToken ? `${streamToken.id}:${streamToken.generation}` : null;
  useFrontierStream(streamToken, onFrame, onStatus);
  useEffect(() => { if (creditSource === 'live') setGenreHighlight(null); }, [creditSource]);

  const names = useMemo(() => new Map(mergedNodes.map(node => [node.personId, node.displayName])), [mergedNodes]);
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (loading || focusId === null) return;
    if (!walkingFocus) { onFocusChange?.(focusId, true); setSelectedPerson(null); return; }
    const key = `${streamKey}:${walkingFocus}`;
    if (restored.current === key) return;
    restored.current = key;
    const node = mergedNodes.find(person => person.personId === walkingFocus);
    setSelectedPerson({ personId: walkingFocus, displayName: node?.displayName || `Person ${walkingFocus}`, owned: node?.owned ?? false });
    if (walkingFocus !== focusId) void expandMore(walkingFocus);
  }, [walkingFocus, focusId, loading, streamKey, mergedNodes, expandMore, onFocusChange]);

  useEffect(() => {
    setSelectedPerson(previous => {
      if (!previous) return previous;
      const node = mergedNodes.find(person => person.personId === previous.personId);
      return node && (node.displayName !== previous.displayName || node.owned !== previous.owned)
        ? { ...previous, displayName: node.displayName || previous.displayName, owned: node.owned }
        : previous;
    });
  }, [mergedNodes]);

  // Stable node objects: reuse the SAME object per personId across renders so the
  // force sim preserves each node's position (x/y) as the graph GROWS. Rebuilding
  // fresh objects every render would reset the whole layout and make each
  // expansion "jump" — the accumulate-in-place wander depends on this identity.
  const nodeObjs = useRef<Map<number, CanvasNode>>(new Map());
  const graphData = useMemo(() => {
    const map = nodeObjs.current;
    const retained = new Set(mergedNodes.map(node => node.personId));
    for (const id of map.keys()) if (!retained.has(id)) map.delete(id);
    for (const n of mergedNodes) {
      const existing = map.get(n.personId);
      if (existing) {
        // Update mutable fields in place; keep the object (and its x/y) identity.
        existing.name = n.displayName;
        existing.genre = n.genre;
        existing.size = n.size;
        existing.owned = n.owned;
        existing.isFocus = n.personId === focusId;
      } else {
        map.set(n.personId, {
          id: n.personId,
          name: n.displayName,
          genre: n.genre,
          size: n.size,
          owned: n.owned,
          isFocus: n.personId === focusId,
        });
      }
    }
    const graphNodes = mergedNodes.map((n) => map.get(n.personId) as CanvasNode);
    const links = mergedEdges.map<CanvasLink>((e) => ({
      source: e.source,
      target: e.target,
      weight: e.weight,
      bridge: e.bridge,
      bridgeConfident: e.bridgeConfident,
      isFocusLink: focusId !== null && (e.source === focusId || e.target === focusId),
    }));
    return { nodes: graphNodes, links };
  }, [mergedNodes, mergedEdges, focusId]);

  const handleNodeClick = useCallback(
    (node: NodeObject<CanvasNode>) => {
      const personId = Number(node.id);
      if (!Number.isFinite(personId)) return;
      // Open the acquisition panel so users can choose an artist or a single album.
      restored.current = `${streamKey}:${personId}`;
      // The canvas callback can run outside React; commit anchors before even an
      // immediately resolved cached expansion can merge and prune the field.
      flushSync(() => {
        setSelectedPerson({ personId, displayName: node.name, owned: Boolean(node.owned) });
        setPendingWalk({ from: requestedFocus, to: personId });
        setBreadcrumbs(prev => prev.at(-1)?.personId === personId ? prev : [...prev, { personId, displayName: node.name }]);
      });
      onFocusChange?.(personId);
      // Expand IN PLACE: fetch this node's collaborators and MERGE them into the
      // current field (the graph grows outward, keeping everything already on
      // screen), rather than replacing the view. This is the "wander down a path"
      // model — the throughline stays visible instead of jarringly redrawing.
      void expandMore(personId);
    },
    [expandMore, onFocusChange, mergedNodes, streamKey, requestedFocus],
  );

  /**
   * Expand a person chosen from the PathFinder chain into the field. Mirrors a
   * node click (breadcrumb + in-place expand) without opening the panel.
   */
  const handleSelectPerson = useCallback(
    (personId: number) => {
      if (!Number.isFinite(personId)) return;
      const node = mergedNodes.find(person => person.personId === personId);
      restored.current = `${streamKey}:${personId}`;
      flushSync(() => {
        setSelectedPerson({ personId, displayName: node?.displayName || `Person ${personId}`, owned: node?.owned ?? false });
        setPendingWalk({ from: requestedFocus, to: personId });
        setBreadcrumbs(prev => prev.at(-1)?.personId === personId ? prev : [...prev, { personId, displayName: node?.displayName || `Person ${personId}` }]);
      });
      onFocusChange?.(personId);
      // Expand a path hop into the current field (accumulate), same as a node click.
      void expandMore(personId);
    },
    [expandMore, onFocusChange, mergedNodes, streamKey, requestedFocus],
  );

  /** Custom node paint: genre fill, prominence radius, owned ring, label. */
  const paintNode = useCallback(
    (node: NodeObject<CanvasNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      // Hide-hotness collapses the prominence size channel to a uniform radius.
      const radius = nodeRadius(node.size, { hideHotness });

      // Genre highlight dims every node whose genre != the highlighted one, so a
      // single genre can be traced across the dense field (client-side only).
      ctx.save();
      ctx.globalAlpha = genreHighlightAlpha(node.genre, creditSource === 'live' ? null : genreHighlight);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = genreColor(node.genre);
      ctx.fill();

      const ring = ownedRingStyle(node.owned);
      if (ring) {
        ctx.lineWidth = ring.width;
        ctx.strokeStyle = ring.stroke;
        ctx.stroke();
      }

      // Draw a bright red outer ring to distinguish the current focus in dense graphs.
      if (node.isFocus) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 2, 0, 2 * Math.PI);
        ctx.lineWidth = 3;
        ctx.strokeStyle = FOCUS_NODE_COLOR;
        ctx.stroke();
      }

      // Labels only once zoomed in enough to be legible, to keep the dense field
      // readable when zoomed out.
      if (globalScale >= 1.5) {
        const fontSize = 12 / globalScale;
        ctx.font = `${fontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = labelColor;
        ctx.fillText(node.name, x, y + radius + 1);
      }

      ctx.restore();
    },
    [hideHotness, genreHighlight, labelColor, creditSource],
  );

  return (
    <div className="flex min-w-0 flex-col gap-3 lg:flex-row">
      <div className="min-w-0 space-y-2 lg:w-72 lg:shrink-0">
        <details className="border bg-background" open><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium"><ChevronRight className="disclosure-chevron h-4 w-4 shrink-0" aria-hidden="true" />Graph controls and legend</summary>
        <div className="pointer-events-auto">
          <ConstellationControls
            creditSource={creditSource}
            onRoleMaskChange={setRoleMask}
            onHideHotnessChange={setHideHotness}
            onGenreHighlightChange={setGenreHighlight}
          />
        </div>
        </details>
        <details className="border bg-background"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium"><ChevronRight className="disclosure-chevron h-4 w-4 shrink-0" aria-hidden="true" />Find a collaboration path</summary>
          <PathFinder actorId={actorId} initialFrom={pathFrom} initialTo={pathTo} initialMode={pathMode} onSelectPerson={handleSelectPerson} names={names} onPathChange={onPathChange} />
        </details>
      </div>
      <div ref={canvasContainer} className="relative min-h-[420px] min-w-0 shrink-0 overflow-hidden border lg:flex-1" style={{ height: '70vh' }}>

      {breadcrumbs.length > 0 && (
        <nav
          aria-label="Constellation trail"
          data-testid="constellation-breadcrumbs"
          className="absolute left-2 top-2 z-10 flex max-w-full flex-wrap items-center gap-1 rounded-container bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
        >
          {breadcrumbs.map((crumb, i) => (
            <span key={`${crumb.personId}-${i}`} className="flex items-center gap-1">
              {i > 0 && <span aria-hidden="true">/</span>}
              <button
                type="button"
                className="min-h-11 rounded px-1 hover:text-foreground"
                onClick={() => handleSelectPerson(crumb.personId)}
              >
                {crumb.displayName}
              </button>
            </span>
          ))}
        </nav>
      )}

      {availability && <div className="absolute bottom-2 left-2 right-2 z-10 bg-background/95 px-3 text-sm">
        <ResultState kind="partial-results" message={availability.status === 'budget-exhausted'
          ? 'Daily Discogs budget used; showing cached collaborators only. Resets 00:00 UTC'
          : availability.detail || 'Collaborator source is unavailable. Please retry.'}
          action={availability.status === 'source-unavailable' ? <button type="button" className="min-h-11 text-link underline" onClick={() => void expandMore(availability.focusId)}>Retry</button> : undefined} />
      </div>}

      {error && (
        <div
          role="alert"
          data-testid="constellation-error"
          className="absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-container bg-destructive/90 px-3 py-1.5 text-xs text-destructive-foreground"
        >
          {error}
        </div>
      )}

      {loading && (
        <div
          data-testid="constellation-loading"
          className="absolute bottom-2 right-2 z-10 flex items-center gap-2 rounded-container bg-background/80 px-2 py-1 text-xs text-muted-foreground backdrop-blur"
        >
          <span className="h-3 w-3 animate-spin rounded-full border-b-2 border-primary" />
          Loading…
        </div>
      )}

      <ForceGraph2D
        width={canvasSize.width}
        height={canvasSize.height}
        graphData={graphData}
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          const x = node.x ?? 0;
          const y = node.y ?? 0;
          ctx.beginPath();
          ctx.arc(x, y, nodeRadius(node.size, { hideHotness }), 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        onNodeClick={handleNodeClick}
        linkWidth={(link) => edgeWidth((link as CanvasLink).weight)}
        linkColor={(link) => {
          const l = link as CanvasLink;
          return edgeColor({ bridge: l.bridge, bridgeConfident: l.bridgeConfident }, l.isFocusLink);
        }}
      />

      <PersonPanel
        actorId={actorId}
        credits={selectedPerson && <><h3 className="font-semibold">Credited connections</h3><ul className="divide-y">{mergedEdges.filter(edge => edge.source === selectedPerson.personId || edge.target === selectedPerson.personId).map(edge => <li key={`${edge.source}-${edge.target}`} className="space-y-1 py-2">
          <p>{names.get(edge.source === selectedPerson.personId ? edge.target : edge.source) || 'Collaborator'}</p>
          {(Object.keys(ROLE_BITS) as BaseRole[]).filter(role => (edge.roleBitmask & ROLE_BITS[role]) !== 0).length > 0 && <p>{(Object.keys(ROLE_BITS) as BaseRole[]).filter(role => (edge.roleBitmask & ROLE_BITS[role]) !== 0).map(role => ROLE_LABELS[role]).join(' · ')}</p>}
          {edge.sharedMasterCount !== undefined && <p className="font-mono">{edge.sharedMasterCount} shared releases</p>}
          {edge.sampleMasterId != null && <a className="inline-flex min-h-11 items-center text-link underline" href={`https://www.discogs.com/master/${edge.sampleMasterId}`} target="_blank" rel="noopener noreferrer">Shared release on Discogs</a>}
        </li>)}</ul></>}
        personId={selectedPerson?.personId ?? null}
        displayName={selectedPerson?.displayName}
        owned={selectedPerson?.owned}
        onClose={() => setSelectedPerson(null)}
      />
      </div>
      <details className="border bg-background p-3 lg:max-w-64"><summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm"><ChevronRight className="disclosure-chevron h-4 w-4 shrink-0" aria-hidden="true" />People in this field</summary><ul>{mergedNodes.map(node => <li key={node.personId}><button type="button" className="min-h-11 max-w-full break-words text-left text-sm text-link" onClick={() => handleSelectPerson(node.personId)}>{node.displayName || `Person ${node.personId}`}</button></li>)}</ul></details>
    </div>
  );
}

export default ConstellationView;
