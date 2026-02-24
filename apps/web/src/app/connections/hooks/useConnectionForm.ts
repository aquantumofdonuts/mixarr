'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';

interface SaveConnectionParams {
  type: string;
  name: string;
  config: Record<string, unknown>;
  isGlobal?: boolean;
  editingId?: number | null;
}

/**
 * Hook for connection CRUD operations: create, update, test, and delete.
 *
 * Manages API calls, cache invalidation, toast notifications, and loading/error state.
 */
export function useConnectionForm() {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [testingId, setTestingId] = useState<number | null>(null);

  const saveMutation = useMutation({
    mutationFn: async ({ type, name, config, isGlobal, editingId }: SaveConnectionParams) => {
      const payload: Record<string, unknown> = { type, name, config };
      if (isGlobal !== undefined) {
        payload.isGlobal = isGlobal;
      }

      const { error } = editingId
        ? await api.put(`/api/connections/${editingId}`, payload)
        : await api.post('/api/connections', payload);

      if (error) throw new Error(error);
    },
    onSuccess: (_data, variables) => {
      addToast({
        type: 'success',
        title: variables.editingId ? 'Connection updated' : 'Connection added',
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    },
    onError: (error: Error) => {
      addToast({
        type: 'error',
        title: 'Failed to save connection',
        message: error.message,
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (id: number) => {
      const { data, error } = await api.post<{ success: boolean; message?: string }>(
        `/api/connections/${id}/test`
      );
      if (error || !data?.success) {
        throw new Error(error || data?.message || 'Connection test failed');
      }
      return data;
    },
    onSuccess: () => {
      addToast({ type: 'success', title: 'Connection test successful' });
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    },
    onError: (error: Error) => {
      addToast({
        type: 'error',
        title: 'Connection test failed',
        message: error.message,
      });
    },
    onSettled: (_data, _error, id) => {
      setTestingId((prev) => (prev === id ? null : prev));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await api.delete(`/api/connections/${id}`);
      if (error) throw new Error(error);
    },
    onSuccess: () => {
      addToast({ type: 'success', title: 'Connection deleted' });
      queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      queryClient.invalidateQueries({ queryKey: queryKeys.dashboardConnections });
    },
    onError: (error: Error) => {
      addToast({ type: 'error', title: 'Failed to delete connection', message: error.message });
    },
  });

  /**
   * Create or update a connection.
   * Returns `true` on success, `false` on error.
   */
  const saveConnection = async (
    type: string,
    name: string,
    config: Record<string, unknown>,
    isGlobal?: boolean,
    editingId?: number | null,
  ): Promise<boolean> => {
    try {
      await saveMutation.mutateAsync({ type, name, config, isGlobal, editingId });
      return true;
    } catch {
      return false;
    }
  };

  /** Test an existing connection by ID. */
  const testConnection = (id: number) => {
    setTestingId(id);
    testMutation.mutate(id);
  };

  /** Delete a connection by ID. */
  const deleteConnection = (id: number) => {
    deleteMutation.mutate(id);
  };

  return {
    saveConnection,
    testConnection,
    deleteConnection,
    testingId,
    isSaving: saveMutation.isPending,
    error: saveMutation.error || testMutation.error || deleteMutation.error || null,
  };
}
