'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ExternalLinks } from '@/components/ExternalLinks';
import { api } from '@/lib/api';
import CheckSquare from 'lucide-react/dist/esm/icons/check-square';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Music from 'lucide-react/dist/esm/icons/music';
import Plus from 'lucide-react/dist/esm/icons/plus';
import SearchIcon from 'lucide-react/dist/esm/icons/search';
import Square from 'lucide-react/dist/esm/icons/square';
import X from 'lucide-react/dist/esm/icons/x';

interface LabelArtist {
  id: string;
  name: string;
  sortName?: string;
  imageUrl?: string | null;
}

export interface LabelArtistsModalProps {
  label: { name: string; id: string } | null; // null = closed
  onClose: () => void;
}

const PAGE_SIZE = 50;

export function LabelArtistsModal({ label, onClose }: LabelArtistsModalProps) {
  // Artist data
  const [artists, setArtists] = useState<LabelArtist[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingBatch, setIsAddingBatch] = useState(false);

  // Filter / sort
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Infinite scroll
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalArtists, setTotalArtists] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { addToast } = useToast();

  // ─── Fetch initial page on open ──────────────────────────────────
  useEffect(() => {
    if (!label) return;

    let cancelled = false;

    const fetchInitial = async () => {
      setIsLoading(true);
      setArtists([]);
      setSelectedIds(new Set());
      setSearchQuery('');
      setSortOrder('asc');
      setHasMore(true);

      const { data, error } = await api.get<{ artists: LabelArtist[]; count: number }>(
        `/api/search/label/${label.id}/artists?limit=${PAGE_SIZE}&offset=0`,
      );

      if (cancelled) return;

      if (error) {
        addToast({ type: 'error', title: 'Failed to load artists', message: error });
        onClose();
      } else if (data?.artists) {
        setArtists(data.artists);
        setTotalArtists(data.count);
        setHasMore(data.artists.length >= PAGE_SIZE);
        if (data.artists.length === 0) {
          addToast({ type: 'info', title: 'No artists found for this label' });
        }
      }
      setIsLoading(false);
    };

    fetchInitial();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [label?.id]);

  // ─── Infinite scroll — load more ────────────────────────────────
  const loadMore = useCallback(async () => {
    if (!label || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const offset = artists.length;

    const { data, error } = await api.get<{ artists: LabelArtist[]; count: number }>(
      `/api/search/label/${label.id}/artists?limit=${PAGE_SIZE}&offset=${offset}`,
    );

    if (!error && data?.artists) {
      setArtists((prev) => [...prev, ...data.artists]);
      setHasMore(data.artists.length >= PAGE_SIZE);
    }
    setIsLoadingMore(false);
  }, [label, isLoadingMore, hasMore, artists.length]);

  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.target as HTMLDivElement;
      const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;

      // Load more when within 100px of bottom (only if no active filter)
      if (scrollBottom < 100 && hasMore && !isLoadingMore && !searchQuery) {
        loadMore();
      }
    },
    [hasMore, isLoadingMore, searchQuery, loadMore],
  );

  // ─── Filter + sort (client-side) ────────────────────────────────
  const displayedArtists = useMemo(() => {
    let filtered = artists;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((a) => a.name.toLowerCase().includes(q));
    }

    return [...filtered].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return sortOrder === 'asc' ? cmp : -cmp;
    });
  }, [artists, searchQuery, sortOrder]);

  // ─── Selection helpers ───────────────────────────────────────────
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedIds(new Set(displayedArtists.map((a) => a.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  // ─── Batch add ───────────────────────────────────────────────────
  const handleBatchAdd = async () => {
    if (selectedIds.size === 0) return;

    setIsAddingBatch(true);
    const { data, error } = await api.post<{
      added: string[];
      skipped: string[];
      failed: { id: string; error: string }[];
    }>('/api/search/batch', { artistIds: Array.from(selectedIds) });

    if (error) {
      addToast({ type: 'error', title: 'Failed to add artists', message: error });
    } else if (data) {
      addToast({
        type: 'success',
        title: 'Artists added',
        message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}`,
      });
      setSelectedIds(new Set());
      onClose();
    }
    setIsAddingBatch(false);
  };

  // ─── Don't render when closed ────────────────────────────────────
  if (!label) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold">{label.name}</h2>
            <p className="text-sm text-muted-foreground">
              {isLoading
                ? 'Loading...'
                : `${totalArtists > 0 ? totalArtists : artists.length} artists found`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <Button size="sm" onClick={handleBatchAdd} disabled={isAddingBatch}>
                {isAddingBatch ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                Add {selectedIds.size} Selected
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Search and Sort Controls */}
        {!isLoading && artists.length > 0 && (
          <div className="p-4 border-b bg-muted/30 space-y-3">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                placeholder="Filter artists by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 text-base"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {displayedArtists.length} of {artists.length} artists
              </span>
              <Select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
                options={[
                  { value: 'asc', label: 'A → Z' },
                  { value: 'desc', label: 'Z → A' },
                ]}
                className="w-28"
              />
            </div>
          </div>
        )}

        {/* Artist list with infinite scroll */}
        <div
          className="flex-1 overflow-auto p-4"
          onScroll={handleScroll}
          ref={scrollRef}
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : artists.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No artists found</p>
          ) : displayedArtists.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No artists match your search
            </p>
          ) : (
            <div className="space-y-2">
              {/* Select / Deselect All */}
              <div className="flex gap-2 mb-4">
                <Button variant="outline" size="sm" onClick={selectAllVisible}>
                  Select All{searchQuery ? ' Visible' : ''}
                </Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>
                  Deselect All
                </Button>
              </div>

              {displayedArtists.map((artist) => (
                <div
                  key={artist.id}
                  className="flex items-center gap-3 p-3 rounded hover:bg-muted cursor-pointer"
                  onClick={() => toggleSelect(artist.id)}
                >
                  {selectedIds.has(artist.id) ? (
                    <CheckSquare className="h-5 w-5 text-primary flex-shrink-0" />
                  ) : (
                    <Square className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {artist.imageUrl ? (
                      <img
                        src={artist.imageUrl}
                        alt={artist.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Music className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium block">{artist.name}</span>
                    <ExternalLinks mbid={artist.id} artistName={artist.name} size="sm" />
                  </div>
                </div>
              ))}

              {/* Loading more indicator */}
              {isLoadingMore && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                  <span className="text-sm text-muted-foreground">Loading more...</span>
                </div>
              )}

              {/* End of list indicator */}
              {!hasMore && artists.length > PAGE_SIZE && !searchQuery && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  All artists loaded
                </p>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
