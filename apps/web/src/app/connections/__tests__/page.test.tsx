import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import ConnectionsPage from '../page';
import { api } from '@/lib/api';
import type { Connection } from '../components/ConnectionCard';
const mocks = vi.hoisted(() => ({ user: { id: 7, role: 'admin' as 'admin' | 'user' }, params: new URLSearchParams(), replace: vi.fn(), push: vi.fn(), toast: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.params, useRouter: () => ({ replace: mocks.replace, push: mocks.push }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('../components/LidarrMaintenance', () => ({ LidarrMaintenance: () => <span>Maintenance</span> }));
const source = (overrides: Partial<Connection> = {}): Connection => ({ id: 4, userId: 7, name: 'Configured source', type: 'lastfm', isActive: true, lastTest: null, createdAt: '2026-10-07T12:00:00Z', ...overrides });
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: 2, retryDelay: 0 } } })) {
  client.setQueryData(['auth'], { user: mocks.user });
  const Wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { ...render(<ConnectionsPage />, { wrapper: Wrapper }), client };
}
beforeEach(() => { vi.resetAllMocks(); mocks.user = { id: 7, role: 'admin' }; mocks.params = new URLSearchParams(); vi.mocked(api.get).mockResolvedValue({ data: { connections: [source()] }, error: null, status: 200 }); });
describe('connections page', () => {
  it('shows configured rows first and hides the provider catalog until Add connection', async () => {
    mount();
    await screen.findByRole('article', { name: 'Configured source' });
    expect(screen.queryByTestId('type-card-spotify')).toBeNull();
    expect(screen.queryByText('Welcome to Mixarr!')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(screen.getByTestId('type-card-spotify')).toBeInTheDocument();
    expect(screen.getByTestId('type-card-slskd')).toBeInTheDocument();
  });
  it.each([false, true])('uses the refetched server timestamp with session verdict, then Unknown on reload (passed=%s)', async passed => {
    const serverTimestamp = '2026-10-09T10:00:00Z';
    let lastTest: string | null = null;
    vi.mocked(api.get).mockImplementation(async () => ({ data: { connections: [source({ lastTest })] }, error: null, status: 200 }));
    vi.mocked(api.post).mockImplementation(async () => { lastTest = serverTimestamp; return { data: { success: passed, message: 'Invalid key' }, error: null, status: 200 }; });
    const view = mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Test' }));
    await screen.findByText(passed ? 'Pass' : 'Fail');
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('time')).toHaveAttribute('dateTime', serverTimestamp));
    if (!passed) expect(screen.getByRole('alert')).toHaveTextContent('Invalid key');
    expect(screen.getByText(passed ? 'Pass' : 'Fail')).toBeInTheDocument();
    view.unmount();
    mount();
    await screen.findByText('Unknown');
    expect(screen.queryByText('Fail')).toBeNull();
    expect(screen.queryByText('Pass')).toBeNull();
    expect(document.querySelector('time')).toHaveAttribute('dateTime', serverTimestamp);
  });
  it.each([null, {}, { connections: [null] }, { connections: 'invalid' }])('keeps malformed GET data in an error state with Retry: %j', async data => {
    vi.mocked(api.get).mockResolvedValue({ data, error: null, status: 200 });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid connections response');
    expect(screen.queryByText('No configured connections')).toBeNull();
    vi.mocked(api.get).mockResolvedValue({ data: { connections: [source()] }, error: null, status: 200 });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('article', { name: 'Configured source' });
  });
  it('retains usable cached rows through a failed refetch', async () => {
    const view = mount();
    await screen.findByRole('article', { name: 'Configured source' });
    vi.mocked(api.get).mockResolvedValue({ data: null, error: 'Unavailable', status: 503 });
    await view.client.invalidateQueries({ queryKey: ['connections'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unavailable');
    expect(screen.getByRole('article', { name: 'Configured source' })).toBeInTheDocument();
  });
  it('explains retained subscriptions and keeps a failed delete in its confirmation for Retry', async () => {
    vi.mocked(api.delete).mockResolvedValueOnce({ data: null, error: 'Delete unavailable', status: 503 });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('Linked subscriptions are retained but lose this connection and need reconfiguration');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await within(dialog).findByText(/Delete failed: Delete unavailable/);
    expect(api.delete).toHaveBeenCalledTimes(1);
    vi.mocked(api.delete).mockResolvedValueOnce({ data: null, error: null, status: 204 });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.delete).toHaveBeenCalledTimes(2);
  });
  it('keeps member access to global Lidarr read-only while allowing Test', async () => {
    mocks.user.role = 'user';
    vi.mocked(api.get).mockResolvedValue({ data: { connections: [source({ userId: null, type: 'lidarr' })] }, error: null, status: 200 });
    mount();
    expect(await screen.findByRole('button', { name: 'Test' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.queryByText('Maintenance')).toBeNull();
  });
  it('clears a canceled wizard test without accepting the retired provider response', async () => {
    vi.mocked(api.get).mockImplementation(async path => path === '/api/connections/4'
      ? { data: { connection: { config: { username: 'listener' } } }, error: null, status: 200 }
      : { data: { connections: [source()] }, error: null, status: 200 });
    vi.mocked(api.put).mockResolvedValue({ data: {}, error: null, status: 200 });
    let resolveTest!: (value: any) => void;
    vi.mocked(api.post).mockReturnValueOnce(new Promise(done => { resolveTest = done; }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByPlaceholderText('Last.fm API key'), { target: { value: 'replacement-key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Testing connection…');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    resolveTest({ data: { success: true }, error: null, status: 200 });
    await waitFor(() => expect(screen.getByText('Unknown')).toBeInTheDocument());
    expect(screen.queryByText('Pass')).toBeNull();
  });

  it('does not turn a forged callback into authorization and preserves unrelated query state', async () => {
    mocks.params = new URLSearchParams('spotify_authorized=4&source=keep');
    vi.mocked(api.get).mockImplementation(async path => path.endsWith('/status') ? { data: { authorized: false, expired: false, needsReauthorization: true }, error: null, status: 200 } : { data: { connections: [source({ type: 'spotify' })] }, error: null, status: 200 });
    mount();
    await screen.findByText('Authorization: Required');
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith('/connections?source=keep', { scroll: false });
    expect(screen.queryByText('Authorization: Authorized')).toBeNull();
  });
});
