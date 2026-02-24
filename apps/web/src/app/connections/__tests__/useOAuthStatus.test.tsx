import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import { useOAuthStatus } from '../hooks/useOAuthStatus';
import type { OAuthType } from '../hooks/useOAuthStatus';

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return Wrapper;
};

describe('useOAuthStatus', () => {
  const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

  beforeEach(() => {
    vi.resetAllMocks();
    // Mock window.location so assigning href doesn't trigger navigation
    Object.defineProperty(window, 'location', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: { href: '' },
    });
  });

  afterEach(() => {
    // Restore original window.location
    if (originalLocation) {
      Object.defineProperty(window, 'location', originalLocation);
    }
  });

  describe('status fetching', () => {
    it('fetches status when connectionId is provided', async () => {
      const mockStatus = { authorized: true, expired: false, needsReauthorization: false };
      vi.mocked(api.get).mockResolvedValueOnce({
        data: mockStatus,
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('spotify', 42),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status).toEqual(mockStatus));
      expect(api.get).toHaveBeenCalledWith('/api/connections/42/spotify/status');
    });

    it('does not fetch when connectionId is null', async () => {
      const { result } = renderHook(
        () => useOAuthStatus('spotify', null),
        { wrapper: createWrapper() }
      );

      // Give React Query a tick to potentially fire
      await new Promise(r => setTimeout(r, 50));

      expect(api.get).not.toHaveBeenCalled();
      expect(result.current.status).toBeNull();
    });

    it('returns null status before data is loaded', () => {
      vi.mocked(api.get).mockReturnValueOnce(new Promise(() => {})); // never resolves

      const { result } = renderHook(
        () => useOAuthStatus('deezer', 1),
        { wrapper: createWrapper() }
      );

      expect(result.current.status).toBeNull();
    });
  });

  describe('authorize', () => {
    it('calls correct endpoint and redirects', async () => {
      // Mock initial status fetch
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: false, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('spotify', 42),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status).not.toBeNull());

      // Mock authorize endpoint
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authUrl: 'https://accounts.spotify.com/authorize?client_id=abc' },
        error: null,
        status: 200,
      });

      act(() => {
        result.current.authorize();
      });

      await waitFor(() => {
        expect(window.location.href).toBe('https://accounts.spotify.com/authorize?client_id=abc');
      });

      expect(api.get).toHaveBeenCalledWith('/api/connections/42/spotify/auth');
    });

    it('sets isLoading during authorize', async () => {
      // Mock status fetch
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: false, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('tidal', 7),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status).not.toBeNull());

      // Mock authorize with a deferred promise to observe loading state
      let resolveAuth!: (value: any) => void;
      vi.mocked(api.get).mockReturnValueOnce(
        new Promise(resolve => { resolveAuth = resolve; })
      );

      await act(async () => {
        result.current.authorize();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      await act(async () => {
        resolveAuth({
          data: { authUrl: 'https://tidal.com/authorize' },
          error: null,
          status: 200,
        });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('revoke', () => {
    it('calls correct endpoint and refetches status', async () => {
      // Mock initial status fetch — authorized
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: true, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('deezer', 5),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status?.authorized).toBe(true));

      // Mock revoke endpoint
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true },
        error: null,
        status: 200,
      });

      // Mock the status refetch after revoke — now unauthorized
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: false, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      act(() => {
        result.current.revoke();
      });

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api/connections/5/deezer/revoke');
      });

      await waitFor(() => {
        expect(result.current.status?.authorized).toBe(false);
      });
    });

    it('sets isLoading during revoke', async () => {
      // Mock status fetch
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: true, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('spotify', 3),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status).not.toBeNull());

      // Mock revoke with deferred promise
      let resolveRevoke!: (value: any) => void;
      vi.mocked(api.post).mockReturnValueOnce(
        new Promise(resolve => { resolveRevoke = resolve; })
      );

      await act(async () => {
        result.current.revoke();
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      await act(async () => {
        resolveRevoke({ data: { success: true }, error: null, status: 200 });
      });

      // Mock the status refetch triggered by invalidation
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: false, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('error handling', () => {
    it('exposes error when status API fails', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: null,
        error: 'Connection refused',
        status: 500,
      });

      const { result } = renderHook(
        () => useOAuthStatus('spotify', 42),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.message).toBe('Connection refused');
      });
      expect(result.current.status).toBeNull();
    });

    it('exposes error when authorize fails', async () => {
      // Mock successful status fetch
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: false, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('spotify', 42),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status).not.toBeNull());

      // Mock authorize endpoint returning error
      vi.mocked(api.get).mockResolvedValueOnce({
        data: null,
        error: 'Invalid client credentials',
        status: 401,
      });

      act(() => {
        result.current.authorize();
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.message).toBe('Invalid client credentials');
      });
    });

    it('exposes error when revoke fails', async () => {
      // Mock successful status fetch
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: true, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      const { result } = renderHook(
        () => useOAuthStatus('deezer', 5),
        { wrapper: createWrapper() }
      );

      await waitFor(() => expect(result.current.status?.authorized).toBe(true));

      // Mock revoke endpoint returning error
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Token revocation failed',
        status: 500,
      });

      act(() => {
        result.current.revoke();
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.message).toBe('Token revocation failed');
      });
    });
  });

  describe('type parameter constructs correct endpoint paths', () => {
    it.each<[OAuthType, number]>([
      ['spotify', 10],
      ['deezer', 20],
      ['tidal', 30],
    ])('constructs correct %s status endpoint', async (type, id) => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: { authorized: true, expired: false, needsReauthorization: false },
        error: null,
        status: 200,
      });

      renderHook(
        () => useOAuthStatus(type, id),
        { wrapper: createWrapper() }
      );

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith(`/api/connections/${id}/${type}/status`);
      });
    });
  });
});
