'use client';

import { useState, useCallback, useEffect } from 'react';
import { ArtistCard } from '@/components/ArtistCard';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { BulkActionBar } from './BulkActionBar';
import type { ArtistResult } from '../hooks/useSearch';

export interface AISearchProps {
  results: ArtistResult[];
  aiPrompt: string;
  aiProviders: string[];
  /** ID of the artist currently being added (foreignArtistId or artistName) */
  addingArtistId: string | null;
  isBulkAdding: boolean;
  onAddArtist: (artist: ArtistResult) => void;
  onBatchAdd: (ids: Set<string>) => Promise<any>;
  onSearchSlskd: (artist: { name: string; image?: string }) => void;
}

/**
 * Renders the AI search results: a prompt banner followed by an ArtistCard grid
 * with multi-select and bulk add support.
 * Manages its own local `selectedIds` state.
 */
export function AISearch({
  results,
  aiPrompt,
  aiProviders,
  addingArtistId,
  isBulkAdding,
  onAddArtist,
  onBatchAdd,
  onSearchSlskd,
}: AISearchProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when results change (e.g. new search)
  useEffect(() => {
    setSelectedIds(new Set());
  }, [results]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allIds = results
      .filter((r) => !r.inLibrary)
      .map((r) => r.foreignArtistId);
    setSelectedIds(new Set(allIds));
  }, [results]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleBulkAdd = useCallback(async () => {
    const result = await onBatchAdd(selectedIds);
    if (result) {
      setSelectedIds(new Set());
    }
  }, [selectedIds, onBatchAdd]);

  return (
    <>
      {/* AI Recommendations Banner */}
      <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-purple-400" />
          <span className="text-purple-400 font-medium">AI Recommendations for:</span>
          <span className="text-zinc-300">&quot;{aiPrompt}&quot;</span>
        </div>
        {aiProviders.length > 0 && (
          <p className="text-zinc-500 text-sm mt-1">
            Powered by {aiProviders.join(' & ')}
          </p>
        )}
      </div>

      <BulkActionBar
        selectedCount={selectedIds.size}
        totalCount={results.length}
        onSelectAll={selectAll}
        onDeselectAll={deselectAll}
        onBulkAdd={handleBulkAdd}
        isAdding={isBulkAdding}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((artist, i) => (
          <ArtistCard
            key={`${artist.foreignArtistId || artist.artistName}-${i}`}
            artistName={artist.artistName}
            foreignArtistId={artist.foreignArtistId}
            imageUrl={artist.imageUrl}
            sources={artist.sources}
            inLibrary={artist.inLibrary}
            genres={artist.lastfm?.tags}
            popularity={artist.popularity}
            followers={artist.followers}
            fans={artist.fans}
            listeners={artist.lastfm?.listeners}
            spotifyId={artist.spotifyId}
            mbid={artist.foreignArtistId}
            showCheckbox={true}
            isSelected={selectedIds.has(artist.foreignArtistId)}
            onSelect={() => toggleSelect(artist.foreignArtistId)}
            onAdd={() => onAddArtist(artist)}
            onSearchSlskd={() =>
              onSearchSlskd({ name: artist.artistName, image: artist.imageUrl })
            }
            isAdding={
              addingArtistId === artist.foreignArtistId ||
              addingArtistId === artist.artistName
            }
          />
        ))}
      </div>
    </>
  );
}
