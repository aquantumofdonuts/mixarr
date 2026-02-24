import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Hoist mock so it's available inside vi.mock factory
const { mockAddToast } = vi.hoisted(() => ({
  mockAddToast: vi.fn(),
}));

// Mock api module
vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock toast module
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ addToast: mockAddToast, toasts: [], removeToast: vi.fn() }),
}));

import { api } from '@/lib/api';
import { queryKeys } from '@/lib/hooks';
import { useConnectionForm } from '../hooks/useConnectionForm';

const createTestSetup = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  Wrapper.displayName = 'TestQueryWrapper';
  return { queryClient, invalidateSpy, Wrapper };
};

describe('useConnectionForm', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('saveConnection', () => {
    it('calls POST /api/connections when no editingId', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { id: 1 },
        error: null,
        status: 201,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.saveConnection('lidarr', 'My Lidarr', { url: 'http://localhost:8686' });
      });

      expect(success).toBe(true);
      expect(api.post).toHaveBeenCalledWith('/api/connections', {
        type: 'lidarr',
        name: 'My Lidarr',
        config: { url: 'http://localhost:8686' },
      });
      expect(api.put).not.toHaveBeenCalled();
    });

    it('calls PUT /api/connections/{id} when editingId provided', async () => {
      vi.mocked(api.put).mockResolvedValueOnce({
        data: { id: 5 },
        error: null,
        status: 200,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.saveConnection('spotify', 'My Spotify', { clientId: 'abc' }, undefined, 5);
      });

      expect(success).toBe(true);
      expect(api.put).toHaveBeenCalledWith('/api/connections/5', {
        type: 'spotify',
        name: 'My Spotify',
        config: { clientId: 'abc' },
      });
      expect(api.post).not.toHaveBeenCalled();
    });

    it('includes isGlobal in payload when provided', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { id: 1 },
        error: null,
        status: 201,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.saveConnection('lidarr', 'Global Lidarr', { url: 'http://lidarr' }, true);
      });

      expect(api.post).toHaveBeenCalledWith('/api/connections', {
        type: 'lidarr',
        name: 'Global Lidarr',
        config: { url: 'http://lidarr' },
        isGlobal: true,
      });
    });

    it('invalidates connections cache on success', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { id: 1 },
        error: null,
        status: 201,
      });

      const { invalidateSpy, Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.saveConnection('lidarr', 'Test', { url: 'http://localhost' });
      });

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.connections });
    });

    it('shows success toast with "Connection added" for new connection', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { id: 1 },
        error: null,
        status: 201,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.saveConnection('lidarr', 'Test', {});
      });

      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Connection added',
      });
    });

    it('shows success toast with "Connection updated" when editing', async () => {
      vi.mocked(api.put).mockResolvedValueOnce({
        data: { id: 5 },
        error: null,
        status: 200,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.saveConnection('spotify', 'Updated', {}, undefined, 5);
      });

      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'success',
        title: 'Connection updated',
      });
    });

    it('shows error toast and returns false on API failure', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Validation failed',
        status: 422,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      let success: boolean | undefined;
      await act(async () => {
        success = await result.current.saveConnection('lidarr', 'Bad', {});
      });

      expect(success).toBe(false);
      expect(mockAddToast).toHaveBeenCalledWith({
        type: 'error',
        title: 'Failed to save connection',
        message: 'Validation failed',
      });
    });

    it('exposes error state on save failure', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Server error',
        status: 500,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      await act(async () => {
        await result.current.saveConnection('lidarr', 'Bad', {});
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.message).toBe('Server error');
      });
    });

    it('sets isSaving while save is in progress', async () => {
      let resolvePost!: (value: { data: unknown; error: string | null; status: number }) => void;
      vi.mocked(api.post).mockReturnValueOnce(
        new Promise(resolve => { resolvePost = resolve; })
      );

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      expect(result.current.isSaving).toBe(false);

      let savePromise: Promise<boolean>;
      act(() => {
        savePromise = result.current.saveConnection('lidarr', 'Test', {});
      });

      await waitFor(() => {
        expect(result.current.isSaving).toBe(true);
      });

      await act(async () => {
        resolvePost({ data: { id: 1 }, error: null, status: 201 });
        await savePromise!;
      });

      await waitFor(() => {
        expect(result.current.isSaving).toBe(false);
      });
    });
  });

  describe('testConnection', () => {
    it('calls POST /api/connections/{id}/test', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true },
        error: null,
        status: 200,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(42);
      });

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/api/connections/42/test');
      });
    });

    it('sets testingId during test and clears on completion', async () => {
      let resolveTest!: (value: { data: unknown; error: string | null; status: number }) => void;
      vi.mocked(api.post).mockReturnValueOnce(
        new Promise(resolve => { resolveTest = resolve; })
      );

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      expect(result.current.testingId).toBeNull();

      act(() => {
        result.current.testConnection(7);
      });

      expect(result.current.testingId).toBe(7);

      await act(async () => {
        resolveTest({ data: { success: true }, error: null, status: 200 });
      });

      await waitFor(() => {
        expect(result.current.testingId).toBeNull();
      });
    });

    it('shows success toast on successful test', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true },
        error: null,
        status: 200,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(1);
      });

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'success',
          title: 'Connection test successful',
        });
      });
    });

    it('invalidates connections cache on successful test', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: true },
        error: null,
        status: 200,
      });

      const { invalidateSpy, Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(1);
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.connections });
      });
    });

    it('shows error toast on test failure (API error)', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Connection refused',
        status: 500,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(1);
      });

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          title: 'Connection test failed',
          message: 'Connection refused',
        });
      });
    });

    it('shows error toast on test failure (success=false)', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: { success: false, message: 'Invalid API key' },
        error: null,
        status: 200,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(1);
      });

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          title: 'Connection test failed',
          message: 'Invalid API key',
        });
      });
    });

    it('clears testingId after test failure', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Timeout',
        status: 500,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(3);
      });

      expect(result.current.testingId).toBe(3);

      await waitFor(() => {
        expect(result.current.testingId).toBeNull();
      });
    });

    it('exposes error state on test failure', async () => {
      vi.mocked(api.post).mockResolvedValueOnce({
        data: null,
        error: 'Connection refused',
        status: 500,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.testConnection(1);
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
        expect(result.current.error?.message).toBe('Connection refused');
      });
    });
  });

  describe('deleteConnection', () => {
    it('calls DELETE /api/connections/{id}', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({
        data: null,
        error: null,
        status: 204,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.deleteConnection(10);
      });

      await waitFor(() => {
        expect(api.delete).toHaveBeenCalledWith('/api/connections/10');
      });
    });

    it('invalidates connections and dashboard caches on success', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({
        data: null,
        error: null,
        status: 204,
      });

      const { invalidateSpy, Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.deleteConnection(10);
      });

      await waitFor(() => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.connections });
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.dashboardConnections });
      });
    });

    it('shows success toast on delete', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({
        data: null,
        error: null,
        status: 204,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.deleteConnection(10);
      });

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'success',
          title: 'Connection deleted',
        });
      });
    });

    it('shows error toast on delete failure', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({
        data: null,
        error: 'Not found',
        status: 404,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.deleteConnection(999);
      });

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith({
          type: 'error',
          title: 'Failed to delete connection',
          message: 'Not found',
        });
      });
    });

    it('exposes error state on delete failure', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({
        data: null,
        error: 'Forbidden',
        status: 403,
      });

      const { Wrapper } = createTestSetup();
      const { result } = renderHook(() => useConnectionForm(), { wrapper: Wrapper });

      act(() => {
        result.current.deleteConnection(5);
      });

      await waitFor(() => {
        expect(result.current.error).toBeTruthy();
      });
    });
  });
});
