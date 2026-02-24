import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LidarrMaintenance } from '../components/LidarrMaintenance';

// ---------------------------------------------------------------------------
// Mock the API module
// ---------------------------------------------------------------------------

const mockAddToast = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast }),
}));

import { api } from '@/lib/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fresh QueryClient with retries disabled for deterministic tests. */
function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

const mockStats = {
  total: 150,
  needingRefresh: 10,
  issueStats: {
    noAlbums: 3,
    noPoster: 2,
    noOverview: 4,
    noGenres: 1,
  },
};

const cleanStats = {
  total: 80,
  needingRefresh: 0,
  issueStats: {
    noAlbums: 0,
    noPoster: 0,
    noOverview: 0,
    noGenres: 0,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LidarrMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddToast.mockClear();
  });

  // --- Data fetching & display -------------------------------------------

  it('fetches and displays library stats on mount', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
    });

    expect(api.get).toHaveBeenCalledWith('/api/search/lidarr/artists');
    expect(screen.getByText('Total Artists')).toBeInTheDocument();
  });

  it('displays issue breakdown stats', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('No Albums')).toBeInTheDocument();
    });

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('No Poster')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('No Bio')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('No Genres')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  // --- Refresh buttons ---------------------------------------------------

  it('shows refresh buttons when there are issues needing refresh', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/Refresh All Issues/)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Refresh 3 with No Albums/),
    ).toBeInTheDocument();
  });

  it('hides refresh buttons when no issues need refreshing', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: cleanStats,
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText('Total Artists')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Refresh All Issues/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Refresh.*with No Albums/),
    ).not.toBeInTheDocument();
  });

  it('refresh button calls the correct endpoint with issueType "any"', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, refreshed: 10, message: 'Refreshed 10 artists' },
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/Refresh All Issues/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Refresh All Issues/));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/api/search/lidarr/artists/refresh-by-issue',
        { issueType: 'any', limit: 50 },
      );
    });
  });

  it('no-albums refresh button calls endpoint with issueType "no_albums"', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, refreshed: 3, message: 'Refreshed 3 artists' },
      error: null,
      status: 200,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/Refresh 3 with No Albums/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Refresh 3 with No Albums/));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/api/search/lidarr/artists/refresh-by-issue',
        { issueType: 'no_albums', limit: 50 },
      );
    });
  });

  // --- Loading state -----------------------------------------------------

  it('shows loading state while fetching stats', () => {
    // Return a promise that never resolves to keep the loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('Library Maintenance')).toBeInTheDocument();
    expect(screen.queryByText('Total Artists')).not.toBeInTheDocument();
  });

  // --- Refresh loading state ---------------------------------------------

  it('shows loading state on refresh button during mutation', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });
    // Post never resolves so the mutation stays pending
    vi.mocked(api.post).mockReturnValue(new Promise(() => {}));

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/Refresh All Issues/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Refresh All Issues/));

    await waitFor(() => {
      expect(screen.getByText('Refreshing...')).toBeInTheDocument();
    });

    // Both refresh buttons should be disabled while mutation is pending
    const buttons = screen.getAllByRole('button').filter((b) => b.closest('.space-y-1'));
    for (const btn of buttons) {
      expect(btn).toBeDisabled();
    }
  });

  // --- Error state -------------------------------------------------------

  it('shows error message when stats fetch fails', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: null,
      error: 'Network error',
      status: 0,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Network error');
    });
  });

  it('shows error message when refresh mutation fails', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: mockStats,
      error: null,
      status: 200,
    });
    vi.mocked(api.post).mockResolvedValue({
      data: null,
      error: 'Lidarr unavailable',
      status: 503,
    });

    render(<LidarrMaintenance connectionId={1} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(screen.getByText(/Refresh All Issues/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Refresh All Issues/));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Lidarr unavailable',
      );
    });
  });
});
