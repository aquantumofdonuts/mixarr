import { useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import QueuePage from '../page';
const navigation = vi.hoisted(() => ({ query: '', listeners: new Set<() => void>(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/queue', useSearchParams: () => new URLSearchParams(useSyncExternalStore(callback => { navigation.listeners.add(callback); return () => navigation.listeners.delete(callback); }, () => navigation.query)), useRouter: () => navigation }));
const session = vi.hoisted(() => ({ actor: 7 }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: session.actor, role: 'admin' } }) }));
vi.mock('@/components/slskd/SearchModal', () => ({ SlskdSearchModal: () => null }));
const toast = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: toast, isCurrent: () => true }) }));
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const row = (id: number, userId = 7) => ({ id, userId, mbid: ids[id % 2], artistName: 'Same name', source: 'Weekly discoveries', status: 'pending', itemType: 'artist', albumName: null, createdAt: '2026-10-07T12:00:00.000Z' });
let rows: ReturnType<typeof row>[], clients: QueryClient[];
const request = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function navigate(destination: string) { navigation.query = new URL(destination, 'https://mixarr.invalid').search.slice(1); navigation.listeners.forEach(callback => callback()); }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } }); clients.push(client); client.setQueryData(['auth'], { user: { id: session.actor } }); return { ...render(<QueryClientProvider client={client}><QueuePage /></QueryClientProvider>), client }; }
function calls(path: string) { return request.mock.calls.filter(([url]) => String(url) === path); }
beforeEach(() => {
  rows = [row(2), row(1), row(3, 8)]; clients = []; session.actor = 7; navigation.query = ''; navigation.push.mockImplementation(navigate); navigation.replace.mockImplementation(navigate); request.mockReset(); toast.mockReset();
  request.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.startsWith('/api/imports/review/queue?')) return json({ items: rows, total: rows.length, nextCursor: null });
    if (path === '/api/discover/profiles') return json({ qualityProfiles: [{ id: 1, name: 'Lossless' }], metadataProfiles: [{ id: 1, name: 'Albums' }], rootFolders: [{ id: 1, path: '/music' }, { id: 2, path: '/archive' }] });
    if (path === '/api/imports/review/bulk') { const body = JSON.parse(String(options?.body)); rows = rows.filter(row => !body.ids.includes(row.id)); return json({ success: true, outcomes: body.ids.map((id: number) => ({ id, state: 'added', message: 'Confirmed provider addition' })) }); }
    if (/\/api\/imports\/review\/\d+$/.test(path)) { const id = Number(path.split('/').at(-1)); const body = JSON.parse(String(options?.body)); rows = rows.filter(row => row.id !== id); return json(body.status === 'rejected' ? { undoToken: 'opaque-signed', undoExpiresAt: new Date(Date.now() + 120000).toISOString() } : { success: true, outcomes: [{ id, state: 'added', message: 'Confirmed provider addition' }] }); }
    if (path === '/api/imports/review/restore') { rows.push(row(2)); return json({ restoredIds: [2] }); }
    throw new Error(`Unexpected request ${path}`);
  }); vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); vi.unstubAllGlobals(); });
