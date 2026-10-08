import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Home from '../page';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), approve: vi.fn() }));
vi.mock('@/lib/hooks', () => ({
  useFeed: () => ({ data: { pages: [{ items: [{ id: 'feed-1', artistName: 'Artist' }], stats: { pending: 1, addedToday: 0 } }] }, fetchNextPage: vi.fn(), refetch: vi.fn() }),
  useApproveFeedItem: () => ({ mutateAsync: mocks.approve }), useDismissFeedItem: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mocks.toast }) }));
vi.mock('@/components/feed/FeedGrid', () => ({ FeedGrid: ({ onApprove }: { onApprove: (id: string) => void }) => <button onClick={() => onApprove('feed-1')}>Add artist</button> }));
vi.mock('@/components/feed/DashboardTiles', () => ({ DashboardTiles: () => null }));
vi.mock('@/components/feed/StatsBar', () => ({ StatsBar: () => null }));
vi.mock('@/components/layout/page-header', () => ({ PageHeader: () => null }));
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
