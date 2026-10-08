import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useDashboardStats, queryKeys } from '../hooks';
const actor = vi.hoisted(() => ({ id: 1 as number | null }));
vi.mock('../auth', () => ({ useAuth: () => ({ user: actor.id === null ? null : { id: actor.id } }) }));
let clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  return { client, wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
beforeEach(() => { actor.id = 1; vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ stats: { pendingReviews: 3 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))); });
afterEach(() => { cleanup(); clients.forEach(client => client.clear()); clients = []; vi.unstubAllGlobals(); });
it('does not request an anonymous dashboard summary', () => {
  actor.id = null; const { wrapper } = setup(); const { result } = renderHook(() => useDashboardStats(), { wrapper });
  expect(result.current.fetchStatus).toBe('idle'); expect(fetch).not.toHaveBeenCalled();
});
it('keys summaries by actor and never paints the prior actor count after changing actors', async () => {
  const { client, wrapper } = setup(); const { result, rerender } = renderHook(() => useDashboardStats(), { wrapper });
  await waitFor(() => expect(result.current.data?.pendingReviews).toBe(3));
  expect(client.getQueryData([...queryKeys.dashboardStats, 1])).toMatchObject({ pendingReviews: 3 });
  actor.id = 2; vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ stats: { pendingReviews: 8 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  rerender(); expect(result.current.data).toBeUndefined();
  await waitFor(() => expect(result.current.data?.pendingReviews).toBe(8));
  expect(client.getQueryData([...queryKeys.dashboardStats, 2])).toMatchObject({ pendingReviews: 8 });
});
