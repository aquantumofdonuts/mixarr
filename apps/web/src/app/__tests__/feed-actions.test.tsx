import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Home from '../page';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), approve: vi.fn(), dismiss: vi.fn(), restore: vi.fn(), replace: vi.fn(), grid: vi.fn(), feed: { current: null as any }, context: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useFeed: () => mocks.feed.current,
  useApproveFeedItem: () => ({ mutateAsync: mocks.approve }), useDismissFeedItem: () => ({ mutateAsync: mocks.dismiss }), useRestoreDecision: () => ({ mutateAsync: mocks.restore }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/components/feed/FeedGrid', () => ({ FeedGrid: (props: any) => { mocks.grid(props); return <><button onClick={() => Promise.resolve(props.onApprove('feed-1')).catch(() => {})}>Add artist</button><button onClick={() => props.onDismiss('feed-1')}>Dismiss artist</button><p>{props.items[0]?.acquisitionState || 'available'}</p></>; } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('seed=one&seed=two'), usePathname: () => '/', useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/hooks/useListContext', () => ({ useListContext: (options: any) => { mocks.context(options); return { remember: vi.fn() }; } }));
beforeEach(() => { vi.clearAllMocks(); mocks.feed.current = { data: { pages: [{ items: [{ id: 'feed-1', artistName: 'Artist', artistMbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }], stats: { pending: 1, addedToday: 0 } }] }, fetchNextPage: vi.fn(), refetch: vi.fn() }; });
vi.mock('@/components/feed/DashboardTiles', () => ({ DashboardTiles: () => null }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
describe('feed acquisition feedback', () => {
  it.each(['failed', 'uncertain'] as const)('never announces %s as a successful addition', async state => {
    mocks.toast.mockClear(); mocks.approve.mockResolvedValue({ artistName: 'Artist', outcome: { state, message: 'Retry to check membership' } });
    render(<Home />); fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ type: 'error', title: 'Addition unconfirmed', message: 'Retry to check membership' }));
  });
  it('announces existing membership distinctly', async () => {
    mocks.toast.mockClear(); mocks.approve.mockResolvedValue({ artistName: 'Artist', outcome: { state: 'already-in-library', message: 'Artist is already in Lidarr' } });
    render(<Home />); fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ type: 'success', title: 'Already in Lidarr', message: 'Artist is already in Lidarr' }));
  });
});

it('persists view choice while preserving repeated parent parameters', () => {
  render(<Home />); fireEvent.click(screen.getByRole('button', { name: 'Artwork' }));
  expect(mocks.replace).toHaveBeenCalledWith('/?seed=one&seed=two&view=artwork', { scroll: false });
});
it('retains confirmed row snapshots when refetch removes the acquired artist', async () => {
  mocks.approve.mockResolvedValue({ outcome: { state: 'added', message: 'Confirmed by Lidarr' } });
  const view = render(<Home />); fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
  await waitFor(() => expect(screen.getByText('added')).toBeInTheDocument());
  mocks.feed.current = { ...mocks.feed.current, data: { pages: [{ items: [], stats: { pending: 0, addedToday: 1 } }] } }; view.rerender(<Home />);
  expect(mocks.grid.mock.lastCall![0].items[0]).toMatchObject({ id: 'feed-1', acquisitionState: 'added', acquisitionMessage: 'Confirmed by Lidarr' });
});
it('restores a signed dismissal once immediately, then ignores repeated Undo activation', async () => {
  mocks.dismiss.mockResolvedValue({ artistName: 'Artist', undoToken: 'signed', undoExpiresAt: new Date(Date.now() + 120000).toISOString() });
  mocks.restore.mockResolvedValue({ restoredIds: [1] }); render(<Home />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss artist' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  const toast = mocks.toast.mock.lastCall![0]; expect(toast.duration).toBeLessThanOrEqual(10000); expect(toast.action.label).toBe('Undo');
  await toast.action.onClick(); await toast.action.onClick(); expect(mocks.restore).toHaveBeenCalledExactlyOnceWith('signed');
});
it('offers a failed Undo retry with the same valid token and guards concurrent activation', async () => {
  mocks.dismiss.mockResolvedValue({ artistName: 'Artist', undoToken: 'signed', undoExpiresAt: new Date(Date.now() + 120000).toISOString() });
  mocks.restore.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce({ restoredIds: [1] }); render(<Home />);
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss artist' })); await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  await mocks.toast.mock.lastCall![0].action.onClick();
  const retry = mocks.toast.mock.lastCall![0]; expect(retry.action.label).toBe('Retry Undo');
  await retry.action.onClick(); expect(mocks.restore.mock.calls).toEqual([['signed'], ['signed']]);
});
it('keeps data visible during a background error and defers scroll restoration until feed data exists', () => {
  mocks.feed.current.error = new Error('Network unavailable'); render(<Home />);
  expect(screen.getByText(/Existing discoveries remain visible/)).toBeInTheDocument();
  expect(mocks.grid.mock.lastCall![0].items).toHaveLength(1);
  expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ ready: true }));
});

it.each([['IDENTITY_REQUIRED', 'identity-required'], ['CONNECTION_REQUIRED', 'connection-required']])('retains %s recovery after the feed refetches unchanged pending data', async (code, state) => {
  mocks.approve.mockRejectedValueOnce(Object.assign(new Error('Original provider recovery message'), { code }));
  const view = render(<Home />); fireEvent.click(screen.getByRole('button', { name: 'Add artist' }));
  await waitFor(() => expect(screen.getByText(state)).toBeInTheDocument());
  view.rerender(<Home />); expect(mocks.grid.mock.lastCall![0].items[0].acquisitionMessage).toBe('Original provider recovery message');
});
it('defers restoration during initial data loading', () => {
  mocks.feed.current = { ...mocks.feed.current, data: undefined, isLoading: true }; render(<Home />);
  expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ ready: false }));
});
it('prevents duplicate Add requests and allows polling to recover an existing in-progress claim', async () => {
  let reject!: (value: unknown) => void;
  mocks.approve.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
  const view = render(<Home />); const add = screen.getByRole('button', { name: 'Add artist' });
  fireEvent.click(add); fireEvent.click(add); expect(mocks.approve).toHaveBeenCalledTimes(1);
  reject(Object.assign(new Error('Existing provider claim'), { code: 'IN_PROGRESS' }));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
  mocks.feed.current.data = { pages: [{ ...mocks.feed.current.data.pages[0], items: [{ ...mocks.feed.current.data.pages[0].items[0], acquisitionState: 'uncertain' }] }] }; view.rerender(<Home />);
  expect(mocks.grid.mock.lastCall![0].items[0].acquisitionState).toBe('uncertain');
});
