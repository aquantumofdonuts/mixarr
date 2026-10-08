import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useFeed, useApproveFeedItem, useDismissFeedItem, useRestoreDecision } from '../hooks';

// Mock api module
vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '../api';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: { 
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return Wrapper;
};

describe('useFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches feed items', async () => {
    const mockResponse = {
      data: {
        items: [{ id: 'feed-1', artistName: 'Test Artist', artistMbid: null, imageUrl: null, score: 10, subscriptionCount: 1, sourceCount: 1, sources: ['spotify'], createdAt: '2026-01-01' }],
        stats: { pending: 5, addedToday: 2 },
        total: 1,
      },
      error: null,
      status: 200,
    };
    vi.mocked(api.get).mockResolvedValueOnce(mockResponse);

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.pages[0].items).toHaveLength(1);
    expect(result.current.data?.pages[0].stats.pending).toBe(5);
  });

  it('handles fetch error', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: null, error: 'Network error', status: 500 });

    const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Network error');
  });
});

describe('useApproveFeedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls approve endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist', outcome: { artistMbid: 'a', state: 'added', message: 'Confirmed' } },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useApproveFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-123');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-123/approve', undefined, { timeoutMs: 70_000 });
  });

  it('throws on error', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: null,
      error: 'Failed to approve',
      status: 500,
    });

    const { result } = renderHook(() => useApproveFeedItem(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync('feed-123')).rejects.toThrow('Failed to approve');
  });
});

describe('useDismissFeedItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls dismiss endpoint', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: { artistName: 'Test Artist' },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useDismissFeedItem(), { wrapper: createWrapper() });

    await result.current.mutateAsync('feed-456');

    expect(api.post).toHaveBeenCalledWith('/api/feed/feed-456/dismiss');
  });

  it('throws on error', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: null,
      error: 'Dismiss failed',
      status: 500,
    });

    const { result } = renderHook(() => useDismissFeedItem(), { wrapper: createWrapper() });

    await expect(result.current.mutateAsync('feed-456')).rejects.toThrow('Dismiss failed');
  });
});

describe('confirmed acquisition cache behavior', () => {
  it('keeps every affected row adding until confirmation without changing counts, retains uncertain results for retry', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const page = { items: [{ id: 'feed-1', status: 'pending' }, { id: 'feed-2', status: 'pending' }], stats: { pending: 2, addedToday: 0 }, total: 2 };
    for (const limit of [20, 50]) client.setQueryData(['feed', limit], { pages: [page], pageParams: [0] });
    let complete!: (value: Awaited<ReturnType<typeof api.post>>) => void;
    vi.mocked(api.post).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useApproveFeedItem(), { wrapper });
    const pending = result.current.mutateAsync('feed-1');
    await waitFor(() => expect(complete).toBeTypeOf('function'));
    for (const limit of [20, 50]) {
      const cache = client.getQueryData<{ pages: typeof page[] }>(['feed', limit])!;
      expect(cache.pages[0].items.map(item => item.status)).toEqual(['adding', 'pending']);
      expect(cache.pages[0].stats).toEqual({ pending: 2, addedToday: 0 });
    }
    complete({ data: { artistName: 'Artist', outcome: { artistMbid: 'a', state: 'uncertain', message: 'Retry checks membership' } }, error: null, status: 200 });
    await pending;
    expect(client.getQueryData<{ pages: typeof page[] }>(['feed', 20])!.pages[0].items[0].status).toBe('failed');
    client.clear();
  });
});

describe('server decision restoration', () => {
  it.each(['feed', 'review'] as const)('restores %s immediately and invalidates its actual cache scope', async kind => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(api.post).mockResolvedValueOnce({ data: { restoredIds: [1, 2] }, error: null, status: 200 });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRestoreDecision(kind), { wrapper });
    expect(await result.current.mutateAsync('opaque-signed-token')).toEqual({ restoredIds: [1, 2] });
    expect(api.post).toHaveBeenCalledWith(kind === 'feed' ? '/api/feed/restore' : '/api/imports/review/restore', { undoToken: 'opaque-signed-token' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: [kind === 'feed' ? 'feed' : 'review'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard', 'stats'] });
    client.clear();
  });
});

describe('rejected decision restoration', () => {
  it('leaves cached scopes untouched when the token is expired or conflicts', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(api.post).mockResolvedValueOnce({ data: null, error: 'Decision restoration has expired', status: 409 });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useRestoreDecision('feed'), { wrapper });
    await expect(result.current.mutateAsync('expired-token')).rejects.toThrow('expired');
    expect(invalidate).not.toHaveBeenCalled(); client.clear();
  });
});

it('stops pagination on an empty page even when the server total is larger', async () => {
  vi.mocked(api.get).mockResolvedValueOnce({ data: { items: [], stats: { pending: 5, addedToday: 0 }, total: 5 }, error: null, status: 200 });
  const { result } = renderHook(() => useFeed(), { wrapper: createWrapper() });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.hasNextPage).toBe(false);
});

it('refetches the real active feed after signed Undo restoration', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let dismissed = false;
  vi.mocked(api.get).mockImplementation(async () => ({ data: { items: dismissed ? [] : [{ id: 'feed-1', artistName: 'Restored artist' }], total: dismissed ? 0 : 1, stats: { pending: dismissed ? 0 : 1, addedToday: 0 } }, error: null, status: 200 }));
  vi.mocked(api.post).mockImplementation(async (path) => { dismissed = path !== '/api/feed/restore'; return { data: { artistName: 'Restored artist', undoToken: 'signed', undoExpiresAt: new Date(Date.now() + 120000).toISOString(), restoredIds: [1] }, error: null, status: 200 }; });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => ({ feed: useFeed(), dismiss: useDismissFeedItem(), restore: useRestoreDecision('feed') }), { wrapper });
  await waitFor(() => expect(result.current.feed.data?.pages[0].items).toHaveLength(1));
  const decision = await result.current.dismiss.mutateAsync('feed-1');
  await waitFor(() => expect(result.current.feed.data?.pages[0].items).toHaveLength(0));
  await result.current.restore.mutateAsync(decision.undoToken);
  await waitFor(() => expect(result.current.feed.data?.pages[0].items[0].artistName).toBe('Restored artist'));
  client.clear();
});

it('removes only a confirmed dismissed row from each cached feed while keeping unrelated acquisition state', async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  client.setQueryData(['feed', 50], { pages: [{ items: [{ id: 'feed-1', status: 'pending' }, { id: 'feed-2', status: 'adding' }], total: 3, stats: { pending: 3, addedToday: 0 } }, { items: [{ id: 'feed-3', status: 'pending' }], total: 3, stats: { pending: 3, addedToday: 0 } }], pageParams: [0, 2] });
  vi.mocked(api.post).mockResolvedValueOnce({ data: { artistName: 'Dismissed artist', undoToken: 'signed', undoExpiresAt: new Date(Date.now() + 120000).toISOString() }, error: null, status: 200 });
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useDismissFeedItem(), { wrapper });
  await result.current.mutateAsync('feed-1');
  const cache = client.getQueryData<{ pages: { items: { id: string; status: string }[]; total: number }[] }>(['feed', 50])!;
  expect(cache.pages.flatMap(page => page.items)).toEqual([{ id: 'feed-2', status: 'adding' }, { id: 'feed-3', status: 'pending' }]);
  expect(cache.pages.map(page => page.total)).toEqual([2, 2]); client.clear();
});
