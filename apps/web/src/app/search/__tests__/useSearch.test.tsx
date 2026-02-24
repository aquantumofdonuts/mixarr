import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// Hoist mock so it's available inside vi.mock factory
const { mockAddToast } = vi.hoisted(() => ({
  mockAddToast: vi.fn(),
}));

// Mock api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

// Mock toast module
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast, toasts: [], removeToast: vi.fn() }),
}));

import { api } from '@/lib/api';
import { useSearch } from '../hooks/useSearch';

/** Helper: default mock that handles the AI-status call made on mount. */
function mockAiStatusAvailable() {
  vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
    if (endpoint === '/api/search/ai/status') {
      return { data: { available: true }, error: null, status: 200 };
    }
    return { data: null, error: null, status: 200 };
  });
}

describe('useSearch', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAiStatusAvailable();
  });

  // ─── Initialisation ───────────────────────────────────────────────

  it('checks AI availability on mount', async () => {
    renderHook(() => useSearch());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/api/search/ai/status');
    });
  });

  it('sets aiAvailable to true when the endpoint reports available', async () => {
    const { result } = renderHook(() => useSearch());

    await waitFor(() => {
      expect(result.current.aiAvailable).toBe(true);
    });
  });

  it('sets aiAvailable to false when the endpoint reports unavailable', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: false }, error: null, status: 200 };
      }
      return { data: null, error: null, status: 200 };
    });

    const { result } = renderHook(() => useSearch());

    await waitFor(() => {
      expect(result.current.aiAvailable).toBe(false);
    });
  });

  // ─── performSearch: empty query guard ─────────────────────────────

  it('does nothing when query is empty', async () => {
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    await act(async () => {
      await result.current.performSearch();
    });

    // Only the AI status call should have been made
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  // ─── Artist search ────────────────────────────────────────────────

  it('performs artist search with correct endpoint and source params', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: {
          results: [
            { mbid: 'abc-123', name: 'Radiohead', imageUrl: '/img.jpg', sources: ['spotify'], inLibrary: false },
          ],
        },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setQuery('radiohead');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    // Should call the discover endpoint with all default sources
    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/discover'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('q=radiohead');
    expect(searchCall![0]).toContain('sources=');

    // Results should be mapped to ArtistResult shape
    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].artistName).toBe('Radiohead');
    expect(result.current.results[0].foreignArtistId).toBe('abc-123');
    expect(result.current.isSearching).toBe(false);
  });

  it('respects source toggles when searching artists', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return { data: { results: [] }, error: null, status: 200 };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    // Disable all except spotify
    act(() => {
      result.current.toggleSource('deezer');
      result.current.toggleSource('tidal');
      result.current.toggleSource('bandcamp');
    });

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/discover'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('sources=spotify');
    // Should NOT contain other sources
    expect(searchCall![0]).not.toContain('deezer');
  });

  // ─── Album search ─────────────────────────────────────────────────

  it('performs album search with correct endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: { releases: [{ id: 'alb-1', title: 'OK Computer' }], count: 1 },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('album');
      result.current.setQuery('ok computer');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/album'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('q=ok%20computer');
    expect(searchCall![0]).toContain('limit=25');
    expect(searchCall![0]).toContain('offset=0');

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].title).toBe('OK Computer');
    expect(result.current.totalCount).toBe(1);
  });

  // ─── Label search ─────────────────────────────────────────────────

  it('performs label search with correct endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: { labels: [{ id: 'lbl-1', name: 'Warp Records', country: 'GB' }], count: 1 },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('label');
      result.current.setQuery('warp');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/label'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('q=warp');

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].name).toBe('Warp Records');
    expect(result.current.totalCount).toBe(1);
  });

  // ─── Year search ──────────────────────────────────────────────────

  it('performs year search with correct endpoint', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: {
          releaseGroups: [{ id: 'rg-1', title: 'Album 2024', 'primary-type': 'Album' }],
          count: 1,
        },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('year');
      result.current.setQuery('2024');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/year'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('year=2024');

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].title).toBe('Album 2024');
    expect(result.current.totalCount).toBe(1);
  });

  // ─── AI search ────────────────────────────────────────────────────

  it('performs AI search via POST to /api/search/ai', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        prompt: 'ambient electronic',
        results: [{ foreignArtistId: 'ai-1', artistName: 'Boards of Canada' }],
        aiProviders: ['openai'],
      },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('ai');
      result.current.setQuery('ambient electronic');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(api.post).toHaveBeenCalledWith('/api/search/ai', {
      prompt: 'ambient electronic',
    });

    expect(result.current.results).toHaveLength(1);
    expect(result.current.results[0].artistName).toBe('Boards of Canada');
    expect(result.current.aiPrompt).toBe('ambient electronic');
    expect(result.current.aiProviders).toEqual(['openai']);
  });

  it('shows info toast when AI search returns no results', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        prompt: 'noresults',
        results: [],
        aiProviders: ['openai'],
        message: 'No recommendations found',
      },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('ai');
      result.current.setQuery('noresults');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: 'No results found' }),
    );
  });

  it('shows error toast when AI search returns errors', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: {
        prompt: 'broken',
        results: [],
        aiProviders: [],
        errors: ['provider failed'],
        message: 'Provider error',
      },
      error: null,
      status: 200,
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('ai');
      result.current.setQuery('broken');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'AI Search Error' }),
    );
  });

  // ─── Error handling ───────────────────────────────────────────────

  it('shows error toast when search API returns an error', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return { data: null, error: 'Network error', status: 0 };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setQuery('test');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'Search failed', message: 'Network error' }),
    );
    expect(result.current.isSearching).toBe(false);
  });

  it('shows error toast when AI search endpoint errors', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      data: null,
      error: 'AI service unavailable',
      status: 503,
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('ai');
      result.current.setQuery('test');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error', title: 'AI Search failed' }),
    );
  });

  // ─── No results toast ─────────────────────────────────────────────

  it('shows info toast when standard search returns zero results', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return { data: { results: [] }, error: null, status: 200 };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setQuery('nonexistent');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: 'No results found' }),
    );
  });

  // ─── Loading state ────────────────────────────────────────────────

  it('sets isSearching to true during search and false after', async () => {
    let resolveSearch!: (value: any) => void;
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return new Promise((resolve) => {
        resolveSearch = resolve;
      });
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setQuery('test');
    });

    let searchPromise: Promise<void>;
    act(() => {
      searchPromise = result.current.performSearch();
    });

    // isSearching should be true while the request is in-flight
    expect(result.current.isSearching).toBe(true);

    // Resolve the API call
    await act(async () => {
      resolveSearch({ data: { results: [] }, error: null, status: 200 });
      await searchPromise!;
    });

    expect(result.current.isSearching).toBe(false);
  });

  // ─── setSearchType clears results ─────────────────────────────────

  it('clears results when search type changes', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: { results: [{ mbid: 'x', name: 'X' }] },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setQuery('x');
    });
    await act(async () => {
      await result.current.performSearch();
    });

    expect(result.current.results.length).toBeGreaterThan(0);

    act(() => {
      result.current.setSearchType('album');
    });

    expect(result.current.results).toHaveLength(0);
    expect(result.current.searchType).toBe('album');
  });

  // ─── Source toggle edge case ──────────────────────────────────────

  it('prevents disabling all sources', async () => {
    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    // Disable three of four
    act(() => {
      result.current.toggleSource('deezer');
      result.current.toggleSource('tidal');
      result.current.toggleSource('bandcamp');
    });

    expect(result.current.enabledSources.size).toBe(1);
    expect(result.current.enabledSources.has('spotify')).toBe(true);

    // Try to disable the last one — should be a no-op
    act(() => {
      result.current.toggleSource('spotify');
    });

    expect(result.current.enabledSources.size).toBe(1);
    expect(result.current.enabledSources.has('spotify')).toBe(true);
  });

  // ─── Pagination ───────────────────────────────────────────────────

  it('calculates totalPages correctly', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return {
        data: { releases: Array.from({ length: 25 }, (_, i) => ({ id: `a-${i}`, title: `A${i}` })), count: 75 },
        error: null,
        status: 200,
      };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('album');
      result.current.setQuery('test');
    });

    await act(async () => {
      await result.current.performSearch();
    });

    expect(result.current.totalPages).toBe(3); // 75 / 25 = 3
    expect(result.current.page).toBe(1);
  });

  it('passes correct offset for page 2', async () => {
    vi.mocked(api.get).mockImplementation(async (endpoint: string) => {
      if (endpoint === '/api/search/ai/status') {
        return { data: { available: true }, error: null, status: 200 };
      }
      return { data: { releases: [], count: 0 }, error: null, status: 200 };
    });

    const { result } = renderHook(() => useSearch());
    await waitFor(() => expect(result.current.aiAvailable).toBe(true));

    act(() => {
      result.current.setSearchType('album');
      result.current.setQuery('test');
    });

    await act(async () => {
      await result.current.performSearch(2);
    });

    const searchCall = vi.mocked(api.get).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/search/album'),
    );
    expect(searchCall).toBeDefined();
    expect(searchCall![0]).toContain('offset=25');
    expect(result.current.page).toBe(2);
  });
});
