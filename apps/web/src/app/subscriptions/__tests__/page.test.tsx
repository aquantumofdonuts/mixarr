import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SubscriptionsPage from '../page';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 7, username: 'listener', displayName: 'Listener', role: 'user' } }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

const subscription = { id: 11, userId: 7, name: 'Night discoveries', type: 'lastfm_chart', config: { country: 'global', limit: 10 }, schedule: '0 0 * * *', resultHandling: 'preview', isActive: true, lastRun: null, lastRunStatus: null, lastRunCount: null, nextRun: null };
let client: QueryClient;
const request = vi.fn<typeof fetch>();
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  request.mockReset();
  request.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path === '/api/subscriptions/11' && options?.method === 'PUT') return new Response(JSON.stringify({ subscription: { ...subscription, schedule: '' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/subscriptions') return new Response(JSON.stringify({ subscriptions: [subscription] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/subscriptions/presets/list') return new Response(JSON.stringify({ presets: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (path === '/api/connections/has-lidarr') return new Response(JSON.stringify({ hasLidarr: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    throw new Error(`Unexpected request: ${options?.method || 'GET'} ${path}`);
  });
  vi.stubGlobal('fetch', request);
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

describe('subscription schedule editing', () => {
  it('sends an explicit empty schedule in the real update request when Manual only is selected', async () => {
    render(<QueryClientProvider client={client}><SubscriptionsPage /></QueryClientProvider>);
    await screen.findByRole('link', { name: 'Night discoveries' });
    fireEvent.click(screen.getByText('More actions').closest('summary')!);
    fireEvent.click(screen.getByRole('button', { name: 'Edit subscription' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Subscription' });
    fireEvent.change(within(dialog).getByLabelText('Schedule'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const update = request.mock.calls.find(([url, options]) => String(url) === '/api/subscriptions/11' && options?.method === 'PUT');
      expect(update).toBeDefined();
      expect(JSON.parse(String(update![1]?.body))).toMatchObject({ name: 'Night discoveries', schedule: '' });
    });
  });
});
