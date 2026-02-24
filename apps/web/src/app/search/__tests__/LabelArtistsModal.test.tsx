import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// Hoist mocks so they're available inside vi.mock factories
const { mockAddToast, mockApiGet, mockApiPost } = vi.hoisted(() => ({
  mockAddToast: vi.fn(),
  mockApiGet: vi.fn(),
  mockApiPost: vi.fn(),
}));

// Mock api module
vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: mockApiPost,
  },
}));

// Mock toast module
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast, toasts: [], removeToast: vi.fn() }),
}));

// Mock ExternalLinks — simple stub (renders only data-testid, no text to avoid duplicate text matches)
vi.mock('@/components/ExternalLinks', () => ({
  ExternalLinks: ({ mbid }: { mbid: string; artistName: string }) => (
    <span data-testid={`external-links-${mbid}`} />
  ),
}));

// Mock lucide-react icons as simple spans
vi.mock('lucide-react/dist/esm/icons/check-square', () => ({
  default: (props: any) => <span data-testid="icon-check-square" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/loader-2', () => ({
  default: (props: any) => <span data-testid="icon-loader" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/music', () => ({
  default: (props: any) => <span data-testid="icon-music" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/plus', () => ({
  default: (props: any) => <span data-testid="icon-plus" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/search', () => ({
  default: (props: any) => <span data-testid="icon-search" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/square', () => ({
  default: (props: any) => <span data-testid="icon-square" {...props} />,
}));
vi.mock('lucide-react/dist/esm/icons/x', () => ({
  default: (props: any) => <span data-testid="icon-x" {...props} />,
}));

import { LabelArtistsModal } from '../components/LabelArtistsModal';

// ─── Helpers ─────────────────────────────────────────────────────────

const makeArtists = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, i) => ({
    id: `mbid-${offset + i}`,
    name: `Artist ${String(offset + i).padStart(3, '0')}`,
    imageUrl: i % 2 === 0 ? `https://img/${offset + i}.jpg` : null,
  }));

const defaultProps = {
  label: { name: 'Warp Records', id: 'label-1' },
  onClose: vi.fn(),
};

