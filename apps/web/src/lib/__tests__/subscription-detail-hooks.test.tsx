import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useSubscriptionResults,
  useToggleSubscription,
  useApproveResult,
  RESULTS_PAGE_SIZE,
  queryKeys,
  type SubscriptionResultsPage,
} from '../hooks';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
}));

import { api } from '../api';

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return Wrapper;
};

const page = (results: SubscriptionResultsPage['results']): SubscriptionResultsPage => ({
  results,
  total: results.length,
  limit: RESULTS_PAGE_SIZE,
  offset: 0,
  statusCounts: { pending: results.length },
});

describe('useSubscriptionResults', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests the right page/status params', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ data: page([]), error: null, status: 200 });
    const qc = createClient();
    const { result } = renderHook(() => useSubscriptionResults(7, 'pending', 2), {
      wrapper: createWrapper(qc),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith(
      `/api/subscriptions/7/results?limit=${RESULTS_PAGE_SIZE}&offset=${2 * RESULTS_PAGE_SIZE}&status=pending`,
      { signal: expect.any(AbortSignal) }
    );
  });
});

describe('useApproveResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates the confirmed row in cached inactive pages', async () => {
    const qc = createClient();
    const cached = page([
      { id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' },
      { id: 2, itemType: 'artist', name: 'B', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' },
    ]);
    qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), cached);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, outcome: 'added', message: 'Confirmed' }, error: null, status: 200 });

    const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const updated = qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, '', 0));
    expect(updated?.results.find((r) => r.id === 1)?.status).toBe('added');
    expect(updated?.results.find((r) => r.id === 2)?.status).toBe('pending');
  });
});


describe('subscription result scope and acquisition confirmation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('does not carry a previous subscription or status into a new scope', async () => {
    const qc = createClient();
    vi.mocked(api.get).mockResolvedValueOnce({ data: page([{ id: 1, itemType: 'artist', name: 'Private A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' }]), error: null, status: 200 });
    const { result, rerender } = renderHook(({ id, status }) => useSubscriptionResults(id, status, 0), { initialProps: { id: 7, status: '' }, wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    rerender({ id: 8, status: 'added' });
    expect(result.current.data).toBeUndefined();
  });
  it('retains successful pages only while paging the same subscription and filter', async () => {
    const qc = createClient();
    vi.mocked(api.get).mockResolvedValueOnce({ data: page([]), error: null, status: 200 });
    const { result, rerender } = renderHook(({ number }) => useSubscriptionResults(7, 'pending', number), { initialProps: { number: 0 }, wrapper: createWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    rerender({ number: 1 });
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data?.offset).toBe(0);
  });
  it('rejects a successful HTTP response without a confirmed provider outcome', async () => {
    const qc = createClient();
    qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), page([{ id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' }]));
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true }, error: null, status: 200 });
    const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
    act(() => result.current.mutate(1));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, '', 0))?.results[0].status).toBe('pending');
  });
  it('preserves the result ID and selected MBID in an approval', async () => {
    const qc = createClient();
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, outcome: 'already-in-library', message: 'Confirmed' }, error: null, status: 200 });
    const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
    act(() => result.current.mutate({ resultId: 12, mbid: '11111111-1111-4111-8111-111111111111' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.post).toHaveBeenCalledWith('/api/subscriptions/7/results/12/approve', { mbid: '11111111-1111-4111-8111-111111111111' }, { timeoutMs: 65000 });
  });
  it('removes confirmed rows from the old status filter and adjusts counts', async () => {
    const qc = createClient();
    qc.setQueryData(queryKeys.subscriptionResults(7, 'pending', 0), page([{ id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' }]));
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true, outcome: 'added', message: 'Confirmed' }, error: null, status: 200 });
    const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
    act(() => result.current.mutate(1));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const updated = qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, 'pending', 0));
    expect(updated?.results).toEqual([]);
    expect(updated?.total).toBe(0);
    expect(updated?.statusCounts).toEqual({ pending: 0, added: 1 });
  });
});

describe('pending approval subscription scope', () => {
  beforeEach(() => vi.clearAllMocks());
  it('updates only the originating subscription when the hook changes subscription mid-request', async () => {
    const qc = createClient();
    const cached = page([{ id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' }]);
    qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), cached);
    qc.setQueryData(queryKeys.subscriptionResults(8, '', 0), cached);
    let resolve!: (value: { data: { success: boolean; outcome: string; message: string }; error: null; status: number }) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const { result, rerender } = renderHook(({ id }) => useApproveResult(id), { initialProps: { id: 7 }, wrapper: createWrapper(qc) });
    act(() => result.current.mutate(1));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    rerender({ id: 8 });
    await act(async () => resolve({ data: { success: true, outcome: 'added', message: 'Confirmed' }, error: null, status: 200 }));
    await waitFor(() => expect(qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, '', 0))?.results[0].status).toBe('added'));
    expect(qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(8, '', 0))?.results[0].status).toBe('pending');
  });
});

it('does not update a replacement actor cache after an old acquisition resolves', async () => {
  const qc = createClient();
  qc.setQueryData(queryKeys.auth, { user: { id: 7 } });
  const cached = page([{ id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' }]);
  qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), cached);
  let resolve!: (value: { data: { success: boolean; outcome: string; message: string }; error: null; status: number }) => void;
  vi.mocked(api.post).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
  act(() => result.current.mutate(1));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  qc.setQueryData(queryKeys.auth, { user: { id: 8 } });
  qc.removeQueries({ queryKey: ['subscriptions'] });
  qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), cached);
  await act(async () => resolve({ data: { success: true, outcome: 'added', message: 'Confirmed' }, error: null, status: 200 }));
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, '', 0))?.results[0].status).toBe('pending');
});

it('does not automatically repeat an acquisition when the global mutation retry is enabled', async () => {
  vi.clearAllMocks();
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: 1, retryDelay: 0 }, queries: { retry: false } } });
  vi.mocked(api.post).mockResolvedValue({ data: null, error: 'Acquisition is in progress', code: 'IN_PROGRESS', status: 409 });
  const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
  act(() => result.current.mutate(1));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(result.current.error).toMatchObject({ code: 'IN_PROGRESS', status: 409 });
});


describe('subscription schedule route contract', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([false, true])('uses the mounted PUT endpoint to set isActive=%s and refreshes subscriptions', async isActive => {
    const qc = createClient();
    qc.setQueryData(queryKeys.subscriptions, []);
    vi.mocked(api.put).mockResolvedValue({ data: { subscription: { id: 11, isActive } }, error: null, status: 200 });
    const { result } = renderHook(() => useToggleSubscription(), { wrapper: createWrapper(qc) });
    act(() => result.current.mutate({ id: 11, isActive }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.put).toHaveBeenCalledExactlyOnceWith('/api/subscriptions/11', { isActive });
    expect(api.patch).not.toHaveBeenCalled();
    expect(qc.getQueryState(queryKeys.subscriptions)?.isInvalidated).toBe(true);
  });
});
