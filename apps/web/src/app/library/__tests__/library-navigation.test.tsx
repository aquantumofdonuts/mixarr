import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LibraryPage from '../page';
import { ListScrollContext } from '@/hooks/useListContext';

const navigation = vi.hoisted(() => ({ query: '', listeners: new Set<() => void>(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/library', useSearchParams: () => new URLSearchParams(useSyncExternalStore(callback => { navigation.listeners.add(callback); return () => navigation.listeners.delete(callback); }, () => navigation.query)), useRouter: () => navigation }));
const actor = vi.hoisted(() => ({ id: 100, role: 'admin' }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: actor, isLoading: false }) }));
vi.mock('@/components/library/duplicates-content', () => ({ DuplicatesContent: () => <p>Duplicate tools</p> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: { get, post: vi.fn() } }));
const mbid = '11111111-1111-4111-8111-111111111111';
const artist = (id: number, name: string, identity = mbid) => ({ id, name, foreignArtistId: identity, monitored: true, albumCount: id, trackCount: 10, trackFileCount: 5, sizeOnDisk: 100, hasOverview: true, hasPoster: true, hasGenres: true, issues: [], needsRefresh: false });
let rows: ReturnType<typeof artist>[], pane: HTMLElement;
function navigate(destination: string) { navigation.query = new URL(destination, 'https://mixarr.invalid').search.slice(1); navigation.listeners.forEach(callback => callback()); }
function mount() { return render(<ListScrollContext.Provider value={pane}><LibraryPage /></ListScrollContext.Provider>); }
function healthCalls() { return get.mock.calls.filter(([path]) => path === '/api/search/lidarr/artists'); }
beforeEach(() => {
  actor.id++; actor.role = 'admin'; navigation.query = ''; navigation.push.mockImplementation(navigate); navigation.replace.mockImplementation(navigate); rows = [artist(1, 'Alpha'), artist(2, 'Zulu'), artist(3, 'Unknown', 'not-an-mbid')]; get.mockReset();
  get.mockImplementation(async (path: string) => ({ data: path.endsWith('/status') ? { status: null } : { artists: rows, total: rows.length, issueStats: { noAlbums: 0, noPoster: 0, noOverview: 0, noGenres: 0 }, healthScore: 100 }, error: null }));
  pane = document.createElement('main'); document.body.append(pane); Object.defineProperties(pane, { scrollHeight: { value: 10000 }, clientHeight: { value: 500 } });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 1));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup(); pane.remove(); vi.unstubAllGlobals(); });
