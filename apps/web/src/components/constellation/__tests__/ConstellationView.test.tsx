import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { Mock } from 'vitest';
import type { UseConstellationResult } from '@/hooks/useConstellation';

// ---------------------------------------------------------------------------
// Mock the client-only graph lib + next/dynamic so no real canvas is rendered.
// The mocked ForceGraph captures the props it receives so the test can inspect
// graphData and drive its callbacks (onNodeClick).
// ---------------------------------------------------------------------------
const graphState = vi.hoisted(() => {
  let props: Record<string, unknown> | null = null;
  return {
    set: (p: Record<string, unknown>) => {
      props = p;
    },
    get: () => props,
    reset: () => {
      props = null;
    },
  };
});

vi.mock('react-force-graph-2d', () => ({
  default: (props: Record<string, unknown>) => {
    graphState.set(props);
    return null;
  },
}));

// next/dynamic just returns the (mocked) component synchronously — never invokes
// the real dynamic loader, so the canvas lib is never actually imported.
vi.mock('next/dynamic', () => ({
  default: () => (props: Record<string, unknown>) => {
    graphState.set(props);
    return null;
  },
}));

// Mock the frontier stream to a no-op — its wiring is exercised elsewhere.
vi.mock('@/hooks/useFrontierStream', () => ({
  useFrontierStream: vi.fn(() => ({ connected: true, error: null })),
}));

// Keep the real merge helpers, mock only the data hook.
vi.mock('@/hooks/useConstellation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useConstellation')>();
  return { ...actual, useConstellation: vi.fn() };
});

import { useConstellation } from '@/hooks/useConstellation';
import { useFrontierStream } from '@/hooks/useFrontierStream';
import { ConstellationView } from '../ConstellationView';
import { FOCUS_NODE_COLOR } from '../encoding';
import type { GraphNode, GraphEdge, StreamPayload } from '@/types/constellation';

const mockUseConstellation = useConstellation as unknown as Mock;

/** Grab the `onFrame` callback the component handed to useFrontierStream. */
function latestOnFrame(): (payload: StreamPayload) => void {
  const calls = (useFrontierStream as unknown as Mock).mock.calls;
  return calls[calls.length - 1][1] as (payload: StreamPayload) => void;
}

