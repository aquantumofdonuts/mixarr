import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), actor: 1, execute: null as null | ((options: any) => Promise<unknown>), request: vi.fn() }));
const options = { qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/archive', monitorOption: 'future', monitorNewItems: 'none', searchOnAdd: false };
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: mocks.actor } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/lib/api', () => ({ api: { post: vi.fn() } }));
// These tests exercise the acquisition executor. The actual shared form/identity step is covered by search-interactions.
vi.mock('@/components/artists/AddArtistOptions', () => ({ useAddArtistOptions: () => ({ dialog: null, runWithOptions: (request: any, execute: any) => {
  mocks.request(request); mocks.execute = execute;
  return execute({ qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/archive', monitorOption: 'future', monitorNewItems: 'none', searchOnAdd: false, ...(request.bulk ? {} : { mbid: request.mbid || '22222222-2222-4222-8222-222222222222' }) }).catch(() => null);
} }) }));
import { api } from '@/lib/api';
import { useArtistAdd } from '../hooks/useArtistAdd';
const response = (data: any, error: string | null = null) => ({ data, error, status: error ? 503 : 200 });
let rows: any[];
const setRows = (update: (rows: any[]) => any[]) => { rows = update(rows); };
beforeEach(() => { vi.clearAllMocks(); mocks.actor = 1; rows = [{ foreignArtistId: a, artistName: 'Same name' }, { foreignArtistId: b, artistName: 'Same name' }]; });
afterEach(cleanup);
describe('search acquisition executors', () => {
  it.each([false, true].flatMap(discovery => ['added', 'already-in-library', undefined].map(outcome => ({ discovery, outcome }))))('announces only the actual confirmed outcome=$outcome discovery=$discovery', async ({ discovery, outcome }) => {
    if (discovery) rows[0] = { resultKey: 'spotify:one', spotifyId: 'one', artistName: 'Same name' };
    vi.mocked(api.post).mockResolvedValue(response({ success: true, outcome }));
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleAddArtist(rows[0]); });
    expect(rows[0].inLibrary).toBe(true);
    expect(rows[1].inLibrary).not.toBe(true);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({ type: 'success', title: outcome === 'added' ? 'Artist added' : outcome === 'already-in-library' ? 'Already in Lidarr' : 'Membership confirmed', message: outcome === 'added' ? 'Same name added to Lidarr' : outcome === 'already-in-library' ? 'Same name is already in Lidarr' : 'Same name is in Lidarr' });
  });
  it('passes all selected effective options including false through the original canonical endpoint', async () => {
    vi.mocked(api.post).mockResolvedValue(response({ success: true }));
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleAddArtist(rows[0]); });
    expect(api.post).toHaveBeenCalledWith('/api/search/artists/add', { ...options, mbid: a, foreignArtistId: a });
    expect(rows[0].inLibrary).toBe(true); expect(rows[1].inLibrary).not.toBe(true);
  });
  it('preserves the original provider result key after an explicit canonical choice', async () => {
    rows = [{ resultKey: 'spotify:one', spotifyId: 'one', artistName: 'Same name' }, { resultKey: 'spotify:two', spotifyId: 'two', artistName: 'Same name' }];
    vi.mocked(api.post).mockResolvedValue(response({ success: true }));
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleAddArtist(rows[0]); });
    expect(api.post).toHaveBeenCalledWith('/api/search/discover/add', { artistName: 'Same name', ...options, mbid: b });
    expect(rows[0]).toMatchObject({ resultKey: 'spotify:one', foreignArtistId: b, inLibrary: true });
    expect(rows[1].inLibrary).not.toBe(true);
  });
  it.each([response(null, 'Provider unavailable'), response({ success: false })])('keeps a failed addition recoverable and reports it once', async reply => {
    vi.mocked(api.post).mockResolvedValue(reply);
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleAddArtist(rows[0]); });
    expect(rows[0].inLibrary).not.toBe(true); expect(rows[0].acquisitionError).toBeTruthy();
    expect(mocks.toast).toHaveBeenCalledTimes(1); expect(result.current.pendingIds.size).toBe(0);
  });
  it.each(['scope', 'actor'])('ignores late original responses across a %s A to B to A transition', async change => {
    let finish!: (reply: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result, rerender } = renderHook(({ scope }) => useArtistAdd(setRows, scope), { initialProps: { scope: 'A' } });
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.handleAddArtist(rows[0]); });
    if (change === 'actor') mocks.actor = 2;
    rerender({ scope: change === 'scope' ? 'B' : 'A' });
    mocks.actor = 1; rerender({ scope: 'A' });
    await act(async () => { finish(response({ success: true })); await pending; });
    expect(rows[0].inLibrary).not.toBe(true); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('ignores a late response after unmount', async () => {
    let finish!: (reply: any) => void;
    vi.mocked(api.post).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result, unmount } = renderHook(() => useArtistAdd(setRows));
    let pending!: Promise<unknown>;
    act(() => { pending = result.current.handleAddArtist(rows[0]); }); unmount();
    await act(async () => { finish(response({ success: true })); await pending; });
    expect(rows[0].inLibrary).not.toBe(true); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('does not open a bulk action for an empty selection', async () => {
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleBatchAdd(new Set()); });
    expect(mocks.request).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
  });
  it('passes effective options to bulk and retries only failed original IDs without marking confirmed rows failed', async () => {
    vi.mocked(api.post).mockResolvedValueOnce(response({ added: [a], skipped: [], failed: [{ id: b, error: 'Provider offline' }] })).mockResolvedValueOnce(response({ added: [b], skipped: [], failed: [] }));
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleBatchAdd(new Set([a, b])); });
    expect(rows[0]).toMatchObject({ inLibrary: true }); expect(rows[0].acquisitionError).toBeUndefined();
    expect(rows[1].acquisitionError).toBe('Provider offline'); expect(result.current.isBulkAdding).toBe(false);
    await act(async () => { await mocks.execute!(options); });
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/search/batch', { artistIds: [a, b], ...options });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/search/batch', { artistIds: [b], ...options });
    expect(rows.every(row => row.inLibrary)).toBe(true);
  });
  it('preserves failed bulk rows after an unconfirmed response', async () => {
    vi.mocked(api.post).mockResolvedValue(response(null, 'Provider unavailable'));
    const { result } = renderHook(() => useArtistAdd(setRows));
    await act(async () => { await result.current.handleBatchAdd(new Set([a, b])); });
    expect(rows.every(row => !row.inLibrary && row.acquisitionError === 'Provider unavailable')).toBe(true);
  });
});
