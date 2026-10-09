'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { artistResultKey, type ArtistResult, type MbidCandidate } from './useSearch';

export type { ArtistResult, MbidCandidate };
export interface BatchAddResult { added: string[]; skipped: string[]; failed: { id: string; error: string }[] }
export function isAlreadyExistsError(error: string): boolean {
  return error.includes('ArtistExistsValidator') || error.includes('already been added');
}

export function useArtistAdd(setResults: (updater: (prev: any[]) => any[]) => void, scope = '') {
  const { addToast } = useToast();
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const [mbidCandidates, setMbidCandidates] = useState<MbidCandidate[] | null>(null);
  const [selectingArtist, setSelectingArtist] = useState<ArtistResult | null>(null);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const scopeRef = useRef({ value: scope, revision: 0 });
  if (scopeRef.current.value !== scope) scopeRef.current = { value: scope, revision: scopeRef.current.revision + 1 };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { pending.current.clear(); setPendingIds(new Set()); setIsBulkAdding(false); setMbidCandidates(null); setSelectingArtist(null); }, [scope]);
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

  const add = useCallback(async (artist: ArtistResult, mbid?: string) => {
    const key = artistResultKey(artist), owner = scopeRef.current;
    if (pending.current.has(key)) return;
    markPending(key, true); updateArtist(key, { acquisitionError: undefined });
    try {
      const discovery = !artist.foreignArtistId;
      const { data, error } = await api.post<{ success?: boolean; artist?: { foreignArtistId?: string }; candidates?: MbidCandidate[] }>(
        discovery ? '/api/search/discover/add' : '/api/search/artists/add',
        discovery ? { artistName: artist.artistName, ...(mbid ? { mbid } : {}) } : { foreignArtistId: artist.foreignArtistId },
      );
      if (!current(owner)) return;
      if (error) reportError(key, error);
      else if (data?.candidates?.length && !mbid) { setMbidCandidates(data.candidates); setSelectingArtist(artist); }
      else if (data?.success === true) {
        updateArtist(key, { inLibrary: true, foreignArtistId: mbid || data.artist?.foreignArtistId || artist.foreignArtistId, acquisitionError: undefined });
        addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
      } else reportError(key, 'Addition was not confirmed. Check Lidarr before retrying.');
    } catch (cause) {
      if (current(owner)) reportError(key, cause instanceof Error ? cause.message : 'Addition failed');
    } finally { if (current(owner)) markPending(key, false); }
  }, [markPending, updateArtist, current, reportError, addToast]);
  const handleAddArtist = useCallback(async (artist: ArtistResult) => { await add(artist); }, [add]);
  const handleAddWithMbid = useCallback(async (mbid: string) => {
    if (!selectingArtist) return;
    const artist = selectingArtist; setMbidCandidates(null); setSelectingArtist(null);
    await add(artist, mbid);
  }, [selectingArtist, add]);

  const handleBatchAdd = useCallback(async (ids: Set<string>) => {
    if (!ids.size || isBulkAdding || [...ids].some(id => pending.current.has(id))) return null;
    const owner = scopeRef.current;
    setIsBulkAdding(true);
    ids.forEach(id => { pending.current.add(id); updateArtist(id, { acquisitionError: undefined }); });
    setPendingIds(new Set(pending.current));
    try {
      const { data, error } = await api.post<BatchAddResult>('/api/search/batch', { artistIds: [...ids] });
      if (!current(owner)) return null;
      if (error || !data || !Array.isArray(data.added) || !Array.isArray(data.skipped) || !Array.isArray(data.failed)) {
        const message = error || 'Bulk addition was not confirmed. Check Lidarr before retrying.';
        ids.forEach(id => updateArtist(id, { acquisitionError: message }));
        addToast({ type: 'error', title: 'Bulk add failed', message }); return null;
      }
      const succeeded = new Set([...data.added, ...data.skipped].filter(id => ids.has(id)));
      setResults(previous => previous.map(row => succeeded.has(row.foreignArtistId) ? { ...row, inLibrary: true, acquisitionError: undefined } : row));
      data.failed.filter(item => ids.has(item.id)).forEach(item => updateArtist(item.id, { acquisitionError: item.error }));
      addToast({ type: 'success', title: 'Bulk add complete', message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}` });
      return data;
    } catch (cause) {
      if (current(owner)) { const message = cause instanceof Error ? cause.message : 'Bulk addition failed'; ids.forEach(id => updateArtist(id, { acquisitionError: message })); addToast({ type: 'error', title: 'Bulk add failed', message }); }
      return null;
    } finally { if (current(owner)) { ids.forEach(id => pending.current.delete(id)); setPendingIds(new Set(pending.current)); setIsBulkAdding(false); } }
  }, [isBulkAdding, current, updateArtist, setResults, addToast]);
  const clearMbidModal = useCallback(() => { setMbidCandidates(null); setSelectingArtist(null); }, []);
  return { addingArtistId: [...pendingIds][0] || null, pendingIds, mbidCandidates, selectingArtist, isBulkAdding, handleAddArtist, handleAddWithMbid, handleBatchAdd, clearMbidModal };
}
