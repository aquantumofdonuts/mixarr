import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const actor = vi.hoisted(() => ({ id: 1 as number | null, role: 'user' }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: actor.id === null ? null : { id: actor.id, role: actor.role } }) }));
vi.mock('../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
import { api } from '../api';
import { queryKeys, ReviewAcquisitionError, useReviewQueue, useUpdateReviewItem, useBulkUpdateReview, useRestoreDecision } from '../hooks';
let client: QueryClient;
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(() => {
  vi.clearAllMocks(); actor.id = 1; actor.role = 'user';
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 3, retryDelay: 0 } } });
  vi.mocked(api.get).mockResolvedValue({ data: { items: [{ id: 7 }], total: 527, nextCursor: 'next' }, error: null, status: 200 });
});
afterEach(() => { cleanup(); client.clear(); });
it('requests bounded pages and keys every server filter, cursor, actor, and role', async () => {
  const { result, rerender } = renderHook(({ scope }) => useReviewQueue('pending', 'album', scope), {
    wrapper, initialProps: { scope: { q: '  Saved Artist  ', cursor: 'opaque', limit: 25 } },
  });
  await waitFor(() => expect(result.current.data?.total).toBe(527));
  expect(api.get).toHaveBeenCalledWith('/api/imports/review/queue?status=pending&limit=25&itemType=album&q=Saved+Artist&cursor=opaque', { signal: expect.any(AbortSignal) });
  expect(client.getQueryData(queryKeys.reviewQueue('pending', 'album', { q: 'Saved Artist', cursor: 'opaque', limit: 25 }, 1, 'user'))).toMatchObject({ nextCursor: 'next' });
  actor.id = 2; rerender({ scope: { q: 'Saved Artist', cursor: 'opaque', limit: 25 } });
  expect(result.current.data).toBeUndefined(); await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  actor.role = 'admin'; rerender({ scope: { q: 'Saved Artist', cursor: 'opaque', limit: 25 } });
  expect(result.current.data).toBeUndefined(); await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
  rerender({ scope: { q: 'Different', cursor: 'new-cursor', limit: 10 } });
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(4));
});
it('uses fifty records by default and never requests an anonymous queue', async () => {
  const { result, unmount } = renderHook(() => useReviewQueue('pending'), { wrapper });
  await waitFor(() => expect(result.current.data?.items).toHaveLength(1));
  expect(api.get).toHaveBeenCalledWith('/api/imports/review/queue?status=pending&limit=50', { signal: expect.any(AbortSignal) });
  unmount(); vi.clearAllMocks(); actor.id = null;
  const anonymous = renderHook(() => useReviewQueue('pending'), { wrapper });
  expect(anonymous.result.current.fetchStatus).toBe('idle'); expect(api.get).not.toHaveBeenCalled();
});
it.each(['http', 'uncertain'] as const)('retains %s record outcomes in a typed error without automatic mutation retries', async kind => {
  const outcomes = [{ id: 7, state: kind === 'http' ? 'identity-required' : 'uncertain', message: 'Choose or verify the artist' }];
  vi.mocked(api.put).mockResolvedValue(kind === 'http'
    ? { data: null, error: 'Choose artist', status: 422, details: { outcomes } }
    : { data: { success: false, outcomes }, error: null, status: 200 });
  const { result } = renderHook(() => useUpdateReviewItem(), { wrapper });
  await act(async () => {
    try { await result.current.mutateAsync({ id: 7, status: 'approved' }); throw new Error('Expected acquisition failure'); }
    catch (error) { expect(error).toBeInstanceOf(ReviewAcquisitionError); expect((error as ReviewAcquisitionError).outcomes).toEqual(outcomes); }
  });
  expect(api.put).toHaveBeenCalledTimes(1);
});

it.each([422, 409])('preserves bulk HTTP %i per-record outcomes and keeps rejection errors separate', async status => {
  const outcomes = [{ id: 7, state: 'identity-required', message: 'Choose artist' }, { id: 8, state: 'uncertain', message: 'Check library' }];
  vi.mocked(api.post).mockResolvedValue({ data: null, error: 'Review needs attention', status, details: { outcomes } });
  const { result } = renderHook(() => useBulkUpdateReview(), { wrapper });
  await act(async () => {
    await expect(result.current.mutateAsync({ ids: [7, 8], status: 'approved' })).rejects.toMatchObject({ outcomes });
    await expect(result.current.mutateAsync({ ids: [7, 8], status: 'rejected' })).rejects.not.toBeInstanceOf(ReviewAcquisitionError);
  });
  expect(api.post).toHaveBeenCalledTimes(2);
});

it.each(['single', 'bulk'] as const)('reconciles %s error decisions only for the originating actor', async kind => {
  client.setQueryData(['auth'], { user: { id: 1 } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  let finish!: (value: any) => void;
  const transport = kind === 'single' ? vi.mocked(api.put) : vi.mocked(api.post);
  transport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => ({ single: useUpdateReviewItem(), bulk: useBulkUpdateReview() }), { wrapper });
  const send = () => kind === 'single' ? result.current.single.mutateAsync({ id: 7, status: 'approved' })
    : result.current.bulk.mutateAsync({ ids: [7], status: 'approved' });
  let pending!: Promise<unknown>;
  await act(async () => { pending = send().catch(error => error); await Promise.resolve(); });
  await act(async () => { finish({ data: null, error: 'Decision conflict', status: 409, details: { outcomes: [{ id: 7, state: 'uncertain', message: 'Check library' }] } }); await pending; });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['review'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.dashboardStats });
  invalidate.mockClear();
  await act(async () => { pending = send().catch(error => error); await Promise.resolve(); });
  client.setQueryData(['auth'], { user: { id: 2 } });
  await act(async () => { finish({ data: null, error: 'Decision conflict', status: 409 }); await pending; });
  expect(invalidate).not.toHaveBeenCalled();
});

it('never retries signed restoration even when the global mutation policy retries', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: null, error: 'Restoration failed', status: 503 });
  const { result } = renderHook(() => useRestoreDecision('review'), { wrapper });
  await act(async () => { await expect(result.current.mutateAsync('signed-token')).rejects.toThrow('Restoration failed'); });
  expect(api.post).toHaveBeenCalledTimes(1);
});
it('does not invalidate another actor when a signed restoration completes late', async () => {
  client.setQueryData(['auth'], { user: { id: 1 } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  let finish!: (value: { data: { restoredIds: number[] }; error: null; status: number }) => void;
  vi.mocked(api.post).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { result } = renderHook(() => useRestoreDecision('review'), { wrapper });
  let pending!: Promise<unknown>;
  await act(async () => { pending = result.current.mutateAsync('signed-token'); await Promise.resolve(); });
  client.setQueryData(['auth'], { user: { id: 2 } });
  await act(async () => { finish({ data: { restoredIds: [7] }, error: null, status: 200 }); await pending; });
  expect(invalidate).not.toHaveBeenCalled();
});
