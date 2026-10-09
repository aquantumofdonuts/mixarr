'use client';

import { useCallback, useEffect } from 'react';
import { ArtistCard } from '@/components/ArtistCard';
import { BulkToolbar } from '@/components/ui/bulk-toolbar';
import { Button } from '@/components/ui/button';
import { removeActedItems, retainSelection } from '@/lib/list-state';
import { useListContext } from '@/hooks/useListContext';
import { artistResultKey, type ArtistResult } from '../hooks/useSearch';
import type { BatchAddResult } from '../hooks/useArtistAdd';

export interface ArtistSearchProps {
  results: ArtistResult[];
  addingArtistId: string | null;
  pendingIds?: Set<string>;
  isBulkAdding: boolean;
  disabled?: boolean;
  onAddArtist: (artist: ArtistResult) => void;
  onBatchAdd: (ids: Set<string>) => Promise<BatchAddResult | null>;
  onSearchSlskd: (artist: { name: string; image?: string }) => void;
}

export function ArtistSearch({ results, addingArtistId, pendingIds, isBulkAdding, disabled = false, onAddArtist, onBatchAdd, onSearchSlskd }: ArtistSearchProps) {
  const { selected: selectedIds, setSelected, remember } = useListContext({ ready: !disabled });
  useEffect(() => {
    if (disabled) return;
    const available = new Set(results.filter(row => !row.inLibrary && row.foreignArtistId).map(artistResultKey));
    setSelected(previous => retainSelection(previous, available));
  }, [results, disabled, setSelected]);
  const toggle = useCallback((id: string) => setSelected(previous => {
    const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;
  }), [setSelected]);
  async function bulkAdd() {
    const ids = new Set(results.filter(row => selectedIds.has(artistResultKey(row))).map(row => row.foreignArtistId));
    const outcome = await onBatchAdd(ids);
    if (outcome) setSelected(previous => removeActedItems(previous, new Set([...outcome.added, ...outcome.skipped])));
  }
  return <>
    <div className="flex flex-wrap items-center gap-3 border-y py-2 text-sm">
      <Button variant="outline" size="sm" disabled={disabled || isBulkAdding} onClick={() => setSelected(new Set(results.filter(row => !row.inLibrary && row.foreignArtistId).map(artistResultKey)))}>Select this page</Button>
      <span className="text-muted-foreground">Artist additions · this page only · unidentified artists require individual identity selection</span>
    </div>
    <div className="divide-y border-b">
      {results.map(artist => <ArtistCard key={artistResultKey(artist)} artistName={artist.artistName} foreignArtistId={artist.foreignArtistId} imageUrl={artist.imageUrl}
        sources={artist.sources} inLibrary={artist.inLibrary} genres={artist.lastfm?.tags} popularity={artist.popularity} followers={artist.followers} fans={artist.fans} listeners={artist.lastfm?.listeners}
        spotifyId={artist.spotifyId} mbid={artist.foreignArtistId} showCheckbox isSelected={selectedIds.has(artistResultKey(artist))} onSelect={() => toggle(artistResultKey(artist))}
        onAdd={() => onAddArtist(artist)} onSearchSlskd={() => onSearchSlskd({ name: artist.artistName, image: artist.imageUrl })}
        onOpen={remember} disabled={disabled || isBulkAdding} acquisitionError={artist.acquisitionError}
        isAdding={pendingIds ? pendingIds.has(artistResultKey(artist)) : addingArtistId === artistResultKey(artist)} />)}
    </div>
    <BulkToolbar selectedCount={selectedIds.size} scopeLabel="This page · adds selected artists to Lidarr" pending={isBulkAdding || !!pendingIds?.size}
      actions={[{ label: 'Add selected artists', onClick: () => { void bulkAdd(); }, disabled }]} onClear={() => setSelected(new Set())} />
  </>;
}
