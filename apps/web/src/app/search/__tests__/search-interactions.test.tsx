import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SearchPage from '../page';
const navigation = vi.hoisted(() => ({ query: '', listeners: new Set<() => void>(), push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/search', useSearchParams: () => {
  const query = useSyncExternalStore(callback => { navigation.listeners.add(callback); return () => navigation.listeners.delete(callback); }, () => navigation.query);
  return new URLSearchParams(query);
}, useRouter: () => navigation }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/components/slskd/SearchModal', () => ({ SlskdSearchModal: () => null }));
vi.mock('../components/LabelArtistsModal', () => ({ LabelArtistsModal: () => null }));
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
const request = vi.fn<typeof fetch>();
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
function navigate(destination: string) { navigation.query = new URL(destination, 'https://mixarr.invalid').search.slice(1); navigation.listeners.forEach(callback => callback()); }
beforeEach(() => {
  navigation.query = 'q=same'; navigation.push.mockImplementation(navigate); navigation.replace.mockImplementation(navigate); request.mockReset();
  request.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === '/api/search/ai/status') return json({ available: false });
    if (path.startsWith('/api/search/discover?')) return json({ results: ids.map(mbid => ({ mbid, name: 'Same name', sources: ['spotify'] })) });
    if (path === '/api/search/artists/add') return json({ success: true, artist: { foreignArtistId: JSON.parse(String(options?.body)).foreignArtistId } });
    if (path === '/api/search/batch') return json({ added: [ids[0]], skipped: [], failed: [{ id: ids[1], error: 'Provider offline' }] });
    throw new Error(`Unexpected request ${path}`);
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('search actions', () => {
  it('keeps the other same-name artist selected after a single confirmed add', async () => {
    render(<SearchPage />);
    await screen.findByRole('button', { name: 'Select this page' });
    fireEvent.click(screen.getByRole('button', { name: 'Select this page' }));
    const rows = screen.getAllByRole('article');
    fireEvent.click(within(rows[0]).getByRole('button', { name: 'Add artist Same name' }));
    await within(rows[0]).findByText('In Lidarr');
    expect(within(rows[1]).getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
    const call = request.mock.calls.find(([url]) => String(url) === '/api/search/artists/add')!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ foreignArtistId: ids[0] });
  });
  it('retains failed bulk selection and displays its row error', async () => {
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected artists' }));
    await screen.findByText('Provider offline');
    const rows = screen.getAllByRole('article');
    expect(within(rows[1]).getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    expect(within(rows[0]).queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('This page');
  });
  it('links names and artwork to the canonical inspector without adding', async () => {
    render(<SearchPage />);
    const links = await screen.findAllByRole('link', { name: 'Same name' });
    expect(new URL(links[0].getAttribute('href')!, 'https://mixarr.invalid').searchParams.get('artist')).toBe(ids[0]);
    expect(screen.getAllByRole('link', { name: 'Inspect artist Same name' })).toHaveLength(2);
    fireEvent.click(links[1]);
    expect(new URLSearchParams(navigation.query).get('artist')).toBe(ids[1]);
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(0);
  });
  it('does not change committed search while typing and restores query on Back', async () => {
    render(<SearchPage />);
    await screen.findAllByRole('link', { name: 'Same name' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search query' }), { target: { value: 'next' } });
    expect(new URLSearchParams(navigation.query).get('q')).toBe('same');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(new URLSearchParams(navigation.query).get('q')).toBe('next'));
    act(() => navigate('/search?q=same'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Search query' })).toHaveValue('same'));
  });
  it('describes the album artist-level action and records failed acquisition inline', async () => {
    navigation.query = 'q=record&tab=album';
    request.mockImplementation(async (url) => String(url).startsWith('/api/search/album') ? json({ releases: [{ id: 'album', title: 'Record', 'artist-credit': [{ artist: { id: ids[0], name: 'Same name' } }] }], count: 1 }) : String(url).includes('artists/add') ? json({ error: 'Provider offline' }, 503) : json({ available: false }));
    render(<SearchPage />);
    const button = await screen.findByRole('button', { name: 'Add artist Same name' });
    expect(button).toHaveAccessibleDescription('Adds this artist to Lidarr. Lidarr applies its configured album monitoring and search settings.');
    fireEvent.click(button);
    await screen.findByText('Provider offline');
    expect(screen.queryByText('In Lidarr')).toBeNull();
  });
  it('does not apply a late addition to replacement results after leaving and returning to the same URL scope', async () => {
    let finish!: (response: Response) => void;
    request.mockImplementation(async (url) => String(url) === '/api/search/artists/add' ? new Promise(resolve => { finish = resolve; }) : String(url).startsWith('/api/search/discover?') ? json({ results: ids.map(mbid => ({ mbid, name: 'Same name' })) }) : json({ available: false }));
    render(<SearchPage />);
    const buttons = await screen.findAllByRole('button', { name: 'Add artist Same name' });
    fireEvent.click(buttons[0]);
    act(() => navigate('/search?q=other'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('other'));
    act(() => navigate('/search?q=same'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('same'));
    await act(async () => { finish(json({ success: true })); });
    expect(screen.queryByText('In Lidarr')).toBeNull();
  });

  it('prunes absent identities after refreshing the same search while retaining identities still on the page', async () => {
    let searches = 0;
    request.mockImplementation(async (url) => String(url).startsWith('/api/search/discover?') ? json({ results: (++searches === 1 ? ids : [ids[1]]).map(mbid => ({ mbid, name: 'Same name' })) }) : json({ available: false }));
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });
  it('marks only the original provider result after choosing a canonical identity for same-name results', async () => {
    request.mockImplementation(async (url, options) => {
      if (String(url).startsWith('/api/search/discover?')) return json({ results: [{ name: 'Same name', spotifyId: 'one' }, { name: 'Same name', spotifyId: 'two' }] });
      if (String(url) === '/api/search/discover/add') {
        const payload = JSON.parse(String(options?.body));
        return payload.mbid ? json({ success: true, artist: { foreignArtistId: payload.mbid } }) : json({ candidates: [{ id: ids[0], name: 'Same name', disambiguation: 'Original band' }, { id: ids[1], name: 'Same name', disambiguation: 'Other artist' }] });
      }
      return json({ available: false });
    });
    render(<SearchPage />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add artist Same name' }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Select Artist' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Same name Original band' }));
    await screen.findByText('In Lidarr');
    const rows = screen.getAllByRole('article');
    expect(within(rows[0]).getByText('In Lidarr')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('In Lidarr')).toBeNull();
    expect(within(rows[1]).getByRole('button', { name: 'Add artist Same name' })).toBeEnabled();
  });

  it('retains selected identities through a query replacement and prunes only absent results after success', async () => {
    let finish!: (response: Response) => void;
    request.mockImplementation(async url => {
      const path = String(url);
      if (path.includes('q=replacement')) return new Promise(resolve => { finish = resolve; });
      return path.includes('/discover?') ? json({ results: ids.map(mbid => ({ mbid, name: 'Same name' })) }) : json({ available: false });
    });
    render(<SearchPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Select this page' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search query' }), { target: { value: 'replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(request.mock.calls.some(([url]) => String(url).includes('q=replacement'))).toBe(true));
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
    expect(screen.getByRole('button', { name: 'Add selected artists' })).toBeDisabled();
    await act(async () => { finish(json({ results: [{ mbid: ids[1], name: 'Same name' }] })); });
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1));
    expect(screen.getByRole('checkbox', { name: 'Select Same name' })).toBeChecked();
    expect(screen.getByRole('region', { name: 'Bulk actions' })).toHaveTextContent('1 selected');
  });

});
