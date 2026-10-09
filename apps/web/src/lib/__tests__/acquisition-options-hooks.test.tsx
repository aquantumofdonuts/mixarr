import React from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api', () => ({ api: { post: vi.fn(), put: vi.fn() } }));
import { api } from '../api';
import { useApproveFeedItem, useUpdateReviewItem, useBulkUpdateReview } from '../hooks';
const options = { qualityProfileId: 9, metadataProfileId: 8, rootFolderPath: '/archive', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none', mbid: '11111111-1111-4111-8111-111111111111' };
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } } }); });
afterEach(() => { cleanup(); client.clear(); });
describe('effective options at original acquisition mutation boundaries', () => {
  it.each(['feed', 'review', 'review-bulk'])('passes options through %s and does not inherit automatic acquisition retries', async kind => {
    vi.mocked(api.post).mockResolvedValue({ data: null, error: 'Provider offline', status: 503 });
    vi.mocked(api.put).mockResolvedValue({ data: null, error: 'Provider offline', status: 503 });
    const { result } = renderHook(() => ({ feed: useApproveFeedItem(), review: useUpdateReviewItem(), bulk: useBulkUpdateReview() }), { wrapper });
    await act(async () => {
      const request = kind === 'feed' ? result.current.feed.mutateAsync({ id: 'feed-1-2', options }) : kind === 'review' ? result.current.review.mutateAsync({ id: 7, status: 'approved', options }) : result.current.bulk.mutateAsync({ ids: [7, 8], status: 'approved', options });
      await expect(request).rejects.toThrow('Provider offline');
    });
    const transport = kind === 'review' ? api.put : api.post;
    expect(transport).toHaveBeenCalledTimes(1);
    if (kind === 'feed') expect(transport).toHaveBeenCalledWith('/api/feed/feed-1-2/approve', options, { timeoutMs: 70_000 });
    if (kind === 'review') expect(transport).toHaveBeenCalledWith('/api/imports/review/7', { status: 'approved', ...options });
    if (kind === 'review-bulk') expect(transport).toHaveBeenCalledWith('/api/imports/review/bulk', { ids: [7, 8], status: 'approved', ...options });
  });
  it('ignores an original actor feed confirmation after ownership changes', async () => {
    client.setQueryData(['auth'], { user: { id: 1 } });
    const row = { id: 'feed-1-2', artistName: 'Actor two artist', status: 'pending' };
    let finish!: (value: any) => void;
    vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useApproveFeedItem(), { wrapper });
    let pending!: Promise<unknown>;
    await act(async () => { pending = result.current.mutateAsync({ id: row.id, options }); await Promise.resolve(); });
    client.setQueryData(['auth'], { user: { id: 2 } });
    client.setQueryData(['feed', 'current'], { pages: [{ items: [row], total: 1 }], pageParams: [0] });
    await act(async () => { finish({ data: { artistName: 'Actor one artist', outcome: { state: 'added' } }, error: null }); await pending; });
    expect(client.getQueryData<any>(['feed', 'current']).pages[0].items).toEqual([row]);
  });
});
