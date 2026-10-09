import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import type { LabelArtistPage } from '@mixarr/shared-types';
const { mockAddToast, mockApiGet, mockApiPost, chosenOptions } = vi.hoisted(() => ({
  mockAddToast: vi.fn(), mockApiGet: vi.fn(), mockApiPost: vi.fn(),
  chosenOptions: { qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/music', monitorOption: 'missing', searchOnAdd: false },
}));
vi.mock('@/components/artists/AddArtistOptions', () => ({ useAddArtistOptions: () => ({ dialog: null, runWithOptions: (_request: unknown, execute: (options: unknown, current: () => boolean) => Promise<unknown>) => execute(chosenOptions, () => true).catch(() => null) }) }));
vi.mock('@/lib/api', () => ({ api: { get: mockApiGet, post: mockApiPost } }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ addToast: mockAddToast }) }));
vi.mock('@/components/ExternalLinks', () => ({ ExternalLinks: ({ mbid }: { mbid: string }) => <span data-testid={`external-${mbid}`} /> }));
import { LabelArtistsModal } from '../components/LabelArtistsModal';
const artistA = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Alpha', sortName: 'Alpha', imageUrl: null };
const artistB = { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Beta', sortName: 'Beta', imageUrl: null };
const label = { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Warp Records' };
const response = (artists: LabelArtistPage['artists'], releasesProcessed: number, totalReleases: number, nextReleaseOffset: number | null) => ({ data: { artists, releasesProcessed, totalReleases, nextReleaseOffset }, error: null });
const initial = () => mockApiGet.mockResolvedValueOnce(response([artistA], 50, 120, 50));
const ready = () => screen.findByRole('checkbox', { name: 'Select Alpha' });
beforeEach(() => { vi.resetAllMocks(); });

describe('Label artist release pages', () => {
  it('renders nothing without a label and makes no request', () => {
    const { container } = render(<LabelArtistsModal label={null} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement(); expect(mockApiGet).not.toHaveBeenCalled();
  });
  it('counts raw releases and deduplicates artists, including pages with no new artists', async () => {
    initial(); mockApiGet.mockResolvedValueOnce(response([artistA], 50, 120, 100)).mockResolvedValueOnce(response([artistA, artistB], 20, 120, null));
    render(<LabelArtistsModal label={label} onClose={vi.fn()} />); await ready();
    expect(screen.getByText('50 releases checked; 1 artists loaded')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('100 releases checked; 1 artists loaded');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('120 releases checked; 2 artists loaded');
    expect(mockApiGet.mock.calls.map(call => call[0])).toEqual([0, 50, 100].map(offset => `/api/search/label/${label.id}/artists?limit=50&offset=${offset}`));
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText('All reported releases checked.')).toBeVisible();
  });
  it('keeps Load more when no loaded artists match the filter, including a zero-new-artist page', async () => {
    initial(); mockApiGet.mockResolvedValueOnce(response([artistA], 50, 120, 100)).mockResolvedValueOnce(response([artistB], 20, 120, null));
    render(<LabelArtistsModal label={label} onClose={vi.fn()} />); await ready();
    fireEvent.change(screen.getByLabelText('Search loaded artists'), { target: { value: 'Beta' } });
    expect(screen.getByText('No loaded artists match your search.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('100 releases checked; 1 artists loaded');
    expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('checkbox', { name: 'Select Beta' });
    expect(screen.getByLabelText('Search loaded artists')).toHaveValue('Beta');
  });
  it('advances a page without artist credits', async () => {
    mockApiGet.mockResolvedValueOnce(response([], 50, 51, 50)).mockResolvedValueOnce(response([artistB], 1, 51, null));
    render(<LabelArtistsModal label={label} onClose={vi.fn()} />); await screen.findByText('50 releases checked; 0 artists loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByRole('checkbox', { name: 'Select Beta' });
    expect(mockApiGet.mock.calls[1][0]).toContain('offset=50');
  });
  it('keeps filter, selection and progress on failure and retries the identical cursor', async () => {
    initial(); mockApiGet.mockResolvedValueOnce({ data: null, error: 'Provider unavailable' }).mockResolvedValueOnce(response([artistB], 50, 120, 100));
    render(<LabelArtistsModal label={label} onClose={vi.fn()} />); fireEvent.click(await ready());
    fireEvent.change(screen.getByLabelText('Search loaded artists'), { target: { value: 'Alpha' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByRole('alert');
    expect(screen.getByText('50 releases checked; 1 artists loaded')).toBeVisible(); expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('100 releases checked; 2 artists loaded');
    expect(mockApiGet.mock.calls[1][0]).toEqual(mockApiGet.mock.calls[2][0]); expect(screen.getByLabelText('Search loaded artists')).toHaveValue('Alpha');
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked();
  });
  it('keeps the dialog open on initial failure and retries offset zero', async () => {
    mockApiGet.mockResolvedValueOnce({ data: null, error: 'Provider unavailable' }).mockResolvedValueOnce(response([artistA], 1, 1, null));
    const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />); await screen.findByRole('alert'); expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await ready(); expect(mockApiGet.mock.calls[0][0]).toEqual(mockApiGet.mock.calls[1][0]);
  });
  it('aborts a pending request on close and ignores late completion', async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    mockApiGet.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<LabelArtistsModal label={label} onClose={vi.fn()} />); const signal = mockApiGet.mock.calls[0][1].signal as AbortSignal;
    view.rerender(<LabelArtistsModal label={null} onClose={vi.fn()} />); expect(signal.aborted).toBe(true);
    await act(async () => finish(response([artistA], 50, 120, 50))); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('ignores an obsolete page after switching labels', async () => {
    let finish!: (result: ReturnType<typeof response>) => void;
    mockApiGet.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(response([artistB], 1, 1, null));
    const view = render(<LabelArtistsModal label={label} onClose={vi.fn()} />);
    view.rerender(<LabelArtistsModal label={{ id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', name: 'Other label' }} onClose={vi.fn()} />);
    await screen.findByRole('checkbox', { name: 'Select Beta' }); await act(async () => finish(response([artistA], 50, 120, 50)));
    expect(screen.queryByRole('checkbox', { name: 'Select Alpha' })).not.toBeInTheDocument(); expect(screen.getByText('1 releases checked; 1 artists loaded')).toBeVisible();
  });
  it('uses independent native disclosures and footer actions outside the only scroll body', async () => {
    initial(); const { container } = render(<LabelArtistsModal label={label} onClose={vi.fn()} />); await ready();
    const groups = container.querySelectorAll('details'); expect(groups).toHaveLength(2); expect(groups[0]).toHaveAttribute('open'); expect(groups[1]).toHaveAttribute('open');
    groups[0].removeAttribute('open'); expect(groups[1]).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Load more' }).closest('[data-modal-body]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add 0 selected artists' }).closest('[data-modal-body]')).toBeNull();
    expect(container.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(1);
  });
  it('sorts loaded artists locally without changing release paging', async () => {
    mockApiGet.mockResolvedValueOnce(response([artistB, artistA], 2, 2, null)); render(<LabelArtistsModal label={label} onClose={vi.fn()} />); await ready();
    expect(screen.getAllByRole('checkbox').map(node => node.getAttribute('aria-label'))).toEqual(['Select Alpha', 'Select Beta']);
    fireEvent.change(screen.getByLabelText('Sort loaded artists'), { target: { value: 'desc' } });
    expect(screen.getAllByRole('checkbox').map(node => node.getAttribute('aria-label'))).toEqual(['Select Beta', 'Select Alpha']); expect(mockApiGet).toHaveBeenCalledTimes(1);
  });
  it('keeps hidden selections and submits canonical IDs with effective options', async () => {
    mockApiGet.mockResolvedValueOnce(response([artistA, artistB], 2, 2, null)); mockApiPost.mockResolvedValueOnce({ data: { added: [artistA.id, artistB.id], skipped: [], failed: [] }, error: null });
    const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />); fireEvent.click(await ready());
    fireEvent.change(screen.getByLabelText('Search loaded artists'), { target: { value: 'Beta' } }); fireEvent.click(screen.getByRole('button', { name: 'Select all matching artists' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected artists' }));
    await waitFor(() => expect(mockApiPost).toHaveBeenCalledWith('/api/search/batch', { artistIds: [artistA.id, artistB.id], ...chosenOptions })); expect(onClose).toHaveBeenCalledOnce();
  });
  it('removes only successful selections on partial bulk failure', async () => {
    mockApiGet.mockResolvedValueOnce(response([artistA, artistB], 2, 2, null)); mockApiPost.mockResolvedValueOnce({ data: { added: [artistA.id], skipped: [], failed: [{ id: artistB.id, error: 'Unavailable' }] }, error: null });
    const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />); await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Select all loaded artists' })); fireEvent.click(screen.getByRole('button', { name: 'Add 2 selected artists' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).not.toBeChecked()); expect(screen.getByRole('checkbox', { name: 'Select Beta' })).toBeChecked(); expect(onClose).not.toHaveBeenCalled();
  });
  it('keeps selections after a failed bulk request', async () => {
    initial(); mockApiPost.mockResolvedValueOnce({ data: null, error: 'Unavailable' }); const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />); fireEvent.click(await ready());
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected artists' })); await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' })));
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeChecked(); expect(onClose).not.toHaveBeenCalled();
  });
  it('closes on Escape using the shared modal', async () => {
    initial(); const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />); await ready(); fireEvent.keyDown(document, { key: 'Escape' }); expect(onClose).toHaveBeenCalledOnce();
  });
  it('submits more than 100 loaded selections in bounded chunks with the same options', async () => {
    const artists = Array.from({ length: 101 }, (_, index) => ({ ...artistA, id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, '0')}`, name: `Artist ${String(index).padStart(3, '0')}` }));
    mockApiGet.mockResolvedValueOnce(response(artists.slice(0, 50), 50, 101, 50)).mockResolvedValueOnce(response(artists.slice(50, 100), 50, 101, 100)).mockResolvedValueOnce(response(artists.slice(100), 1, 101, null));
    mockApiPost.mockImplementation((_url: string, body: { artistIds: string[] }) => Promise.resolve({ data: { added: body.artistIds, skipped: [], failed: [] }, error: null }));
    const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />);
    await screen.findByRole('checkbox', { name: 'Select Artist 000' }); fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByText('100 releases checked; 100 artists loaded'); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('101 releases checked; 101 artists loaded'); fireEvent.click(screen.getByRole('button', { name: 'Select all loaded artists' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add 101 selected artists' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(mockApiPost.mock.calls.map(call => call[1])).toEqual([{ artistIds: artists.slice(0, 100).map(artist => artist.id), ...chosenOptions }, { artistIds: [artists[100].id], ...chosenOptions }]);
  });
  it('retains unconfirmed later chunks while removing only earlier confirmed identities', async () => {
    const artists = Array.from({ length: 101 }, (_, index) => ({ ...artistA, id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(index).padStart(12, '0')}`, name: `Artist ${String(index).padStart(3, '0')}` }));
    mockApiGet.mockResolvedValueOnce(response(artists.slice(0, 50), 50, 101, 50)).mockResolvedValueOnce(response(artists.slice(50, 100), 50, 101, 100)).mockResolvedValueOnce(response(artists.slice(100), 1, 101, null));
    mockApiPost.mockImplementationOnce((_url: string, body: { artistIds: string[] }) => Promise.resolve({ data: { added: body.artistIds.slice(1), skipped: [], failed: [{ id: body.artistIds[0], error: 'Unavailable' }] }, error: null })).mockResolvedValueOnce({ data: null, error: 'Timeout' });
    const onClose = vi.fn(); render(<LabelArtistsModal label={label} onClose={onClose} />);
    await screen.findByRole('checkbox', { name: 'Select Artist 000' }); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('100 releases checked; 100 artists loaded'); fireEvent.click(screen.getByRole('button', { name: 'Load more' })); await screen.findByText('101 releases checked; 101 artists loaded'); fireEvent.click(screen.getByRole('button', { name: 'Select all loaded artists' })); fireEvent.click(screen.getByRole('button', { name: 'Add 101 selected artists' }));
    await screen.findByRole('button', { name: 'Add 2 selected artists' });
    expect(screen.getByRole('checkbox', { name: 'Select Artist 000' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Select Artist 100' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Select Artist 001' })).not.toBeChecked();
    expect(onClose).not.toHaveBeenCalled(); expect(mockApiPost).toHaveBeenCalledTimes(2);
  });

});
