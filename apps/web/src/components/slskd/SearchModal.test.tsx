import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SlskdSearchModal } from './SearchModal';
import { ToastProvider } from '@/components/ui/toast';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({ api: { post: vi.fn(), get: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.post).mockResolvedValue({ data: { id: 'search-1' }, error: null, status: 200 });
  vi.mocked(api.get).mockResolvedValue({ data: { id: 'search-1', state: 'Completed', responses: [], fileCount: 0, responseCount: 0 }, error: null, status: 200 });
});
it.each(['Completed', 'Completed, TimedOut', 'Completed, Cancelled', 'Errored'])('shows results after terminal search state %s', async state => {
  vi.mocked(api.get).mockResolvedValue({ data: { id: 'search-1', state, responses: [], fileCount: 0, responseCount: 0 }, error: null, status: 200 });
  render(<ToastProvider><SlskdSearchModal isOpen onClose={vi.fn()} artistName="Stone Temple Pilots" /></ToastProvider>);
  expect(await screen.findByText('Found 0 sources with 0 files')).toBeInTheDocument();
  expect(screen.queryByText('Searching Soulseek network...')).not.toBeInTheDocument();
});
it('opens a manual search using seconds accepted by the Mixarr API', async () => {
  render(<ToastProvider><SlskdSearchModal isOpen onClose={vi.fn()} artistName="Stone Temple Pilots" /></ToastProvider>);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/slskd/search', {
    query: 'Stone Temple Pilots', options: { searchTimeout: 30, filterResponses: true, minimumPeerUploadSpeed: 0 },
  }));
});
