import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearch } from '../hooks/useSearch';
const navigation = vi.hoisted(() => ({ query: '', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/search', useSearchParams: () => new URLSearchParams(navigation.query), useRouter: () => navigation }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const request = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => {
  navigation.query = ''; navigation.push.mockReset(); navigation.replace.mockReset(); request.mockReset();
  request.mockImplementation(async url => String(url) === '/api/search/ai/status' ? json({ available: true }) : json({ results: [{ mbid: 'a', name: 'First' }] }));
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('committed search lifecycle', () => {
  it('keeps draft typing local and commits query without discarding other URL parameters', async () => {
    navigation.query = 'tab=album&sources=spotify&artist=11111111-1111-4111-8111-111111111111';
    const { result } = renderHook(() => useSearch());
    act(() => result.current.setQuery('  record  '));
    expect(request.mock.calls.filter(([url]) => String(url).includes('/album'))).toHaveLength(0);
    act(() => { void result.current.performSearch(); });
    const destination = new URL(navigation.push.mock.calls[0][0], 'https://mixarr.invalid');
    expect(destination.searchParams.get('q')).toBe('record');
    expect(destination.searchParams.get('tab')).toBe('album');
    expect(destination.searchParams.get('sources')).toBe('spotify');
  });
  it('loads a deep link and restores its committed draft after Back', async () => {
    navigation.query = 'q=record&tab=album&page=2';
    request.mockImplementation(async url => String(url).includes('/album') ? json({ releases: [{ id: 'r', title: 'Record' }], count: 40 }) : json({ available: true }));
    const { result, rerender } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(request.mock.calls.some(([url]) => String(url).includes('offset=25'))).toBe(true);
    expect(result.current.query).toBe('record');
    act(() => result.current.setQuery('unfinished'));
    navigation.query = 'q=earlier&tab=artist&sources=deezer'; rerender();
    await waitFor(() => expect(result.current.query).toBe('earlier'));
    expect(result.current.searchType).toBe('artist');
    expect([...result.current.enabledSources]).toEqual(['deezer']);
  });
  it('retains successful rows during replacement and failure, and ignores canceled late responses', async () => {
    navigation.query = 'q=first';
    let finish!: (value: Response) => void;
    request.mockImplementation(async url => {
      const path = String(url);
      if (path.includes('q=slow')) return new Promise(resolve => { finish = resolve; });
      if (path.includes('q=broken')) return json({ error: 'Provider offline' }, 503);
      return path.includes('/discover') ? json({ results: [{ mbid: 'a', name: 'First' }] }) : json({ available: true });
    });
    const { result, rerender } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results[0]?.artistName).toBe('First'));
    navigation.query = 'q=slow'; rerender();
    await waitFor(() => expect(result.current.isSearching).toBe(true));
    expect(result.current.results[0].artistName).toBe('First');
    const slowSignal = request.mock.calls.find(([url]) => String(url).includes('q=slow'))![1]!.signal!;
    navigation.query = 'q=broken'; rerender();
    await waitFor(() => expect(result.current.error).toBe('Provider offline'));
    expect(slowSignal.aborted).toBe(true);
    await act(async () => { finish(json({ results: [{ mbid: 'late', name: 'Late' }] })); });
    expect(result.current.results[0].artistName).toBe('First');
    expect(result.current.error).toBe('Provider offline');
  });
  it('cancels a search on unmount', async () => {
    navigation.query = 'q=first';
    request.mockImplementation(async url => String(url).includes('/discover') ? new Promise(() => {}) : json({ available: true }));
    const { unmount } = renderHook(() => useSearch());
    await waitFor(() => expect(request.mock.calls.some(([url]) => String(url).includes('/discover'))).toBe(true));
    const signal = request.mock.calls.find(([url]) => String(url).includes('/discover'))![1]!.signal!;
    unmount(); expect(signal.aborted).toBe(true);
  });
  it('reports partial AI results independently of a successful empty search', async () => {
    navigation.query = 'q=quiet&tab=ai';
    request.mockImplementation(async (url) => String(url) === '/api/search/ai' ? json({ prompt: 'quiet', results: [{ foreignArtistId: 'a', artistName: 'First' }], aiProviders: ['one'], errors: ['Second provider offline'] }) : json({ available: true }));
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(result.current.partialErrors).toEqual(['Second provider offline']);
    expect(result.current.hasSearched).toBe(true);
  });
  it('gives name-only results separate request identities and does not reuse them on the next search', async () => {
    navigation.query = 'q=same';
    request.mockImplementation(async url => String(url).includes('/discover') ? json({ results: [{ name: 'Same' }, { name: 'Same' }] }) : json({ available: true }));
    const { result, rerender } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results).toHaveLength(2));
    const keys = result.current.results.map(row => row.resultKey);
    expect(new Set(keys).size).toBe(2);
    navigation.query = 'q=next'; rerender();
    await waitFor(() => expect(result.current.resultQuery).toBe('next'));
    expect(result.current.results.map(row => row.resultKey).some(key => keys.includes(key))).toBe(false);
  });

  it.each([
    ['label', 'labels', 'label?q=warp&limit=25&offset=25'],
    ['year', 'releaseGroups', 'year?year=warp&limit=25&offset=25'],
  ])('maps %s results and page totals from the actual endpoint', async (tab, field, suffix) => {
    navigation.query = `q=warp&tab=${tab}&page=2`;
    request.mockImplementation(async url => String(url).includes('/ai/status') ? json({ available: false }) : json({ [field]: [{ id: 'record', name: 'Warp', title: 'Record' }], count: 75 }));
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    expect(request.mock.calls.some(([url]) => String(url) === `/api/search/${suffix}`)).toBe(true);
    expect(result.current.totalPages).toBe(3);
    act(() => result.current.goToPage(3));
    expect(new URL(navigation.push.mock.calls[0][0], 'https://mixarr.invalid').searchParams.get('page')).toBe('3');
  });
  it('keeps at least one source enabled and sends the selected sources', async () => {
    navigation.query = 'q=first&sources=spotify';
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.results).toHaveLength(1));
    act(() => result.current.toggleSource('spotify'));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([url]) => String(url).includes('sources=spotify'))).toBe(true);
    act(() => result.current.toggleSource('deezer'));
    expect(navigation.push).not.toHaveBeenCalled();
    expect(new URL(navigation.replace.mock.calls[0][0], 'https://mixarr.invalid').searchParams.get('sources')).toBe('spotify,deezer');
  });
  it('pushes explicit tab navigation and clears pagination', () => {
    navigation.query = 'q=first&tab=artist&page=3';
    const { result } = renderHook(() => useSearch());
    act(() => result.current.setSearchType('album'));
    const destination = new URL(navigation.push.mock.calls[0][0], 'https://mixarr.invalid');
    expect(destination.searchParams.get('tab')).toBe('album');
    expect(destination.searchParams.has('page')).toBe(false);
    expect(navigation.replace).not.toHaveBeenCalled();
  });
  it('treats AI errors with zero results as a provider failure rather than no matches', async () => {
    navigation.query = 'q=quiet&tab=ai';
    request.mockImplementation(async url => String(url) === '/api/search/ai' ? json({ results: [], errors: ['Provider offline'], message: 'Providers could not search' }) : json({ available: true }));
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.error).toBe('Providers could not search'));
    const call = request.mock.calls.find(([url]) => String(url) === '/api/search/ai')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ prompt: 'quiet' });
    expect(result.current.hasSearched).toBe(false);
  });

});
