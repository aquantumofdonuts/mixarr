'use client';

import { useAddArtistOptions, type ArtistAddOptions } from '@/components/artists/AddArtistOptions';
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { LabelArtistPage } from '@mixarr/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ArtistLink } from '@/components/artists/ArtistLink';
import { ExternalLinks } from '@/components/ExternalLinks';
import { api } from '@/lib/api';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music from 'lucide-react/dist/esm/icons/music';

type LabelArtist = LabelArtistPage['artists'][number];
export interface LabelArtistsModalProps {
  label: { name: string; id: string } | null;
  onClose: () => void;
}
const PAGE_SIZE = 50;

export function LabelArtistsModal({ label, onClose }: LabelArtistsModalProps) {
  const labelId = label?.id;
  const [artists, setArtists] = useState<LabelArtist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingBatch, setIsAddingBatch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [releasesChecked, setReleasesChecked] = useState(0);
  const [totalReleases, setTotalReleases] = useState<number | null>(null);
  const [nextReleaseOffset, setNextReleaseOffset] = useState<number | null>(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const owner = useMemo(() => ({ labelId }), [labelId]);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const optionsAction = useAddArtistOptions(label?.id || '');
  const { addToast } = useToast();

  const loadPage = useCallback(async (offset: number) => {
    if (!labelId || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsLoading(true);
    setPageError(null);
    try {
      const { data, error } = await api.get<LabelArtistPage>(
        `/api/search/label/${labelId}/artists?limit=${PAGE_SIZE}&offset=${offset}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || ownerRef.current !== owner) return;
      if (error || !data) {
        setPageError(error || 'Label artists unavailable. Retry this page.');
        return;
      }
      setArtists(previous => [...new Map([...previous, ...data.artists].map(artist => [artist.id, artist])).values()]);
      // releasesProcessed is the raw release count for this page, including repeats.
      setReleasesChecked(previous => previous + data.releasesProcessed);
      setTotalReleases(data.totalReleases);
      setNextReleaseOffset(data.nextReleaseOffset);
    } catch (error) {
      if (!controller.signal.aborted && ownerRef.current === owner) {
        setPageError(error instanceof Error ? error.message : 'Label artists unavailable. Retry this page.');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (!controller.signal.aborted && ownerRef.current === owner) setIsLoading(false);
    }
  }, [labelId, owner]); // The label name does not change the release cursor.

  useEffect(() => {
    setArtists([]);
    setSelectedIds(new Set());
    setSearchQuery('');
    setSortOrder('asc');
    setReleasesChecked(0);
    setTotalReleases(null);
    setNextReleaseOffset(0);
    setPageError(null);
    setIsAddingBatch(false);
    if (labelId) void loadPage(0);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [labelId, loadPage]);

  const displayedArtists = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return artists.filter(artist => artist.name.toLowerCase().includes(query)).sort((a, b) => {
      const comparison = a.name.localeCompare(b.name);
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [artists, searchQuery, sortOrder]);

  const toggleSelect = (id: string) => setSelectedIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleBatchAdd = async (options?: ArtistAddOptions, remaining = new Set(selectedIds), isCurrent = () => true) => {
    if (!options) {
      await optionsAction.runWithOptions({ name: `Add ${selectedIds.size} selected artists`, bulk: true }, (choices, current) => handleBatchAdd(choices, remaining, current));
      return;
    }
    if (!remaining.size) return;
    setIsAddingBatch(true);
    const counts = { added: 0, skipped: 0, failed: 0 };
    try {
      // the API accepts at most 100 identities per request. Keep one
      // options choice and submit bounded chunks of the loaded selection.
      const ids = [...remaining];
      for (let start = 0; start < ids.length; start += 100) {
        const { data, error } = await api.post<{
          added: string[];
          skipped: string[];
          failed: { id: string; error: string }[];
        }>('/api/search/batch', { artistIds: ids.slice(start, start + 100), ...options });
        if (!isCurrent()) return;
        if (error || !data) throw new Error(error || 'No acquisition result received');
        counts.added += data.added.length;
        counts.skipped += data.skipped.length;
        counts.failed += data.failed.length;
        const confirmed = new Set([...data.added, ...data.skipped]);
        confirmed.forEach(id => remaining.delete(id));
        setSelectedIds(previous => new Set([...previous].filter(id => !confirmed.has(id))));
      }
      if (remaining.size) throw new Error(`${remaining.size} artist additions not confirmed`);
      addToast({ type: 'success', title: 'Artists added', message: `Added: ${counts.added}, Skipped: ${counts.skipped}, Failed: ${counts.failed}` });
      onClose();
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : 'Artist additions unavailable';
      addToast({ type: 'error', title: 'Some artist additions were not confirmed', message });
      throw error;
    } finally {
      if (isCurrent()) setIsAddingBatch(false);
    }
  };

  if (!label) return null;
  return <>
    <Modal isOpen onClose={onClose} title={label.name} size="full"
      description={`${releasesChecked} releases checked; ${artists.length} artists loaded`}>
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">{totalReleases === null ? 'Release total unavailable until the first page loads.' : `${totalReleases} releases reported by MusicBrainz.`} Search applies to loaded artists. Load more to check another release page.</p>
        <details open className="group border-b pb-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="disclosure-chevron h-4 w-4" />Search
          </summary>
          <Input label="Search loaded artists" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Artist name" />
        </details>
        <details open className="group border-b pb-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="disclosure-chevron h-4 w-4" />Sort
          </summary>
          <Select label="Sort loaded artists" value={sortOrder} onChange={event => setSortOrder(event.target.value as 'asc' | 'desc')}
            options={[{ value: 'asc', label: 'A → Z' }, { value: 'desc', label: 'Z → A' }]} />
        </details>
        <p className="text-xs text-muted-foreground">{displayedArtists.length} of {artists.length} loaded artists match.</p>
        {isLoading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading label releases…</p>}
        {pageError && <p role="alert" className="text-sm">{pageError} Loaded artists and selections are preserved.</p>}
        {!isLoading && !displayedArtists.length && <p className="py-4 text-sm text-muted-foreground">{searchQuery.trim() ? 'No loaded artists match your search.' : 'No artists loaded yet.'}</p>}
        <div className="divide-y border-y">
          {displayedArtists.map(artist => <div key={artist.id} className="flex items-center gap-3 py-2">
            <input type="checkbox" aria-label={`Select ${artist.name}`} checked={selectedIds.has(artist.id)} disabled={isAddingBatch} onChange={() => toggleSelect(artist.id)} className="h-5 w-5 shrink-0" />
            <ArtistLink mbid={artist.id} aria-label={`Open artist ${artist.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-button bg-muted">
              {artist.imageUrl ? <img src={artist.imageUrl} alt="" className="h-full w-full object-cover" /> : <Music aria-hidden="true" className="h-5 w-5 text-muted-foreground" />}
            </ArtistLink>
            <div className="min-w-0 flex-1"><ArtistLink mbid={artist.id} className="block break-words text-sm font-medium">{artist.name}</ArtistLink><ExternalLinks mbid={artist.id} artistName={artist.name} size="sm" /></div>
          </div>)}
        </div>
        {!isLoading && nextReleaseOffset === null && <p className="text-xs text-muted-foreground">All reported releases checked.</p>}
      </div>
      <ModalFooter className="justify-start">
        <span className="w-full text-xs text-muted-foreground">{selectedIds.size} selected · Loaded artists · Adds artists to Lidarr</span>
        <Button variant="outline" size="sm" disabled={!displayedArtists.length || isAddingBatch} onClick={() => setSelectedIds(previous => new Set([...previous, ...displayedArtists.map(artist => artist.id)]))}>
          {searchQuery.trim() ? 'Select all matching artists' : 'Select all loaded artists'}
        </Button>
        <Button variant="outline" size="sm" disabled={!selectedIds.size || isAddingBatch} onClick={() => setSelectedIds(new Set())}>Clear selection</Button>
        {nextReleaseOffset !== null && <Button variant="outline" size="sm" disabled={isLoading} onClick={() => void loadPage(nextReleaseOffset)}>{pageError ? 'Retry' : 'Load more'}</Button>}
        <Button size="sm" disabled={!selectedIds.size || isAddingBatch} onClick={() => void handleBatchAdd()}>Add {selectedIds.size} selected artists</Button>
      </ModalFooter>
    </Modal>
    {optionsAction.dialog}
  </>;
}
