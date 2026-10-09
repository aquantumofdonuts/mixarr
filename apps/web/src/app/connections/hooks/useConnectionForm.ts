'use client';

import { useState, useRef, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/hooks';
import { useToast } from '@/components/ui/toast';

export interface ConnectionTestState {
  verdict: 'testing' | 'pass' | 'fail';
  message?: string;
}
interface SaveConnectionParams {
  type: string;
  name: string;
  config: Record<string, unknown>;
  isGlobal?: boolean;
  editingId?: number | null;
}

export function useConnectionForm(onTestResult?: (id: number, result: ConnectionTestState) => void) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const [testStates, setTestStates] = useState<Record<number, ConnectionTestState>>({});
  const [error, setError] = useState<Error | null>(null);
  const lifetime = useRef({ active: true, controller: new AbortController() });
  const generations = useRef<Record<number, number>>({});
  const actor = () => {
    const user = queryClient.getQueryData<{ user?: { id: number; role: string } }>(queryKeys.auth)?.user;
    return `${user?.id}:${user?.role}`;
  };
  useEffect(() => {
    const current = { active: true, controller: new AbortController() };
    lifetime.current = current;
    return () => { current.active = false; current.controller.abort(); };
  }, []);
  const capture = () => {
    const current = lifetime.current, owner = actor();
    return { signal: current.controller.signal, valid: () => current.active && owner === actor() };
  };
  const clearTest = (id: number) => {
    generations.current[id] = (generations.current[id] ?? 0) + 1;
    setTestStates(previous => { const next = { ...previous }; delete next[id]; return next; });
  };

  const saveMutation = useMutation({
    retry: false,
    mutationFn: async ({ params, signal }: { params: SaveConnectionParams; signal: AbortSignal }) => {
      const { type, name, config, isGlobal, editingId } = params;
      const payload: Record<string, unknown> = { type, name, config };
      if (isGlobal !== undefined) payload.isGlobal = isGlobal;
      const result = editingId
        ? await api.put(`/api/connections/${editingId}`, payload, { signal })
        : await api.post('/api/connections', payload, { signal });
      if (result.error) throw new Error(result.error);
    },
  });
  const testMutation = useMutation({
    retry: false,
    mutationFn: async ({ id, signal }: { id: number; signal: AbortSignal }) => {
      const { data, error } = await api.post<{ success: boolean; message?: string }>(`/api/connections/${id}/test`, undefined, { signal });
      if (error || data?.success !== true) throw new Error(error || data?.message || 'Connection test failed');
    },
  });
  const deleteMutation = useMutation({
    retry: false,
    mutationFn: async ({ id, signal }: { id: number; signal: AbortSignal }) => {
      const { error } = await api.delete(`/api/connections/${id}`, { signal });
      if (error) throw new Error(error);
    },
  });

  const saveConnection = async (type: string, name: string, config: Record<string, unknown>, isGlobal?: boolean, editingId?: number | null): Promise<boolean> => {
    const action = capture();
    if (editingId) clearTest(editingId);
    setError(null);
    try {
      await saveMutation.mutateAsync({ params: { type, name, config, isGlobal, editingId }, signal: action.signal });
      if (!action.valid()) return false;
      addToast({ type: 'success', title: editingId ? 'Connection updated' : 'Connection added' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      return true;
    } catch (cause) {
      if (action.valid()) {
        const failure = cause instanceof Error ? cause : new Error('Failed to save connection');
        setError(failure);
        addToast({ type: 'error', title: 'Failed to save connection', message: failure.message });
      }
      return false;
    }
  };
  const testConnection = async (id: number): Promise<boolean> => {
    const action = capture();
    const generation = generations.current[id] = (generations.current[id] ?? 0) + 1;
    const valid = () => action.valid() && generations.current[id] === generation;
    setError(null);
    setTestStates(previous => ({ ...previous, [id]: { verdict: 'testing' } }));
    onTestResult?.(id, { verdict: 'testing' });
    try {
      await testMutation.mutateAsync({ id, signal: action.signal });
      if (!valid()) return false;
      const result: ConnectionTestState = { verdict: 'pass' };
      setTestStates(previous => ({ ...previous, [id]: result }));
      onTestResult?.(id, result);
      addToast({ type: 'success', title: 'Connection test successful' });
      return true;
    } catch (cause) {
      if (valid()) {
        const failure = cause instanceof Error ? cause : new Error('Connection test failed');
        setError(failure);
        const result: ConnectionTestState = { verdict: 'fail', message: failure.message };
        setTestStates(previous => ({ ...previous, [id]: result }));
        onTestResult?.(id, result);
        addToast({ type: 'error', title: 'Connection test failed', message: failure.message });
      }
      return false;
    } finally {
      // ponytail: lastTest records attempts even when the provider returns failure.
      if (valid()) void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    }
  };
  const deleteConnection = async (id: number): Promise<boolean> => {
    const action = capture();
    setError(null);
    try {
      await deleteMutation.mutateAsync({ id, signal: action.signal });
      if (!action.valid()) return false;
      clearTest(id);
      addToast({ type: 'success', title: 'Connection deleted' });
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboardConnections });
      return true;
    } catch (cause) {
      if (action.valid()) {
        const failure = cause instanceof Error ? cause : new Error('Failed to delete connection');
        setError(failure);
        addToast({ type: 'error', title: 'Failed to delete connection', message: failure.message });
      }
      return false;
    }
  };
  const recordTest = (id: number, result: ConnectionTestState) => {
    generations.current[id] = (generations.current[id] ?? 0) + 1;
    setTestStates(previous => ({ ...previous, [id]: result }));
  };
  return {
    recordTest, saveConnection, testConnection, deleteConnection, clearTest, testStates,
    testingId: Number(Object.keys(testStates).find(id => testStates[Number(id)].verdict === 'testing')) || null,
    isSaving: saveMutation.isPending, isDeleting: deleteMutation.isPending, error,
  };
}
