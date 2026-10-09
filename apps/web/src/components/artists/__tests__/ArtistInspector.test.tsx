import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistInspector } from '../ArtistInspector';
import { ArtistLink } from '../ArtistLink';
import { ListScrollContext } from '@/hooks/useListContext';
import { api } from '@/lib/api';

const mbid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
let params = new URLSearchParams(), actorId = 0;
const router = { push: vi.fn(), replace: vi.fn() }, toast = vi.fn();
const detailRetry = vi.fn(), sourceMore = vi.fn(), releaseRetry = vi.fn(), releaseMore = vi.fn();
let detail: any, releases: any;
vi.mock('next/navigation', () => ({ usePathname: () => '/search', useSearchParams: () => params, useRouter: () => router }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: actorId } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: toast }) }));
vi.mock('@/lib/hooks', () => ({ useArtistDetail: () => detail, useArtistReleases: () => releases }));
vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
const identity = (id = mbid) => ({ mbid: id, name: id === mbid ? 'Portishead' : 'Other artist', imageUrl: null, disambiguation: 'Bristol band', membership: 'not-in-library', sources: [], sourcesNextCursor: null, unavailable: [] });
let pane: HTMLElement;
function mount(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidation = vi.spyOn(client, 'invalidateQueries');
  return { ...render(<QueryClientProvider client={client}><ListScrollContext.Provider value={pane}>{children}</ListScrollContext.Provider></QueryClientProvider>), client, invalidation };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.get).mockResolvedValue({ data: { qualityProfiles: [{id: 1, name: 'Default'}], metadataProfiles: [{id: 1, name: 'Default'}], rootFolders: [{id: 1, path: '/music'}] }, error: null } as any); actorId++; params = new URLSearchParams(`q=trip-hop&seed=one&seed=two&artist=${mbid}`);
  detail = { data: { pages: [identity()] }, isPending: false, isError: false, refetch: detailRetry, hasNextPage: false, fetchNextPage: sourceMore, isFetchingNextPage: false };
  releases = { data: { pages: [{ releaseGroups: [], count: 0 }] }, isPending: false, isError: false, refetch: releaseRetry, hasNextPage: false, fetchNextPage: releaseMore, isFetchingNextPage: false };
  pane = document.createElement('main'); document.body.append(pane);
  Object.defineProperties(pane, { scrollHeight: { value: 1200 }, clientHeight: { value: 200 } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(() => { cleanup(); pane.remove(); vi.unstubAllGlobals(); });

describe('shared artist inspector', () => {
  it('opens a direct link and closes to the complete parent query', () => {
    mount(<ArtistInspector />);
    expect(screen.getByRole('dialog', { name: 'Portishead' })).toBeInTheDocument();
    expect(screen.getByText('Bristol band')).toBeInTheDocument();
    expect(screen.getByText(mbid)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/search?q=trip-hop&seed=one&seed=two', { scroll: false });
  });
  it('provides a native canonical link and preserves parent scroll and trigger focus', async () => {
    params.delete('artist'); pane.scrollTop = 600;
    const view = mount(<><ArtistLink mbid={mbid.toUpperCase()}>Portishead row</ArtistLink><ArtistInspector /></>);
    const link = screen.getByRole('link', { name: 'Portishead row' });
    expect(link).toHaveAttribute('href', `/search?q=trip-hop&seed=one&seed=two&artist=${mbid}`);
    link.focus(); fireEvent.click(link);
    expect(router.push).toHaveBeenCalledWith(`/search?q=trip-hop&seed=one&seed=two&artist=${mbid}`, { scroll: false });
    params.set('artist', mbid); view.rerender(<QueryClientProvider client={view.client}><ListScrollContext.Provider value={pane}><ArtistLink mbid={mbid}>Portishead row</ArtistLink><ArtistInspector /></ListScrollContext.Provider></QueryClientProvider>);
    pane.scrollTop = 0; params.delete('artist');
    view.rerender(<QueryClientProvider client={view.client}><ListScrollContext.Provider value={pane}><ArtistLink mbid={mbid}>Portishead row</ArtistLink><ArtistInspector /></ListScrollContext.Provider></QueryClientProvider>);
    await waitFor(() => expect(pane.scrollTop).toBe(600));
    expect(link).toHaveFocus(); expect(document.body.style.overflow).toBe('');
  });
  it('uses identification for provider-only metadata without fabricating an identity', () => {
    const identify = vi.fn();
    mount(<ArtistLink mbid={null} onIdentify={identify}>Provider-only artist</ArtistLink>);
    fireEvent.click(screen.getByRole('button', { name: 'Identify artist: Provider-only artist' }));
    expect(identify).toHaveBeenCalledOnce(); expect(router.push).not.toHaveBeenCalled();
  });
  it('rejects invalid URL identities without rendering stale metadata', () => {
    params.set('artist', 'artist-name'); mount(<ArtistInspector />);
    expect(screen.getByText('This artist link does not contain a valid MusicBrainz identity.')).toBeInTheDocument();
    expect(screen.queryByText('Portishead')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add artist' })).not.toBeInTheDocument();
  });
  it('renders original nullable evidence and explicit partial availability', () => {
    detail.data.pages[0] = { ...identity(), membership: 'unknown', unavailable: ['membership', 'metadata'], sources: [
      { key: 's1', kind: 'subscription-result', label: 'Weekly discoveries', subscriptionId: 12, runId: 34, recordedAt: '2026-10-08T10:00:00Z', recordStatus: 'pending', sourceUrl: 'https://music.example/evidence' },
      { key: 'r1', kind: 'review-item', label: 'Last.fm', subscriptionId: null, runId: null, recordedAt: '2026-10-07T10:00:00Z', recordStatus: 'rejected', sourceUrl: null },
    ] };
    mount(<ArtistInspector />);
    expect(screen.getByRole('link', { name: 'Weekly discoveries' })).toHaveAttribute('href', '/subscriptions/12?tab=results');
    expect(screen.getByRole('link', { name: 'Run 34' })).toHaveAttribute('href', '/subscriptions/12?tab=runs&run=34');
    expect(screen.getByText('Last.fm')).toBeInTheDocument();
    expect(screen.getByText('Collection membership unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry artist details' })); expect(detailRetry).toHaveBeenCalled();
  });
  it('retains paged evidence and releases during load-more errors and offers retry', () => {
    detail.hasNextPage = true; detail.isError = true;
    releases.hasNextPage = true; releases.isError = true; releases.error = new Error('MusicBrainz unavailable');
    releases.data.pages = [{ releaseGroups: [{ id: 'r2', title: 'Third', 'first-release-date': '2008-04-28' }, { id: 'r1', title: 'Dummy', 'first-release-date': '1994-08-22' }], count: 3 }];
    mount(<ArtistInspector />);
    expect(screen.getByText('Dummy')).toBeInTheDocument(); expect(screen.getByText('Third')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more sources' })); expect(sourceMore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Load more releases' })); expect(releaseMore).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry releases' })); expect(releaseRetry).toHaveBeenCalled();
    expect(screen.getByText('MusicBrainz unavailable')).toBeInTheDocument();
  });
  it('does not show a stale detail identity after the URL changes', () => {
    params.set('artist', other); mount(<ArtistInspector />);
    expect(screen.queryByText('Portishead')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add artist' })).not.toBeInTheDocument();
  });
  it('refreshes membership through the existing confirmed add path', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true }, error: null } as any);
    const { invalidation } = mount(<ArtistInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/search/artists/add', expect.objectContaining({ foreignArtistId: mbid, mbid, qualityProfileId: 1, rootFolderPath: '/music' })));
    await waitFor(() => expect(invalidation).toHaveBeenCalledWith({ queryKey: ['artists', actorId, mbid, 'detail'] }));
  });
  it('keeps a late acquisition response scoped to its original inspector', async () => {
    let finish!: (value: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = mount(<ArtistInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    params.set('artist', other); detail.data.pages = [identity(other)];
    view.rerender(<QueryClientProvider client={view.client}><ArtistInspector /></QueryClientProvider>);
    await act(async () => finish({ data: { success: true }, error: null }));
    expect(screen.getByRole('dialog', { name: 'Other artist' })).toBeInTheDocument();
    expect(screen.getByText('Not in Lidarr')).toBeInTheDocument();
    expect(view.invalidation).not.toHaveBeenCalled();
  });
  it('allows modified native links without altering the current list context', () => {
    params.delete('artist'); mount(<ArtistLink mbid={mbid}>Portishead row</ArtistLink>);
    fireEvent.click(screen.getByRole('link', { name: 'Portishead row' }), { ctrlKey: true });
    expect(router.push).not.toHaveBeenCalled();
  });
  it('does not report membership or invalidate on an add failure', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: null, error: 'Provider failed' } as any);
    const { invalidation } = mount(<ArtistInspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(invalidation).not.toHaveBeenCalled(); expect(screen.getByText('Not in Lidarr')).toBeInTheDocument();
  });
  it('repeated opening and closing tears down the body lock and escape handlers', () => {
    const { rerender, unmount, client } = mount(<ArtistInspector />);
    for (let i = 0; i < 3; i++) {
      params.delete('artist'); rerender(<QueryClientProvider client={client}><ArtistInspector /></QueryClientProvider>);
      expect(document.body.style.overflow).toBe('');
      fireEvent.keyDown(document, { key: 'Escape' }); expect(router.replace).not.toHaveBeenCalled();
      params.set('artist', mbid); rerender(<QueryClientProvider client={client}><ArtistInspector /></QueryClientProvider>);
      expect(document.body.style.overflow).toBe('hidden');
    }
    unmount(); expect(document.body.style.overflow).toBe('');
    fireEvent.keyDown(document, { key: 'Escape' }); expect(router.replace).not.toHaveBeenCalled();
  });
});