it('uses complete server search, restores bounded URL filters, and preserves unrelated parameters', async () => {
  navigation.query = 'status=rejected&itemType=album&q=Saved&cursor=opaque&artist='+ids[0]+'&keep=value'; mount();
  await screen.findByRole('region', { name: 'Review items' });
  await waitFor(() => expect(request).toHaveBeenCalled());
  expect(String(request.mock.calls[0][0])).toBe('/api/imports/review/queue?status=rejected&limit=50&itemType=album&q=Saved&cursor=opaque');
  expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search review queue' }), { target: { value: 'New search' } });
  await waitFor(() => expect(new URLSearchParams(navigation.query).get('q')).toBe('New search'));
  expect(new URLSearchParams(navigation.query).has('cursor')).toBe(false); expect(new URLSearchParams(navigation.query).get('artist')).toBe(ids[0]); expect(new URLSearchParams(navigation.query).get('keep')).toBe('value');
});
it('selects only owned loaded records and keeps unrelated selection after a single addition', async () => {
  mount(); await screen.findByRole('checkbox', { name: 'Select loaded page' });
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select loaded page' })).toBeEnabled());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select loaded page' }));
  expect(screen.getByRole('checkbox', { name: 'Select review item 3' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Select review item 3' })).not.toBeChecked();
  fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Add artist' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm add' }));
  await screen.findByText('Added to Lidarr');
  expect(screen.getByRole('checkbox', { name: 'Select review item 1' })).toBeChecked(); expect(screen.queryByText('In Lidarr', { exact: true })).toBeNull();
  expect(JSON.parse(String(calls('/api/imports/review/2')[0][1]?.body))).toMatchObject({ status: 'approved', mbid: ids[0] });
});
it('retains failed same-name rows and options, retrying only failed record IDs', async () => {
  const original = request.getMockImplementation()!; let count = 0;
  request.mockImplementation(async (url, options) => {
    if (String(url) !== '/api/imports/review/bulk') return original(url, options);
    count++; rows = rows.filter(row => count === 1 ? row.id !== 2 : row.id !== 1);
    return json({ success: count > 1, outcomes: count === 1 ? [{ id: 2, state: 'already-in-library', message: 'Exact identity found' }, { id: 1, state: 'uncertain', message: 'Verify membership before retry' }] : [{ id: 1, state: 'added', message: 'Confirmed' }] });
  }); mount(); await screen.findByRole('checkbox', { name: 'Select loaded page' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select loaded page' })).toBeEnabled()); fireEvent.click(screen.getByRole('checkbox', { name: 'Select loaded page' })); fireEvent.click(screen.getByRole('button', { name: 'Add selected items' }));
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Root folder' })).toBeEnabled()); fireEvent.change(screen.getByRole('combobox', { name: 'Root folder' }), { target: { value: '/archive' } }); fireEvent.click(screen.getByRole('checkbox', { name: 'Search on add' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
  await screen.findByText('Already in Lidarr'); expect(screen.getByRole('checkbox', { name: 'Select review item 1' })).toBeChecked(); expect(screen.getByRole('combobox', { name: 'Root folder' })).toHaveValue('/archive');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls('/api/imports/review/bulk').map(call => JSON.parse(String(call[1]?.body)).ids)).toEqual([[2, 1], [1]]); expect(calls('/api/imports/review/bulk').every(call => JSON.parse(String(call[1]?.body)).searchOnAdd === false)).toBe(true);
});
it('rejects immediately and restores only with the signed token, with duplicate Undo guarded', async () => {
  mount(); await screen.findByRole('checkbox', { name: 'Select review item 2' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select review item 2' })).toBeEnabled()); fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(toast).toHaveBeenCalled()); const undo = toast.mock.calls.at(-1)![0]; expect(undo.action.label).toBe('Undo'); expect(undo.duration).toBeLessThanOrEqual(10000); expect(screen.queryByRole('article', { name: 'Review item 2' })).toBeNull();
  await act(async () => { undo.action.onClick(); undo.action.onClick(); }); await screen.findByRole('article', { name: 'Review item 2' }); expect(calls('/api/imports/review/restore')).toHaveLength(1); expect(JSON.parse(String(calls('/api/imports/review/restore')[0][1]?.body))).toEqual({ undoToken: 'opaque-signed' }); expect(navigation.query).not.toContain('signed');
});
it('retains prior rows while replacement loads or fails, disabling every mutation', async () => {
  const original = request.getMockImplementation()!; let finish!: (value: Response) => void;
  mount(); await screen.findByRole('article', { name: 'Review item 2' }); request.mockImplementation(async (url, options) => String(url).includes('q=Changed') ? new Promise(resolve => { finish = resolve; }) : original(url, options));
  await act(async () => navigate('/queue?q=Changed'));
  await screen.findByText('Previous queue results. Actions are unavailable until the current page loads.'); expect(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Reject' })).toBeDisabled();
  await act(async () => finish(json({ error: 'Source unavailable' }, 503))); await screen.findByRole('button', { name: 'Retry queue' }); expect(screen.getByRole('article', { name: 'Review item 2' })).toBeInTheDocument();
});
it('discards late outcomes and Undo after account replacement', async () => {
  const original = request.getMockImplementation()!; let finish!: (value: Response) => void;
  request.mockImplementation(async (url, options) => String(url) === '/api/imports/review/2' ? new Promise(resolve => { finish = resolve; }) : original(url, options));
  const view = mount(); await screen.findByRole('checkbox', { name: 'Select review item 2' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select review item 2' })).toBeEnabled()); fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Reject' }));
  await waitFor(() => expect(calls('/api/imports/review/2')).toHaveLength(1)); session.actor = 8; view.client.setQueryData(['auth'], { user: { id: 8 } }); view.rerender(<QueryClientProvider client={view.client}><QueuePage /></QueryClientProvider>);
  await act(async () => finish(json({ undoToken: 'signed-old', undoExpiresAt: new Date(Date.now()+120000).toISOString() }))); expect(toast).not.toHaveBeenCalled(); expect(screen.queryByRole('region', { name: 'Recent acquisition outcomes' })).toBeNull();
});

it('keeps lost-response additions uncertain and retries only records still pending after reconciliation', async () => {
  const original = request.getMockImplementation()!; let count = 0;
  request.mockImplementation(async (url, options) => {
    if (String(url) !== '/api/imports/review/bulk') return original(url, options);
    count++;
    if (count === 1) { rows = rows.filter(row => row.id !== 2); return json({ error: 'Request timed out' }, 503); }
    rows = rows.filter(row => row.id !== 1); return json({ success: true, outcomes: [{ id: 1, state: 'added', message: 'Confirmed' }] });
  });
  mount(); await screen.findByRole('checkbox', { name: 'Select loaded page' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select loaded page' })).toBeEnabled()); fireEvent.click(screen.getByRole('checkbox', { name: 'Select loaded page' })); fireEvent.click(screen.getByRole('button', { name: 'Add selected items' })); await waitFor(() => expect(screen.getByRole('combobox', { name: 'Root folder' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
  await screen.findAllByText('Outcome uncertain'); await waitFor(() => expect(screen.queryByRole('article', { name: 'Review item 2' })).toBeNull()); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(calls('/api/imports/review/bulk').map(call => JSON.parse(String(call[1]?.body)).ids)).toEqual([[2,1],[1]]); expect(screen.getAllByText('Outcome uncertain')).toHaveLength(1);
});
it('expires Undo after ten seconds without posting the token', async () => {
  const clock = vi.spyOn(Date, 'now');
  try {
    mount(); await screen.findByRole('checkbox', { name: 'Select review item 2' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select review item 2' })).toBeEnabled()); fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(toast).toHaveBeenCalled()); const undo = toast.mock.calls.at(-1)![0]; const later = Date.now() + 10001; clock.mockReturnValue(later); undo.action.onClick(); expect(calls('/api/imports/review/restore')).toHaveLength(0);
  } finally { clock.mockRestore(); }
});
it('labels approved records only as review decisions, without inventing collection membership', async () => {
  navigation.query = 'status=approved'; const original = request.getMockImplementation()!;
  request.mockImplementation(async (url, options) => String(url).startsWith('/api/imports/review/queue?') ? json({ items: [{ ...row(2), status: 'approved' }], total: 1, nextCursor: null }) : original(url, options)); mount(); await screen.findByText('Review decision: approved · #2'); expect(screen.queryByText('In Lidarr')).toBeNull(); expect(screen.queryByText('Added to Lidarr')).toBeNull();
});
it('does not resurrect prior-session outcomes when an actor leaves and returns', async () => {
  const view = mount(); await screen.findByRole('checkbox', { name: 'Select review item 2' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select review item 2' })).toBeEnabled()); fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Add artist' })); await waitFor(() => expect(screen.getByRole('combobox', { name: 'Root folder' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'Confirm add' })); await screen.findByText('Added to Lidarr');
  for (const actor of [8, 7]) { session.actor = actor; view.client.setQueryData(['auth'], { user: { id: actor } }); view.rerender(<QueryClientProvider client={view.client}><QueuePage /></QueryClientProvider>); await waitFor(() => expect(screen.queryByRole('region', { name: 'Recent acquisition outcomes' })).toBeNull()); }
});

it('does not post an offered Undo token after the account changes', async () => {
  const view = mount(); await screen.findByRole('checkbox', { name: 'Select review item 2' }); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select review item 2' })).toBeEnabled()); fireEvent.click(within(screen.getByRole('article', { name: 'Review item 2' })).getByRole('button', { name: 'Reject' })); await waitFor(() => expect(toast).toHaveBeenCalled()); const undo = toast.mock.calls.at(-1)![0];
  session.actor = 8; view.client.setQueryData(['auth'], { user: { id: 8 } }); view.rerender(<QueryClientProvider client={view.client}><QueuePage /></QueryClientProvider>); await act(async () => undo.action.onClick()); expect(calls('/api/imports/review/restore')).toHaveLength(0);
});
it('distinguishes an empty pending queue from no matches and offers filter recovery', async () => {
  rows = []; const view = mount(); await screen.findByText('No pending review items.'); expect(screen.getByRole('link', {name:'Review subscriptions'})).toHaveAttribute('href','/subscriptions'); expect(screen.queryByRole('button', {name:'Clear queue filters'})).toBeNull();
  await act(async () => navigate('/queue?q=Not+present&itemType=album&keep=value')); await screen.findByText('No review items match your search or item type.'); fireEvent.click(screen.getByRole('button', {name:'Clear queue filters'})); expect(new URLSearchParams(navigation.query).get('q')).toBeNull(); expect(new URLSearchParams(navigation.query).get('itemType')).toBeNull(); expect(new URLSearchParams(navigation.query).get('keep')).toBe('value'); view.unmount();
});
it('does not report zero matching records before the first queue response', async () => {
  const original = request.getMockImplementation()!; let finish!: (value: Response) => void;
  request.mockImplementation(async (url,options) => String(url).startsWith('/api/imports/review/queue?') ? new Promise(resolve=>{finish=resolve;}) : original(url,options)); mount(); await waitFor(()=>expect(request).toHaveBeenCalled()); expect(screen.queryByText(/matching review items/)).toBeNull(); expect(screen.getByText('Matching review count is loading.')).toBeInTheDocument(); await act(async ()=>finish(json({items:[],total:0,nextCursor:null}))); await screen.findByText('No pending review items.'); expect(screen.getByText(/matching review items/)).toHaveTextContent('0 matching review items');
});


it('replaces status and item type refinements, resetting cursors and retaining unrelated URL state', async () => {
  navigation.push.mockClear(); navigation.replace.mockClear();
  navigation.query = 'cursor=opaque&keep=value';
  mount();
  await screen.findByRole('region', { name: 'Review items' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Review status' }), { target: { value: 'approved' } });
  await waitFor(() => expect(new URLSearchParams(navigation.query).get('status')).toBe('approved'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Review item type' }), { target: { value: 'album' } });
  await waitFor(() => expect(new URLSearchParams(navigation.query).get('itemType')).toBe('album'));
  expect(new URLSearchParams(navigation.query).has('cursor')).toBe(false);
  expect(new URLSearchParams(navigation.query).get('keep')).toBe('value');
  expect(navigation.push).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledTimes(2);
  expect(request.mock.calls.some(([url]) => String(url) === '/api/imports/review/queue?status=approved&limit=50&itemType=album')).toBe(true);
});

it('replaces empty-state filter recovery', async () => {
  rows = [];
  navigation.query = 'q=Missing&itemType=album&status=rejected&keep=value';
  navigation.push.mockClear(); navigation.replace.mockClear();
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Clear queue filters' }));
  await screen.findByRole('button', { name: 'View pending items' });
  fireEvent.click(screen.getByRole('button', { name: 'View pending items' }));
  await screen.findByText('No pending review items.');
  expect(navigation.push).not.toHaveBeenCalled();
  expect(navigation.replace).toHaveBeenCalledTimes(2);
  expect(new URLSearchParams(navigation.query).get('keep')).toBe('value');
});


it('pushes cursor pagination without replacing its history entry', async () => {
  navigation.push.mockClear(); navigation.replace.mockClear();
  const original = request.getMockImplementation()!;
  request.mockImplementation(async (url, options) => String(url).startsWith('/api/imports/review/queue?')
    ? json({ items: rows, total: 4, nextCursor: 'next-cursor' }) : original(url, options));
  mount();
  const next = await screen.findByRole('button', { name: 'Next page' });
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  expect(new URLSearchParams(navigation.query).get('cursor')).toBe('next-cursor');
  expect(navigation.push).toHaveBeenCalledOnce();
  expect(navigation.replace).not.toHaveBeenCalled();
});