/** Minimal recording 2D context stub for exercising nodeCanvasObject. */
function makeCtx() {
  const strokeStyles: string[] = [];
  const ctx = {
    _stroke: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillText: vi.fn(),
    get strokeStyle() {
      return this._stroke;
    },
    set strokeStyle(v: string) {
      this._stroke = v;
      strokeStyles.push(v);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokeStyles };
}

const node = (personId: number, over: Partial<GraphNode> = {}): GraphNode => ({
  personId,
  displayName: `Person ${personId}`,
  genre: 'rock',
  size: 10,
  owned: false,
  ...over,
});

const edge = (source: number, target: number, over: Partial<GraphEdge> = {}): GraphEdge => ({
  source,
  target,
  weight: 3,
  bridge: null,
  bridgeConfident: false,
  roleBitmask: 0,
  ...over,
});

function mockResult(over: Partial<UseConstellationResult> = {}): UseConstellationResult {
  return {
    nodes: [node(1), node(2)],
    edges: [edge(1, 2)],
    focusId: 1,
    streamToken: { id: 'tok', generation: 0 },
    loading: false,
    error: null,
    recenter: vi.fn().mockResolvedValue(undefined),
    expandMore: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const graphProps = () => graphState.get() as Record<string, unknown>;
type ClickHandler = (node: { id: number; name: string }, event?: unknown) => void;

describe('ConstellationView', () => {
  beforeEach(() => {
    graphState.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('mounts and renders the (dynamically imported) force graph', () => {
    mockUseConstellation.mockReturnValue(mockResult());
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);
    expect(graphState.get()).not.toBeNull();
  });

  it('passes graphData derived from the hook (nodes + links mapped)', () => {
    mockUseConstellation.mockReturnValue(mockResult());
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const data = graphProps().graphData as {
      nodes: Array<{ id: number; name: string; isFocus: boolean }>;
      links: Array<{ source: number; target: number; isFocusLink: boolean }>;
    };
    expect(data.nodes.map((n) => n.id)).toEqual([1, 2]);
    expect(data.nodes[0].name).toBe('Person 1');
    // focusId=1 -> node 1 is the focus, and the 1->2 edge is a focus link
    expect(data.nodes[0].isFocus).toBe(true);
    expect(data.nodes[1].isFocus).toBe(false);
    expect(data.links).toHaveLength(1);
    expect(data.links[0].isFocusLink).toBe(true);
  });

  it('re-centers and pushes a breadcrumb when a node is clicked', () => {
    const recenter = vi.fn().mockResolvedValue(undefined);
    mockUseConstellation.mockReturnValue(mockResult({ recenter }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const onNodeClick = graphProps().onNodeClick as ClickHandler;
    act(() => {
      onNodeClick({ id: 2, name: 'Person 2' });
    });

    expect(recenter).toHaveBeenCalledWith(2);
    const trail = screen.getByTestId('constellation-breadcrumbs');
    expect(trail).toHaveTextContent('Person 2');
  });

  it('accumulates multiple hops in the breadcrumb trail', () => {
    const recenter = vi.fn().mockResolvedValue(undefined);
    // focusId=1, so hop to 2 then 3 (neither is the current center).
    mockUseConstellation.mockReturnValue(mockResult({ recenter }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const onNodeClick = graphProps().onNodeClick as ClickHandler;
    act(() => onNodeClick({ id: 2, name: 'Person 2' }));
    act(() => onNodeClick({ id: 3, name: 'Person 3' }));

    const trail = screen.getByTestId('constellation-breadcrumbs');
    expect(trail).toHaveTextContent('Person 2');
    expect(trail).toHaveTextContent('Person 3');
    expect(recenter).toHaveBeenCalledTimes(2);
  });

  it('is a no-op when clicking the node that is already the focus', () => {
    const recenter = vi.fn().mockResolvedValue(undefined);
    // focusId=1 -> clicking node 1 must not re-seed or push a breadcrumb.
    mockUseConstellation.mockReturnValue(mockResult({ recenter }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const onNodeClick = graphProps().onNodeClick as ClickHandler;
    act(() => onNodeClick({ id: 1, name: 'Person 1' }));

    expect(recenter).not.toHaveBeenCalled();
    expect(screen.queryByTestId('constellation-breadcrumbs')).not.toBeInTheDocument();
  });

  it('collapses consecutive clicks on the same node to one breadcrumb', () => {
    const recenter = vi.fn().mockResolvedValue(undefined);
    mockUseConstellation.mockReturnValue(mockResult({ recenter }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const onNodeClick = graphProps().onNodeClick as ClickHandler;
    act(() => onNodeClick({ id: 2, name: 'Person 2' }));
    act(() => onNodeClick({ id: 2, name: 'Person 2' }));

    const crumbs = screen.getAllByRole('button', { name: 'Person 2' });
    expect(crumbs).toHaveLength(1);
  });

  it('merges a streamed frame into graphData (frontier SSE seam)', () => {
    mockUseConstellation.mockReturnValue(mockResult());
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    // Before the frame: only the two seed nodes.
    let data = graphProps().graphData as { nodes: Array<{ id: number }> };
    expect(data.nodes.map((n) => n.id)).toEqual([1, 2]);

    // A background-expand frame arrives with a fresh node.
    act(() => {
      latestOnFrame()({ generation: 0, nodes: [node(3)], edges: [] } as unknown as StreamPayload);
    });

    data = graphProps().graphData as { nodes: Array<{ id: number }> };
    expect(data.nodes.map((n) => n.id)).toContain(3);
  });

  it('draws the red focus highlight only for the focus node', () => {
    mockUseConstellation.mockReturnValue(mockResult());
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);

    const paint = graphProps().nodeCanvasObject as (
      node: Record<string, unknown>,
      ctx: CanvasRenderingContext2D,
      scale: number,
    ) => void;

    const focus = makeCtx();
    paint({ id: 1, name: 'Person 1', genre: 'rock', size: 10, owned: false, isFocus: true, x: 0, y: 0 }, focus.ctx, 1);
    expect(focus.strokeStyles).toContain(FOCUS_NODE_COLOR);

    const plain = makeCtx();
    paint({ id: 2, name: 'Person 2', genre: 'rock', size: 10, owned: false, isFocus: false, x: 0, y: 0 }, plain.ctx, 1);
    expect(plain.strokeStyles).not.toContain(FOCUS_NODE_COLOR);
  });

  it('renders the loading state', () => {
    mockUseConstellation.mockReturnValue(mockResult({ loading: true }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);
    expect(screen.getByTestId('constellation-loading')).toBeInTheDocument();
  });

  it('renders the error state', () => {
    mockUseConstellation.mockReturnValue(mockResult({ error: 'Failed to load constellation' }));
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);
    expect(screen.getByTestId('constellation-error')).toHaveTextContent(
      'Failed to load constellation',
    );
  });

  it('provides linkWidth / linkColor accessors to the graph', () => {
    mockUseConstellation.mockReturnValue(mockResult());
    render(<ConstellationView seed={{ type: 'artist', id: 'a1' }} />);
    expect(typeof graphProps().linkWidth).toBe('function');
    expect(typeof graphProps().linkColor).toBe('function');
    expect(typeof graphProps().nodeCanvasObject).toBe('function');
  });
});
