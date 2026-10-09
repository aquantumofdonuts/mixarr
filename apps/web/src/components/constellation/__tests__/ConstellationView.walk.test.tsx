import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GraphNode, ExpandResponse, SeedResponse } from '@/types/constellation';

// Keep the real View and data hook together; only the canvas renderer and
// unrelated panels are replaced so the bounded merge is exercised end to end.
const canvas = vi.hoisted(() => ({ props: null as any }));
vi.mock('next/dynamic', () => ({ default: () => (props: any) => { canvas.props = props; return null; } }));
vi.mock('@/hooks/useFrontierStream', () => ({ useFrontierStream: vi.fn() }));
vi.mock('@/components/constellation/PersonPanel', () => ({ PersonPanel: () => null }));
vi.mock('@/components/constellation/PathFinder', () => ({ PathFinder: () => null }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn() } }));

import { api } from '@/lib/api';
import { ConstellationView } from '../ConstellationView';

const node = (personId: number): GraphNode => ({ personId, displayName: `Person ${personId}`, genre: null, size: 1, owned: false });
const retained = (): number[] => canvas.props.graphData.nodes.map((person: any) => person.id);
const initial = [42, 9, 1, 7, ...Array.from({ length: 296 }, (_, index) => 1000 + index)].map(node);
const seed = { type: 'artist' as const, id: '1' };

beforeEach(() => {
  vi.clearAllMocks(); canvas.props = null;
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  let seedCount = 0;
  vi.mocked(api.get).mockImplementation(async endpoint => {
    const focusId = endpoint.includes('/expand/42?') ? 42 : 7;
    const data: SeedResponse | ExpandResponse = endpoint.includes('/seed')
      ? { focusId: 1, creditSource: 'index', streamToken: { id: `t-${++seedCount}`, generation: 1 }, subgraph: { focusId: 1, nodes: initial, edges: [] } }
      : { personId: focusId, creditSource: 'index', enqueued: true, subgraph: { focusId, nodes: focusId === 7 ? [node(2000)] : [], edges: [] } };
    return { data, error: null, status: 200 } as any;
  });
});

afterEach(() => vi.unstubAllGlobals());

it('protects the actual local walking focus while its URL push is pending', async () => {
  const navigate = vi.fn();
  render(<ConstellationView seed={seed} requestedFocus={42} onFocusChange={navigate} />);
  await waitFor(() => expect(retained()).toHaveLength(300)); await act(async () => {});
  await act(async () => { canvas.props.onNodeClick(canvas.props.graphData.nodes.find((person: any) => person.id === 7)); });
  expect(navigate).toHaveBeenLastCalledWith(7);
  expect(retained()).toHaveLength(300); expect(retained()).toContain(7); expect(retained()).not.toContain(42); expect(retained()).toContain(9);
  expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.includes('/expand/42?'))).toHaveLength(1);
});

it('returns focus ownership to genuine Back and Forward after the local URL push commits', async () => {
  const navigate = vi.fn(); const { rerender } = render(<ConstellationView seed={seed} requestedFocus={42} onFocusChange={navigate} />);
  await waitFor(() => expect(retained()).toHaveLength(300)); await act(async () => {});
  await act(async () => { canvas.props.onNodeClick(canvas.props.graphData.nodes.find((person: any) => person.id === 7)); });
  rerender(<ConstellationView seed={seed} requestedFocus={7} onFocusChange={navigate} />);
  // Back restores the now-pruned person and protects it through the next merge.
  vi.mocked(api.get).mockResolvedValueOnce({ data: { personId: 42, creditSource: 'index', enqueued: true, subgraph: { focusId: 42, nodes: [node(42)], edges: [] } }, error: null, status: 200 } as any);
  rerender(<ConstellationView seed={seed} requestedFocus={42} onFocusChange={navigate} />);
  await waitFor(() => expect(retained()).toContain(42)); expect(retained()).toHaveLength(300);
  expect(retained()).not.toContain(9);
  rerender(<ConstellationView seed={seed} requestedFocus={7} onFocusChange={navigate} />);
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.includes('/expand/7?'))).toHaveLength(2));
  expect(retained()).toContain(7); expect(retained()).toContain(1);
});

it('a different incoming URL overrides an uncommitted local walk and an absent URL focus returns to the seed', async () => {
  const navigate = vi.fn(); const { rerender } = render(<ConstellationView seed={seed} requestedFocus={42} onFocusChange={navigate} />);
  await waitFor(() => expect(retained()).toHaveLength(300)); await act(async () => {});
  await act(async () => { canvas.props.onNodeClick(canvas.props.graphData.nodes.find((person: any) => person.id === 7)); });
  vi.mocked(api.get).mockResolvedValueOnce({ data: { personId: 9, creditSource: 'index', enqueued: true, subgraph: { focusId: 9, nodes: [node(3000)], edges: [] } }, error: null, status: 200 } as any);
  rerender(<ConstellationView seed={seed} requestedFocus={9} onFocusChange={navigate} />);
  await waitFor(() => expect(retained()).toContain(3000)); expect(retained()).toContain(9);
  rerender(<ConstellationView seed={seed} requestedFocus={null} onFocusChange={navigate} />);
  await waitFor(() => expect(navigate).toHaveBeenLastCalledWith(1, true));
  expect(retained()).toContain(1); expect(retained()).toHaveLength(300);
});

it('retains the actual pending walking focus through a role re-seed and preserves surviving canvas positions', async () => {
  render(<ConstellationView seed={seed} requestedFocus={42} onFocusChange={vi.fn()} />);
  await waitFor(() => expect(retained()).toHaveLength(300)); await act(async () => {});
  const survivor = canvas.props.graphData.nodes.find((person: any) => person.id === 1); survivor.x = 123; survivor.y = 456;
  await act(async () => { canvas.props.onNodeClick(canvas.props.graphData.nodes.find((person: any) => person.id === 7)); });
  expect(canvas.props.graphData.nodes.find((person: any) => person.id === 1)).toBe(survivor);
  expect(survivor).toMatchObject({ x: 123, y: 456 });
  await userEvent.click(screen.getByRole('checkbox', { name: 'Producer' }));
  await waitFor(() => expect(vi.mocked(api.get).mock.calls.filter(([url]) => url.includes('/expand/7?'))).toHaveLength(2));
  expect(retained()).toContain(7); expect(retained()).not.toContain(42); expect(retained()).toHaveLength(300);
});
