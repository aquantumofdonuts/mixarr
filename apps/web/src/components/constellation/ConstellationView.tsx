'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import dynamic from 'next/dynamic';
import type { ForceGraphProps, NodeObject } from 'react-force-graph-2d';
import {
  useConstellation,
  mergeNodes,
  mergeEdges,
  type ConstellationSeed,
} from '@/hooks/useConstellation';
import { useFrontierStream } from '@/hooks/useFrontierStream';
import type { GraphNode, GraphEdge, StreamPayload } from '@/types/constellation';
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

/**
 * A single visited focus person in the re-center walk.
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
   * The artist the graph is centred on, or `null` for "no graph loaded". The
   * component owns the data layer itself via {@link useConstellation}; clicking a
   * node re-centers internally (it does not lift the seed back to the parent).
   */
  seed: ConstellationSeed;
}

const EMPTY_STREAM: { nodes: GraphNode[]; edges: GraphEdge[] } = { nodes: [], edges: [] };

/**
 * The LivePlasma-style dense re-centering field. Node color = genre, radius =
 * prominence, gold ring = owned, edge width = tie strength, warm edge glow =
 * confident bridge. Clicking a node re-centers the field on that person and
 * records the hop in a breadcrumb trail; background-expanded nodes stream in via
 * the frontier SSE and are merged into the field.
 */
export function ConstellationView({ seed }: ConstellationViewProps) {
  // Controls-bar state (Design §5). `roleMask` is the SERVER-SIDE role filter —
  // it is passed into the data hook so a change re-seeds through the backend's
  // filtered `subgraph`. `hideHotness` and `genreHighlight` are CLIENT-SIDE paint
  // adjustments only (no re-fetch).
  const [roleMask, setRoleMask] = useState<number | undefined>(undefined);
  const [hideHotness, setHideHotness] = useState(false);
  const [genreHighlight, setGenreHighlight] = useState<string | null>(null);

  const { nodes, edges, focusId, streamToken, loading, error, recenter } =
    useConstellation(seed, { roleMask });

  // Nodes/edges pushed by the background-expand SSE stream, merged locally on top
  // of the hook's seed subgraph. Reset whenever the stream token (generation)
  // changes, since a re-center supersedes any previously streamed frontier.
  const [streamed, setStreamed] = useState(EMPTY_STREAM);
  const streamKey = streamToken ? `${streamToken.id}:${streamToken.generation}` : null;
  useEffect(() => {
    setStreamed(EMPTY_STREAM);
  }, [streamKey]);

  // The breadcrumb trail of visited focus persons (the re-center walk).
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([]);

  // The person whose acquisition panel is open. Selecting a node opens this (the
  // acquisition grain: the node action lands the user in the panel where they
  // pick artist-vs-album, rather than blind-subscribing).
  const [selectedPerson, setSelectedPerson] = useState<
    (Breadcrumb & { owned: boolean }) | null
  >(null);

  const onFrame = useCallback((payload: StreamPayload) => {
    const incomingNodes = Array.isArray(payload.nodes) ? (payload.nodes as GraphNode[]) : [];
    const incomingEdges = Array.isArray(payload.edges) ? (payload.edges as GraphEdge[]) : [];
    if (incomingNodes.length === 0 && incomingEdges.length === 0) return;
    setStreamed((prev) => ({
      nodes: mergeNodes(prev.nodes, incomingNodes),
      edges: mergeEdges(prev.edges, incomingEdges),
    }));
  }, []);

  useFrontierStream(streamToken, onFrame);

  const mergedNodes = useMemo(() => mergeNodes(nodes, streamed.nodes), [nodes, streamed.nodes]);
  const mergedEdges = useMemo(() => mergeEdges(edges, streamed.edges), [edges, streamed.edges]);

  const graphData = useMemo(
    () => ({
      nodes: mergedNodes.map<CanvasNode>((n) => ({
        id: n.personId,
        name: n.displayName,
        genre: n.genre,
        size: n.size,
        owned: n.owned,
        isFocus: n.personId === focusId,
      })),
      links: mergedEdges.map<CanvasLink>((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
        bridge: e.bridge,
        bridgeConfident: e.bridgeConfident,
        isFocusLink: focusId !== null && (e.source === focusId || e.target === focusId),
      })),
    }),
    [mergedNodes, mergedEdges, focusId],
  );

  const handleNodeClick = useCallback(
    (node: NodeObject<CanvasNode>) => {
      const personId = Number(node.id);
      if (!Number.isFinite(personId)) return;
      // Selecting a node ALWAYS opens its acquisition panel (the grain fix): the
      // user chooses artist-vs-album there rather than blind-subscribing.
      setSelectedPerson({ personId, displayName: node.name, owned: Boolean(node.owned) });
      // Clicking the node we're already centred on only opens the panel — no
      // redundant re-seed, no breadcrumb.
      if (personId === focusId) return;
      setBreadcrumbs((prev) => {
        // Collapse a no-op click on the person we're already centred on.
        if (prev.length > 0 && prev[prev.length - 1].personId === personId) return prev;
        return [...prev, { personId, displayName: node.name }];
      });
      // Re-center: the hook re-seeds and the force lib re-simulates on the new
      // graphData, animating the field into its new layout.
      void recenter(personId);
    },
    [recenter, focusId],
  );

  /**
   * Recenter the field on a person chosen from the PathFinder chain. Mirrors a
   * node click's re-center (breadcrumb + re-seed) without opening the panel.
   */
  const handleSelectPerson = useCallback(
    (personId: number) => {
      if (!Number.isFinite(personId) || personId === focusId) return;
      setBreadcrumbs((prev) => {
        if (prev.length > 0 && prev[prev.length - 1].personId === personId) return prev;
        return [...prev, { personId, displayName: String(personId) }];
      });
      void recenter(personId);
    },
    [recenter, focusId],
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
      ctx.globalAlpha = genreHighlightAlpha(node.genre, genreHighlight);

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

      // Focus emphasis: the design's "red center at the focus" — a bright red
      // outer ring so the currently-centred node stands out of the dense field.
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
        ctx.fillStyle = 'rgba(230, 230, 235, 0.9)';
        ctx.fillText(node.name, x, y + radius + 1);
      }

      ctx.restore();
    },
    [hideHotness, genreHighlight],
  );

  return (
    <div className="relative h-full w-full">
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex max-h-[calc(100%-1rem)] w-64 max-w-[70%] flex-col gap-2 overflow-auto">
        <div className="pointer-events-auto">
          <ConstellationControls
            onRoleMaskChange={setRoleMask}
            onHideHotnessChange={setHideHotness}
            onGenreHighlightChange={setGenreHighlight}
          />
        </div>
        <div className="pointer-events-auto">
          <PathFinder onSelectPerson={handleSelectPerson} />
        </div>
      </div>

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
                className="rounded px-1 hover:text-foreground"
                onClick={() => recenter(crumb.personId)}
              >
                {crumb.displayName}
              </button>
            </span>
          ))}
        </nav>
      )}

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
        personId={selectedPerson?.personId ?? null}
        displayName={selectedPerson?.displayName}
        owned={selectedPerson?.owned}
        onClose={() => setSelectedPerson(null)}
      />
    </div>
  );
}

export default ConstellationView;
