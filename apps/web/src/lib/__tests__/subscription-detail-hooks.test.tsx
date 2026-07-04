import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import {
  useSubscriptionResults,
  useApproveResult,
  RESULTS_PAGE_SIZE,
  queryKeys,
  type SubscriptionResultsPage,
} from '../hooks';

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn() },
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
      `/api/subscriptions/7/results?limit=${RESULTS_PAGE_SIZE}&offset=${2 * RESULTS_PAGE_SIZE}&status=pending`
    );
  });
});

describe('useApproveResult', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flips the row status in the cached page without refetching it', async () => {
    const qc = createClient();
    const cached = page([
      { id: 1, itemType: 'artist', name: 'A', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' },
      { id: 2, itemType: 'artist', name: 'B', artistName: null, mbid: null, status: 'pending', skipReason: null, createdAt: '' },
    ]);
    qc.setQueryData(queryKeys.subscriptionResults(7, '', 0), cached);
    vi.mocked(api.post).mockResolvedValueOnce({ data: { success: true }, error: null, status: 200 });

    const { result } = renderHook(() => useApproveResult(7), { wrapper: createWrapper(qc) });
    result.current.mutate(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const updated = qc.getQueryData<SubscriptionResultsPage>(queryKeys.subscriptionResults(7, '', 0));
    expect(updated?.results.find((r) => r.id === 1)?.status).toBe('added');
    expect(updated?.results.find((r) => r.id === 2)?.status).toBe('pending');
  });
});
