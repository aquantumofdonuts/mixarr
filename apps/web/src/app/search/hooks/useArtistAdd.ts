'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useAddArtistOptions, type ArtistAddOptions } from '@/components/artists/AddArtistOptions';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { artistResultKey, type ArtistResult } from './useSearch';

export type { ArtistResult };
export interface BatchAddResult { added: string[]; skipped: string[]; failed: { id: string; error: string }[] }

export function useArtistAdd(setResults: (updater: (prev: any[]) => any[]) => void, scope = '') {
  const { user } = useAuth();
  scope = `${user?.id ?? 'anonymous'}:${scope}`;
  const { addToast } = useToast();
  const optionsAction = useAddArtistOptions(scope);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const scopeRef = useRef({ value: scope, revision: 0 });
  if (scopeRef.current.value !== scope) scopeRef.current = { value: scope, revision: scopeRef.current.revision + 1 };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { pending.current.clear(); setPendingIds(new Set()); setIsBulkAdding(false); }, [scope]);
  const current = useCallback((owner: { value: string; revision: number }) => mounted.current && scopeRef.current === owner, []);
  const markPending = useCallback((key: string, value: boolean) => {
    if (value) pending.current.add(key); else pending.current.delete(key);
    setPendingIds(new Set(pending.current));
  }, []);
  const updateArtist = useCallback((key: string, patch: Partial<ArtistResult>) => {
    setResults(previous => previous.map(row => artistResultKey(row) === key ? { ...row, resultKey: key, ...patch } : row));
  }, [setResults]);
  const reportError = useCallback((key: string, error: string) => {
    updateArtist(key, { acquisitionError: error });
    addToast({ type: 'error', title: 'Failed to add artist', message: error });
  }, [addToast, updateArtist]);

  const add = useCallback(async (artist: ArtistResult, options: ArtistAddOptions) => {
    const mbid = options.mbid;
    const key = artistResultKey(artist), owner = scopeRef.current;
    if (pending.current.has(key)) return;
    markPending(key, true); updateArtist(key, { acquisitionError: undefined });
    try {
      const discovery = !artist.foreignArtistId;
      const { data, error } = await api.post<{ success?: boolean; artist?: { foreignArtistId?: string } }>(
        discovery ? '/api/search/discover/add' : '/api/search/artists/add',
        discovery ? { artistName: artist.artistName, ...options } : { ...options, foreignArtistId: artist.foreignArtistId },
      );
      if (!current(owner)) return;
      if (error) throw new Error(error);
      if (data?.success === true) {
        updateArtist(key, { inLibrary: true, foreignArtistId: mbid || data.artist?.foreignArtistId || artist.foreignArtistId, acquisitionError: undefined });
        addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
      } else { const message = 'Addition was not confirmed. Check Lidarr before retrying.'; throw new Error(message); }
      return true;
    } catch (cause) {
      if (current(owner)) reportError(key, cause instanceof Error ? cause.message : 'Addition failed');
      throw cause;
    } finally { if (current(owner)) markPending(key, false); }
  }, [markPending, updateArtist, current, reportError, addToast]);
  const handleAddArtist = useCallback(async (artist: ArtistResult) => optionsAction.runWithOptions({ name: artist.artistName, mbid: artist.foreignArtistId }, options => add(artist, options)), [add, optionsAction.runWithOptions]);
  const executeBatch = useCallback(async (ids: Set<string>, options: ArtistAddOptions) => {
    if (!ids.size || isBulkAdding || [...ids].some(id => pending.current.has(id))) return null;
    const owner = scopeRef.current;
    setIsBulkAdding(true);
    ids.forEach(id => { pending.current.add(id); updateArtist(id, { acquisitionError: undefined }); });
    setPendingIds(new Set(pending.current));
    try {
      const { data, error } = await api.post<BatchAddResult>('/api/search/batch', { artistIds: [...ids], ...options });
      if (!current(owner)) return null;
      if (error || !data || !Array.isArray(data.added) || !Array.isArray(data.skipped) || !Array.isArray(data.failed)) {
        const message = error || 'Bulk addition was not confirmed. Check Lidarr before retrying.';
        ids.forEach(id => updateArtist(id, { acquisitionError: message }));
        throw new Error(message);
      }
      const succeeded = new Set([...data.added, ...data.skipped].filter(id => ids.has(id)));
      setResults(previous => previous.map(row => succeeded.has(row.foreignArtistId) ? { ...row, inLibrary: true, acquisitionError: undefined } : row));
      succeeded.forEach(id => ids.delete(id));
      data.failed.filter(item => ids.has(item.id)).forEach(item => updateArtist(item.id, { acquisitionError: item.error }));
      addToast({ type: data.failed.length ? 'warning' : 'success', title: data.failed.length ? 'Bulk add partial' : 'Bulk add complete', message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}` });
      if (data.failed.length) throw Object.assign(new Error(`${data.failed.length} artist additions failed. Confirm again to retry the failed selection.`), { partial: true });
      return data;
    } catch (cause) {
      if (current(owner)) { const message = cause instanceof Error ? cause.message : 'Bulk addition failed'; if (!(cause && typeof cause === 'object' && 'partial' in cause)) ids.forEach(id => updateArtist(id, { acquisitionError: message })); if (!(cause && typeof cause === 'object' && 'partial' in cause)) addToast({ type: 'error', title: 'Bulk add failed', message }); }
      throw cause;
    } finally { if (current(owner)) { pending.current.clear(); setPendingIds(new Set(pending.current)); setIsBulkAdding(false); } }
  }, [isBulkAdding, current, updateArtist, setResults, addToast]);
  const handleBatchAdd = useCallback(async (ids: Set<string>) => {
    if (!ids.size) return null;
    const remaining = new Set(ids);
    return optionsAction.runWithOptions({ name: `Add ${ids.size} selected artists`, bulk: true }, options => executeBatch(remaining, options)) as Promise<BatchAddResult | null>;
  }, [optionsAction.runWithOptions, executeBatch]);
  return { optionsDialog: optionsAction.dialog, addingArtistId: [...pendingIds][0] || null, pendingIds, isBulkAdding, handleAddArtist, handleBatchAdd };
}