function mockInitialFetch(artists = makeArtists(3), count?: number) {
  mockApiGet.mockResolvedValueOnce({
    data: { artists, count: count ?? artists.length },
    error: null,
    status: 200,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('LabelArtistsModal', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ─── Rendering ──────────────────────────────────────────────────

  it('renders nothing when label is null', () => {
    const { container } = render(
      <LabelArtistsModal label={null} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders label name in the header', async () => {
    mockInitialFetch();
    render(<LabelArtistsModal {...defaultProps} />);
    expect(screen.getByText('Warp Records')).toBeInTheDocument();
  });

  // ─── Fetching ──────────────────────────────────────────────────

  it('fetches artists on open', async () => {
    mockInitialFetch();
    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith(
        '/api/search/label/label-1/artists?limit=50&offset=0',
      );
    });
  });

  it('displays fetched artists', async () => {
    const artists = makeArtists(3);
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Artist 000')).toBeInTheDocument();
      expect(screen.getByText('Artist 001')).toBeInTheDocument();
      expect(screen.getByText('Artist 002')).toBeInTheDocument();
    });
  });

  it('shows artist count after loading', async () => {
    mockInitialFetch(makeArtists(3), 42);
    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('42 artists found')).toBeInTheDocument();
    });
  });

  it('shows error toast and closes on fetch failure', async () => {
    mockApiGet.mockResolvedValueOnce({
      data: null,
      error: 'Network error',
      status: 0,
    });
    const onClose = vi.fn();

    render(<LabelArtistsModal {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Failed to load artists' }),
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows info toast when label has no artists', async () => {
    mockInitialFetch([], 0);
    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', title: 'No artists found for this label' }),
      );
    });
  });

  // ─── Filter ─────────────────────────────────────────────────────

  it('filter narrows the displayed list', async () => {
    const artists = [
      { id: '1', name: 'Aphex Twin', imageUrl: null },
      { id: '2', name: 'Boards of Canada', imageUrl: null },
      { id: '3', name: 'Autechre', imageUrl: null },
    ];
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    // Wait for artists to load
    await waitFor(() => {
      expect(screen.getByText('Aphex Twin')).toBeInTheDocument();
    });

    // Type in filter
    const filterInput = screen.getByPlaceholderText('Filter artists by name...');
    fireEvent.change(filterInput, { target: { value: 'board' } });

    // Only Boards of Canada should be visible
    expect(screen.getByText('Boards of Canada')).toBeInTheDocument();
    expect(screen.queryByText('Aphex Twin')).not.toBeInTheDocument();
    expect(screen.queryByText('Autechre')).not.toBeInTheDocument();
  });

  it('shows "No artists match your search" when filter has no matches', async () => {
    const artists = [{ id: '1', name: 'Aphex Twin', imageUrl: null }];
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Aphex Twin')).toBeInTheDocument();
    });

    const filterInput = screen.getByPlaceholderText('Filter artists by name...');
    fireEvent.change(filterInput, { target: { value: 'zzzzz' } });

    expect(screen.getByText('No artists match your search')).toBeInTheDocument();
  });

  // ─── Selection ─────────────────────────────────────────────────

  it('select and deselect an artist by clicking', async () => {
    const artists = [{ id: '1', name: 'Aphex Twin', imageUrl: null }];
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Aphex Twin')).toBeInTheDocument();
    });

    // Click artist row to select
    const row = screen.getByText('Aphex Twin').closest('.flex.items-center')!;
    fireEvent.click(row);

    // Should show "Add 1 Selected" button
    expect(screen.getByText(/Add 1 Selected/)).toBeInTheDocument();

    // Click again to deselect
    fireEvent.click(row);

    // "Add N Selected" should disappear
    expect(screen.queryByText(/Add \d+ Selected/)).not.toBeInTheDocument();
  });

  it('Select All selects all displayed artists', async () => {
    const artists = makeArtists(3);
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Artist 000')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Select All'));

    expect(screen.getByText(/Add 3 Selected/)).toBeInTheDocument();
  });

  it('Deselect All clears all selections', async () => {
    const artists = makeArtists(3);
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Artist 000')).toBeInTheDocument();
    });

    // Select all then deselect
    fireEvent.click(screen.getByText('Select All'));
    expect(screen.getByText(/Add 3 Selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Deselect All'));
    expect(screen.queryByText(/Add \d+ Selected/)).not.toBeInTheDocument();
  });

  // ─── Batch add ─────────────────────────────────────────────────

  it('batch add calls /api/search/batch with selected artist ids', async () => {
    const artists = [
      { id: 'mbid-a', name: 'Artist A', imageUrl: null },
      { id: 'mbid-b', name: 'Artist B', imageUrl: null },
    ];
    mockInitialFetch(artists);

    mockApiPost.mockResolvedValueOnce({
      data: { added: ['mbid-a', 'mbid-b'], skipped: [], failed: [] },
      error: null,
      status: 200,
    });

    const onClose = vi.fn();
    render(<LabelArtistsModal {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Artist A')).toBeInTheDocument();
    });

    // Select all
    fireEvent.click(screen.getByText('Select All'));

    // Click add button
    const addBtn = screen.getByText(/Add 2 Selected/);
    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/search/batch', {
        artistIds: expect.arrayContaining(['mbid-a', 'mbid-b']),
      });
    });

    // Success toast shown
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', title: 'Artists added' }),
    );

    // Modal closed after successful batch add
    expect(onClose).toHaveBeenCalled();
  });

  it('batch add shows error toast on failure', async () => {
    const artists = [{ id: 'mbid-a', name: 'Artist A', imageUrl: null }];
    mockInitialFetch(artists);

    mockApiPost.mockResolvedValueOnce({
      data: null,
      error: 'Server error',
      status: 500,
    });

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Artist A')).toBeInTheDocument();
    });

    // Select and add
    fireEvent.click(screen.getByText('Select All'));
    const addBtn = screen.getByText(/Add 1 Selected/);
    await act(async () => {
      fireEvent.click(addBtn);
    });

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', title: 'Failed to add artists' }),
      );
    });
  });

  // ─── Close ──────────────────────────────────────────────────────

  it('calls onClose when close button is clicked', async () => {
    mockInitialFetch();
    const onClose = vi.fn();

    render(<LabelArtistsModal {...defaultProps} onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByText('Artist 000')).toBeInTheDocument();
    });

    // Find the close button — it's the button containing the X icon
    const xIcon = screen.getByTestId('icon-x');
    const closeBtn = xIcon.closest('button')!;
    fireEvent.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });

  // ─── Infinite scroll ──────────────────────────────────────────

  it('loads more artists when scrolled to bottom', async () => {
    // First page: 50 artists (full page => hasMore = true)
    const firstPage = makeArtists(50);
    mockApiGet.mockResolvedValueOnce({
      data: { artists: firstPage, count: 75 },
      error: null,
      status: 200,
    });

    // Second page: 25 more
    const secondPage = makeArtists(25, 50);
    mockApiGet.mockResolvedValueOnce({
      data: { artists: secondPage, count: 75 },
      error: null,
      status: 200,
    });

    render(<LabelArtistsModal {...defaultProps} />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Artist 000')).toBeInTheDocument();
    });

    // Simulate scroll to bottom — find the scroll container by class
    const scrollContainer = document.querySelector('.overflow-auto')!;
    Object.defineProperty(scrollContainer, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollTop', { value: 900, configurable: true });
    Object.defineProperty(scrollContainer, 'clientHeight', { value: 100, configurable: true });

    fireEvent.scroll(scrollContainer);

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledTimes(2);
      expect(mockApiGet).toHaveBeenLastCalledWith(
        '/api/search/label/label-1/artists?limit=50&offset=50',
      );
    });
  });

  // ─── Sort ──────────────────────────────────────────────────────

  it('sorts artists by name descending when sort changed', async () => {
    const artists = [
      { id: '1', name: 'Alpha', imageUrl: null },
      { id: '2', name: 'Charlie', imageUrl: null },
      { id: '3', name: 'Bravo', imageUrl: null },
    ];
    mockInitialFetch(artists);

    render(<LabelArtistsModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeInTheDocument();
    });

    // Default sort is A→Z; switch to Z→A
    const sortSelect = document.querySelector('select')!;
    fireEvent.change(sortSelect, { target: { value: 'desc' } });

    // Get the order of artist names from the .font-medium spans
    const nameSpans = document.querySelectorAll('span.font-medium');
    const names = Array.from(nameSpans).map((el) => el.textContent);

    expect(names).toEqual(['Charlie', 'Bravo', 'Alpha']);
  });
});
