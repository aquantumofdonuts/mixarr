import { useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DiscoverPage from '../page';
const navigation = vi.hoisted(() => ({ query: '', listeners: new Set<() => void>(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/discover', useSearchParams: () => {
  const query = useSyncExternalStore(callback => { navigation.listeners.add(callback); return () => navigation.listeners.delete(callback); }, () => navigation.query);
  return new URLSearchParams(query);
}, useRouter: () => navigation }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/components/slskd/SearchModal', () => ({ SlskdSearchModal: () => null }));
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const recIds = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const request = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const profiles = { qualityProfiles: [{ id: 1, name: 'Lossless' }, { id: 2, name: 'Portable' }], metadataProfiles: [{ id: 1, name: 'Albums' }], rootFolders: [{ id: 1, path: '/music' }, { id: 2, path: '/archive' }], defaults: { qualityProfileId: 1, metadataProfileId: 1, rootFolderPath: '/music', monitorOption: 'all', monitorNewItems: 'all', searchOnAdd: true } };
const recommendations = () => recIds.map(mbid => ({ mbid, name: 'Same name', matchedFrom: ['Seed Alpha', 'Seed Beta'], matchCount: 2, inLibrary: false }));
function navigate(destination: string) { navigation.query = new URL(destination, 'https://mixarr.invalid').search.slice(1); navigation.listeners.forEach(callback => callback()); }
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 1 } } })) { return { ...render(<QueryClientProvider client={client}><DiscoverPage /></QueryClientProvider>), client }; }
function similarCalls() { return request.mock.calls.filter(([url]) => String(url) === '/api/discover/similar'); }
function addCalls() { return request.mock.calls.filter(([url]) => String(url) === '/api/discover/add'); }
beforeEach(() => {
  sessionStorage.clear(); navigation.query = ''; navigation.push.mockImplementation(navigate); navigation.replace.mockImplementation(navigate); request.mockReset();
  request.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === '/api/connections/has-lidarr') return json({ hasLidarr: true });
    if (path.startsWith('/api/discover/library?')) return json({ artists: ids.map((foreignArtistId, i) => ({ id: i + 1, name: i ? 'Seed Beta' : 'Seed Alpha', foreignArtistId, monitored: true })), pagination: { page: 1, total: 2, totalPages: 1, limit: 50 } });
    if (path === '/api/discover/similar') return json({ recommendations: recommendations(), seedArtists: JSON.parse(String(options?.body)).artistNames, failedSeedArtists: [], total: 2 });
    if (path === '/api/discover/profiles') return json(profiles);
    if (path === '/api/discover/add') return json({ success: true });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('discovery flow', () => {
  it('restores canonical seed URLs, uses scoped seed query keys, and persists names for reload', async () => {
    navigation.query = `seed=${ids[0]}&seed=${ids[0]}&keep=value`;
    const { client, unmount } = mount();
    await screen.findAllByRole('link', { name: 'Same name' });
    expect(similarCalls()).toHaveLength(1);
    expect(JSON.parse(String(similarCalls()[0][1]?.body))).toEqual({ artistNames: ['Seed Alpha'], limit: 100 });
    expect(client.getQueryCache().findAll({ queryKey: ['discover', 'recommendations'] })[0].queryKey).toContain(ids[0]);
    expect(JSON.parse(sessionStorage.getItem('mixarr:discovery-seeds:7')!)).toEqual({ [ids[0]]: 'Seed Alpha' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Seed Beta as seed' }));
    await waitFor(() => expect(similarCalls()).toHaveLength(2));
    expect(JSON.parse(String(similarCalls()[1][1]?.body)).artistNames).toEqual(['Seed Alpha', 'Seed Beta']);
    expect(new URLSearchParams(navigation.query).get('keep')).toBe('value');
    expect(new URLSearchParams(navigation.query).getAll('seed')).toEqual(ids);
    unmount(); mount();
    await screen.findAllByRole('link', { name: 'Same name' });
    expect(screen.getByRole('checkbox', { name: 'Use Seed Alpha as seed' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Use Seed Beta as seed' })).toBeChecked();
  });
  it('cancels superseded seed requests and does not paint late results', async () => {
    const original = request.getMockImplementation()!;
    let finish!: (response: Response) => void;
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' && JSON.parse(String(options?.body)).artistNames.length === 1 ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    navigation.query = `seed=${ids[0]}`; mount();
    await waitFor(() => expect(similarCalls()).toHaveLength(1));
    const signal = similarCalls()[0][1]?.signal;
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Seed Beta as seed' }));
    await screen.findAllByRole('link', { name: 'Same name' });
    expect(signal?.aborted).toBe(true);
    await act(async () => finish(json({ recommendations: [{ ...recommendations()[0], name: 'Stale result' }], seedArtists: ['Seed Alpha'], total: 1 })));
    expect(screen.queryByText('Stale result')).toBeNull();
  });
  it('labels legacy name-only seeds unresolved and never requests them', async () => {
    navigation.query = 'seed=Saved+Name'; mount();
    await screen.findByText('Unresolved saved seed: Saved Name. Choose a library identity.');
    expect(screen.getByRole('button', { name: 'Find similar artists' })).toBeDisabled();
    expect(similarCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Remove seed Saved Name' }));
    expect(screen.getByText('Choose seed artists from your library to find recommendations.')).toBeInTheDocument();
  });
  it('separates no matches, total provider outage, partial availability and HTTP failures', async () => {
    navigation.query = `seed=${ids[0]}`;
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' ? json({ recommendations: [], seedArtists: ['Seed Alpha'], failedSeedArtists: ['Seed Alpha'], total: 0 }) : original(url, options));
    mount();
    await screen.findByText('Last.fm recommendations are unavailable.');
    expect(screen.queryByText('No new matches for these seed artists.')).toBeNull();
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' ? json({ recommendations: [], seedArtists: ['Seed Alpha'], failedSeedArtists: [], total: 0 }) : original(url, options));
    fireEvent.click(screen.getByRole('button', { name: 'Retry recommendations' }));
    await screen.findByText('No new matches for these seed artists.');
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' ? json({ recommendations: recommendations(), seedArtists: ['Seed Alpha', 'Seed Beta'], failedSeedArtists: ['Seed Beta'], total: 2 }) : original(url, options));
    fireEvent.click(screen.getByRole('button', { name: 'Find similar artists' }));
    await screen.findByText('Partial recommendations: Last.fm was unavailable for Seed Beta.');
    expect(screen.getAllByText('Similar to: Seed Alpha, Seed Beta ·', { exact: false })).toHaveLength(2);
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' ? json({ error: 'Read unavailable' }, 503) : original(url, options));
    fireEvent.click(screen.getByRole('button', { name: 'Find similar artists' }));
    await screen.findByText('Last.fm recommendations are unavailable. Read unavailable');
  });
  it('retains canonical selection through reordered results and removes only confirmed same-name additions', async () => {
    navigation.query = `seed=${ids[0]}`; mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Select loaded recommendations' }));
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/similar' ? json({ recommendations: recommendations().reverse(), seedArtists: ['Seed Alpha'], total: 2 }) : original(url, options));
    fireEvent.click(screen.getByRole('button', { name: 'Find similar artists' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'Select Same name' })[0]).toBeChecked());
    const row = screen.getAllByRole('article').find(element => within(element).queryByRole('link', { name: 'Same name' })?.getAttribute('href')?.includes(recIds[1]))!;
    fireEvent.click(within(row).getByRole('button', { name: 'Add artist Same name' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled());
    fireEvent.change(screen.getByRole('combobox', { name: 'Root folder' }), { target: { value: '/archive' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Quality profile' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Search on add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await screen.findByText('In Lidarr');
    expect(screen.getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected · Loaded recommendations');
    expect(JSON.parse(String(addCalls()[0][1]?.body))).toMatchObject({ mbid: recIds[1], rootFolderPath: '/archive', qualityProfileId: 2, searchOnAdd: false });
  });
  it('bulk retries only failed canonical IDs with retained effective options', async () => {
    navigation.query = `seed=${ids[0]}`;
    const original = request.getMockImplementation()!;
    let failed = true;
    request.mockImplementation(async (url, options) => String(url) === '/api/discover/add' && JSON.parse(String(options?.body)).mbid === recIds[1] && failed ? json({ error: 'Provider offline' }, 503) : original(url, options));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Select loaded recommendations' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected artists' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm add' })).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox', { name: 'Search on add' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await screen.findByText(/1 additions failed/);
    expect(addCalls()).toHaveLength(2); expect(screen.getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    failed = false; fireEvent.click(screen.getByRole('button', { name: 'Confirm add' }));
    await waitFor(() => expect(screen.getAllByText('In Lidarr')).toHaveLength(2));
    expect(addCalls()).toHaveLength(3);
    expect(JSON.parse(String(addCalls()[2][1]?.body))).toMatchObject({ mbid: recIds[1], searchOnAdd: false });
  });
  it('restores bounded off-page seed names and leaves unknown canonical seeds explicitly unresolved', async () => {
    sessionStorage.setItem('mixarr:discovery-seeds:7', JSON.stringify({ [recIds[0]]: 'Off-page seed' }));
    navigation.query = `seed=${recIds[0]}`; mount();
    await screen.findAllByRole('link', { name: 'Same name' });
    expect(JSON.parse(String(similarCalls()[0][1]?.body)).artistNames).toEqual(['Off-page seed']);
    act(() => navigate(`/discover?seed=${recIds[1]}`));
    await screen.findByText(`Unresolved seed ID: ${recIds[1]}. Find this artist in your library.`);
    expect(screen.getByRole('button', { name: 'Find similar artists' })).toBeDisabled();
    expect(similarCalls()).toHaveLength(1);
  });
  it('bounds canonical seed persistence and preserves overlapping selection after seed changes', async () => {
    const many = Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (url, options) => String(url).startsWith('/api/discover/library?') ? json({ artists: many.map((foreignArtistId, i) => ({ id: i, foreignArtistId, name: `Seed ${i}` })), pagination: { totalPages: 1, total: 25, page: 1 } }) : original(url, options));
    navigation.query = many.map(id => `seed=${id}`).join('&'); mount();
    await screen.findAllByRole('link', { name: 'Same name' });
    expect(JSON.parse(String(similarCalls()[0][1]?.body)).artistNames).toHaveLength(20);
    expect(Object.keys(JSON.parse(sessionStorage.getItem('mixarr:discovery-seeds:7')!))).toHaveLength(20);
    expect(screen.getByRole('checkbox', { name: 'Use Seed 24 as seed' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded recommendations' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Seed 0 as seed' }));
    await waitFor(() => expect(similarCalls()).toHaveLength(2));
    expect((await screen.findAllByRole('checkbox', { name: 'Select Same name' })).every(input => (input as HTMLInputElement).checked)).toBe(true);
  });
  it('opens inspector links without acquisition and scopes library search to committed URLs', async () => {
    navigation.query = `seed=${ids[0]}&page=2&keep=value`; mount();
    const links = await screen.findAllByRole('link', { name: 'Same name' });
    fireEvent.click(links[0]);
    expect(new URLSearchParams(navigation.query).get('artist')).toBe(recIds[0]); expect(addCalls()).toHaveLength(0);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search library seeds' }), { target: { value: 'new search' } });
    expect(new URLSearchParams(navigation.query).get('q')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Search library' }));
    await waitFor(() => expect(new URLSearchParams(navigation.query).get('q')).toBe('new search'));
    expect(new URLSearchParams(navigation.query).get('page')).toBeNull();
    expect(new URLSearchParams(navigation.query).getAll('seed')).toEqual([ids[0]]);
  });
});
