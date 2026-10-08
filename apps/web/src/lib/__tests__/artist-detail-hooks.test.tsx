import React from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../auth';
import { useArtistDetail, useArtistReleases, queryKeys } from '../hooks';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
const mbid = 'df494a19-4657-4a77-92b6-80325c63510f';
const otherMbid = 'bc4c3083-c484-4c2f-8983-dd82eb8b60c0';
const user = (id: number) => ({ id, username: `User ${id}`, displayName: `User ${id}`, role: 'user' });
const auth = (id: number | null) => ({ user: id === null ? null : user(id), setupRequired: false });
const detail = (sourcesNextCursor: string | null = null) => ({ mbid, name: 'Artist', sources: [], sourcesNextCursor, membership: 'unknown', unavailable: ['membership'], disambiguation: null, imageUrl: null });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let clients: QueryClient[];
const setup = (actor: number | null = 1) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(['auth'], auth(actor));
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  return { client, wrapper };
};
beforeEach(() => { clients = []; push.mockReset(); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); vi.unstubAllGlobals(); });

describe('artist detail and release queries', () => {
  it('does not fetch absent identities or anonymous detail/release pages', () => {
    const { wrapper } = setup(null);
    const rendered = renderHook(() => ({ detail: useArtistDetail(mbid), releases: useArtistReleases(null) }), { wrapper });
    expect(rendered.result.current.detail.fetchStatus).toBe('idle'); expect(fetch).not.toHaveBeenCalled();
  });
  it('disables invalid artist identities without hitting either endpoint', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ detail: useArtistDetail('not-a-uuid'), releases: useArtistReleases('wrong-identity') }), { wrapper });
    expect(result.current.detail.fetchStatus).toBe('idle'); expect(result.current.releases.fetchStatus).toBe('idle'); expect(fetch).not.toHaveBeenCalled();
  });
  it('loads initial authentication before artist reads and finishes the cache boundary', async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes('/auth/me') ? json(auth(1)) : json(detail()));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(client);
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
    const { result } = renderHook(() => useArtistDetail(mbid), { wrapper });
    await waitFor(() => expect(result.current.data?.pages[0].name).toBe('Artist'));
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(['/api/auth/me', `/api/search/artist/${mbid}/detail?sourceLimit=50`]);
  });
  it('canonicalizes identities before keying or requesting both queries', async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes('/detail') ? json(detail()) : json({ releaseGroups: [], count: 0 }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => ({ detail: useArtistDetail(mbid.toUpperCase()), releases: useArtistReleases(mbid.toUpperCase()) }), { wrapper });
    await waitFor(() => expect(result.current.detail.isSuccess && result.current.releases.isSuccess).toBe(true));
    expect(client.getQueryData(queryKeys.artistDetail(1, mbid, 50))).toBeDefined();
    expect(client.getQueryData(queryKeys.artistReleases(1, mbid, 25))).toBeDefined();
    expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).includes(mbid))).toBe(true);
  });
  it('loads source pages by encoded cursor and preserves partial metadata availability', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(detail('opaque/cursor+'))).mockResolvedValueOnce(json(detail()));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useArtistDetail(mbid, 2), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.pages[0].unavailable).toEqual(['membership']);
    expect(fetch).toHaveBeenNthCalledWith(1, `/api/search/artist/${mbid}/detail?sourceLimit=2`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await act(async () => { await result.current.fetchNextPage(); });
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/search/artist/${mbid}/detail?sourceLimit=2&sourceCursor=opaque%2Fcursor%2B`, expect.any(Object));
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(client.getQueryData(queryKeys.artistDetail(1, mbid, 2))).toBeDefined();
    expect(client.getQueryData(queryKeys.artistDetail(2, mbid, 2))).toBeUndefined();
  });
  it('loads release offsets from fetched rows and stops at provider total', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ releaseGroups: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], count: 3 }))
      .mockResolvedValueOnce(json({ releaseGroups: [{ id: 'c', title: 'C' }], count: 3 }));
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useArtistReleases(mbid, 2), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => { await result.current.fetchNextPage(); });
    expect(fetch).toHaveBeenNthCalledWith(2, `/api/search/artist/${mbid}/releases?limit=2&offset=2`, expect.any(Object));
    await waitFor(() => expect(result.current.data?.pages.flatMap(page => page.releaseGroups).map(row => row.id)).toEqual(['a', 'b', 'c']));
    expect(result.current.hasNextPage).toBe(false);
    expect(client.getQueryData(queryKeys.artistReleases(1, mbid, 2))).toBeDefined();
  });
  it('stops an empty release page instead of requesting the same offset indefinitely', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ releaseGroups: [], count: 3 }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useArtistReleases(mbid), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
  it('surfaces release failure without replacing loaded artist metadata', async () => {
    vi.mocked(fetch).mockImplementation(async url => String(url).includes('/detail') ? json(detail()) : json({ error: 'Artist releases unavailable' }, 500));
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ detail: useArtistDetail(mbid), releases: useArtistReleases(mbid) }), { wrapper });
    await waitFor(() => expect(result.current.releases.isError).toBe(true));
    expect(result.current.detail.data?.pages[0].name).toBe('Artist');
    expect(result.current.releases.error?.message).toBe('Artist releases unavailable');
  });
  it('aborts obsolete detail and release requests when the identity changes and on unmount', async () => {
    const signals: AbortSignal[] = [];
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      const signal = options!.signal!; signals.push(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const { wrapper } = setup();
    const { rerender, unmount } = renderHook(({ identity }) => ({ detail: useArtistDetail(identity), releases: useArtistReleases(identity) }), { wrapper, initialProps: { identity: mbid } });
    await waitFor(() => expect(signals).toHaveLength(2));
    rerender({ identity: otherMbid });
    await waitFor(() => expect(signals).toHaveLength(4));
    expect(signals.slice(0, 2).every(signal => signal.aborted)).toBe(true);
    expect(signals.slice(2).every(signal => !signal.aborted)).toBe(true);
    unmount(); expect(signals.every(signal => signal.aborted)).toBe(true);
  });
});

describe('protected query cache auth boundary', () => {
  it('removes protected caches on logout and cancels reads before removal', async () => {
    let protectedSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((url, options) => String(url).includes('/logout') ? Promise.resolve(json({ success: true })) : new Promise(resolve => {
      protectedSignal = options!.signal!;
      // A late provider response must not refill a removed actor cache.
      protectedSignal.addEventListener('abort', () => resolve(json(detail())), { once: true });
    }));
    const { client, wrapper } = setup();
    client.setQueryData(['feed'], { private: true });
    const { result } = renderHook(() => ({ auth: useAuth(), detail: useArtistDetail(mbid) }), { wrapper });
    await waitFor(() => expect(protectedSignal).toBeDefined());
    await act(async () => { await result.current.auth.logout(); });
    expect(protectedSignal?.aborted).toBe(true);
    expect(client.getQueryData(['feed'])).toBeUndefined();
    expect(client.getQueryData(queryKeys.artistDetail(1, mbid, 50))).toBeUndefined();
    expect(result.current.auth.user).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });
  it('does not claim logout succeeded when the session endpoint rejects it', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ error: 'Logout rejected' }, 500));
    const { client, wrapper } = setup(); client.setQueryData(['feed'], { private: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await expect(result.current.logout()).rejects.toThrow('Logout failed'); });
    expect(result.current.user?.id).toBe(1); expect(client.getQueryData(['feed'])).toEqual({ private: true }); expect(push).not.toHaveBeenCalled();
  });
  it('clears old protected rows on a login to another actor', async () => {
    vi.mocked(fetch).mockResolvedValue(json({ user: user(2), setupRequired: false }));
    const { client, wrapper } = setup(); client.setQueryData(['feed'], { private: true });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => { await result.current.login('two', 'password'); });
    await waitFor(() => expect(result.current.user?.id).toBe(2)); expect(client.getQueryData(['feed'])).toBeUndefined();
  });
  it('gates global protected consumers during actor refresh so old data cannot paint as the new actor', async () => {
    const painted: string[] = [];
    let newSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      newSignal = options!.signal!;
      return json({ private: 'eight' });
    });
    const { client, wrapper } = setup(7);
    client.setQueryData(['private-feed'], { private: 'seven' });
    const Consumer = () => {
      const { user } = useAuth();
      const query = useQuery({ queryKey: ['private-feed'], staleTime: Infinity, queryFn: async ({ signal }) => {
        const res = await fetch('/api/private-feed', { signal });
        return res.json() as Promise<{ private: string }>;
      } });
      const label = `${user?.id}:${query.data?.private ?? 'loading'}`;
      painted.push(label);
      return <div>{label}</div>;
    };
    render(<Consumer />, { wrapper });
    expect(screen.getByText('7:seven')).toBeDefined();
    act(() => client.setQueryData(['auth'], auth(8)));
    await waitFor(() => expect(screen.getByText('8:eight')).toBeDefined());
    expect(painted).not.toContain('8:seven');
    expect(newSignal?.aborted).toBe(false);
  });
  it('isolates a refreshed actor and cancels the old actor before returning new detail', async () => {
    let oldSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementation((_url, options) => {
      if (!oldSignal) return new Promise(resolve => {
        oldSignal = options!.signal!;
        oldSignal.addEventListener('abort', () => resolve(json({ ...detail(), name: 'Old private artist' })), { once: true });
      });
      return Promise.resolve(json({ ...detail(), name: 'New private artist' }));
    });
    const { client, wrapper } = setup(); client.setQueryData(['feed'], { private: true });
    const { result } = renderHook(() => useArtistDetail(mbid), { wrapper });
    await waitFor(() => expect(oldSignal).toBeDefined());
    act(() => client.setQueryData(['auth'], auth(2)));
    await waitFor(() => expect(result.current.data?.pages[0].name).toBe('New private artist'));
    expect(oldSignal?.aborted).toBe(true);
    expect(client.getQueryData(queryKeys.artistDetail(1, mbid, 50))).toBeUndefined();
    expect(client.getQueryData(['feed'])).toBeUndefined();
    expect(client.getQueryData(queryKeys.artistDetail(2, mbid, 50))).toBeDefined();
  });
});