it('sorts with native keyboard buttons, announces aria-sort, and preserves unrelated URL state', async () => {
  navigation.query = 'keep=value&seed=one&seed=two&page=2'; mount();
  const albums = await screen.findByRole('button', { name: 'Albums' });
  const user = userEvent.setup(); albums.focus(); await user.keyboard('{Enter}');
  expect(albums.closest('th')).toHaveAttribute('aria-sort', 'descending');
  expect(new URLSearchParams(navigation.query).get('sort')).toBe('albumCount'); expect(new URLSearchParams(navigation.query).has('page')).toBe(false);
  expect(new URLSearchParams(navigation.query).getAll('seed')).toEqual(['one', 'two']); expect(new URLSearchParams(navigation.query).get('keep')).toBe('value');
  await user.keyboard(' '); expect(albums.closest('th')).toHaveAttribute('aria-sort', 'ascending'); expect(albums).toHaveFocus();
  const table = screen.getByRole('table'); expect(within(table).getAllByRole('row').slice(1).map(row => within(row).getAllByRole('cell')[1].textContent)).toEqual(['Alpha5 / 10 tracks', 'Zulu5 / 10 tracks', 'Unknown5 / 10 tracks']);
  expect(healthCalls()).toHaveLength(1);
});
it('restores URL filters and sorting, preserving selection across the 250-row boundary without extra fetches', async () => {
  rows = Array.from({ length: 251 }, (_, index) => artist(index + 1, `Artist ${index + 1}`)); navigation.query = 'q=Artist&filter=complete&sort=name&dir=asc'; const view = mount();
  const controls = within(view.container.querySelector('details')!.parentElement!);
  const count = view.container.querySelector('p.font-mono')!;
  await waitFor(() => expect(count).toHaveTextContent('250 of 251 matching artists shown · 0 selected')); expect(view.container.querySelectorAll('table input[type=checkbox]')).toHaveLength(251);
  expect(controls.getByRole('textbox', { name: 'Search library snapshot' })).toHaveValue('Artist'); expect(controls.getByRole('combobox', { name: 'Filter library snapshot' })).toHaveValue('complete'); expect(within(view.container.querySelector('thead')!).getByRole('columnheader', { name: 'Artist' })).toHaveAttribute('aria-sort', 'ascending');
  const first = view.container.querySelector<HTMLInputElement>('input[aria-label="Select library artist 1"]')!; fireEvent.click(first);
  const showMore = Array.from(view.container.querySelectorAll('button')).find(button => button.textContent?.startsWith('Show more'))!; fireEvent.click(showMore);
  await waitFor(() => expect(count).toHaveTextContent('251 of 251 matching artists shown · 1 selected')); expect(view.container.querySelectorAll('table input[type=checkbox]')).toHaveLength(252); expect(first).toBeChecked(); expect(new URLSearchParams(navigation.query).get('page')).toBe('2'); expect(healthCalls()).toHaveLength(1);
});
it('restores native selection, main scroll and artist link focus after inspector closure or Back', async () => {
  navigation.query = 'q=Alpha&sort=name&dir=asc&keep=value'; mount(); const link = await screen.findByRole('link', { name: 'Alpha' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Select library artist 1' })); pane.scrollTop = 600; fireEvent.click(link);
  expect(new URLSearchParams(navigation.query).get('artist')).toBe(mbid); pane.scrollTop = 0;
  await act(async () => navigate('/library?q=Alpha&sort=name&dir=asc&keep=value'));
  await waitFor(() => expect(pane.scrollTop).toBe(600)); expect(link).toHaveFocus(); expect(screen.getByRole('checkbox', { name: 'Select library artist 1' })).toBeChecked(); expect(healthCalls()).toHaveLength(1);
});
it('renders unknown identities as plain names and uses native ID-specific selection', async () => {
  mount(); await screen.findByRole('checkbox', { name: 'Select library artist 3' });
  expect(screen.queryByRole('link', { name: 'Unknown' })).toBeNull(); fireEvent.click(screen.getByRole('checkbox', { name: 'Select library artist 3' }));
  expect(screen.getByRole('checkbox', { name: 'Select library artist 3' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Select library artist 1' })).not.toBeChecked();
});
it('debounces typing with replace, replaces filter refinements, and cancels an obsolete draft on filter navigation', async () => {
  navigation.push.mockClear(); navigation.replace.mockClear();
  navigation.query = 'keep=value&page=2'; mount(); await screen.findByRole('link', { name: 'Alpha' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search library snapshot' }), { target: { value: 'Alpha' } });
  await waitFor(() => expect(new URLSearchParams(navigation.query).get('q')).toBe('Alpha')); expect(navigation.replace).toHaveBeenCalled(); expect(new URLSearchParams(navigation.query).has('page')).toBe(false);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search library snapshot' }), { target: { value: 'Discarded draft' } }); fireEvent.change(screen.getByRole('combobox', { name: 'Filter library snapshot' }), { target: { value: 'complete' } });
  await new Promise(resolve => setTimeout(resolve, 350)); expect(new URLSearchParams(navigation.query).get('q')).toBe('Alpha'); expect(new URLSearchParams(navigation.query).get('filter')).toBe('complete'); expect(new URLSearchParams(navigation.query).get('keep')).toBe('value'); expect(navigation.push).not.toHaveBeenCalled(); expect(navigation.replace).toHaveBeenCalledTimes(2);
});
it('validates unsupported URL values and exposes a labeled, keyboard-focusable narrow table region', async () => {
  navigation.query = 'page=Infinity&filter=bogus&sort=bogus&dir=bogus&tab=bogus'; mount();
  const region = await screen.findByRole('region', { name: 'Library artists table, scroll horizontally for metadata and actions' }); expect(region).toHaveAttribute('tabindex', '0'); expect(screen.getByRole('columnheader', { name: 'Issues' })).toHaveAttribute('aria-sort', 'descending'); expect(screen.getByRole('combobox', { name: 'Filter library snapshot' })).toHaveValue('all');
});
it('keeps existing non-admin access restrictions and never fetches their Lidarr snapshot', async () => {
  actor.role = 'user'; mount(); await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith('/')); expect(healthCalls()).toHaveLength(0); expect(screen.queryByRole('table')).toBeNull();
});
it('restores the saved selection when Back returns from a filter that removed its row', async () => {
  mount(); await screen.findByRole('checkbox', { name: 'Select library artist 1' }); fireEvent.click(screen.getByRole('checkbox', { name: 'Select library artist 1' }));
  await act(async () => navigate('/library?q=Zulu')); await screen.findByText('1 of 1 matching artists shown · 0 selected');
  await act(async () => navigate('/library')); expect(screen.getByRole('checkbox', { name: 'Select library artist 1' })).toBeChecked(); expect(healthCalls()).toHaveLength(1);
});
it('restores the duplicates tab from URL and retains health filters while changing tabs', async () => {
  navigation.query = 'tab=duplicates&q=Alpha&filter=complete&sort=name&dir=asc&page=2'; mount(); expect(screen.getByText('Duplicate tools')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Health Issues' })); await screen.findByRole('link', { name: 'Alpha' }); expect(new URLSearchParams(navigation.query).get('q')).toBe('Alpha'); expect(new URLSearchParams(navigation.query).get('page')).toBe('2'); expect(new URLSearchParams(navigation.query).get('sort')).toBe('name');
});
it('activates native checkbox labels and exposes mixed selection before selecting every shown row', async () => {
  mount(); const first = await screen.findByRole('checkbox', { name: 'Select library artist 1' }); fireEvent.click(first.closest('label')!); expect(first).toBeChecked();
  const all = screen.getByRole('checkbox', { name: 'Select shown library artists' }) as HTMLInputElement; expect(all.indeterminate).toBe(true); expect(all).not.toBeChecked();
  fireEvent.click(all.closest('label')!); expect(all).toBeChecked(); expect(all.indeterminate).toBe(false); expect(screen.getByRole('checkbox', { name: 'Select library artist 3' })).toBeChecked();
});
