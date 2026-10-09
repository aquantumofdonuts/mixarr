'use client';

import { useAddArtistOptions } from '@/components/artists/AddArtistOptions';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { GenrePills } from '@/components/GenrePills';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import { api } from '@/lib/api';
import Check from 'lucide-react/dist/esm/icons/check';
import CheckSquare from 'lucide-react/dist/esm/icons/check-square';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import Download from 'lucide-react/dist/esm/icons/download';
import Library from 'lucide-react/dist/esm/icons/library';
import Music2 from 'lucide-react/dist/esm/icons/music-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Search from 'lucide-react/dist/esm/icons/search';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Square from 'lucide-react/dist/esm/icons/square';
import X from 'lucide-react/dist/esm/icons/x';
import { LastfmIcon, MusicBrainzIcon } from '@/components/ExternalLinks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useHasLidarr, useLibrary, queryKeys } from '@/lib/hooks';

interface Recommendation {
  name: string;
  mbid?: string;
  url?: string;
  imageUrl?: string;
  matchCount: number;
  matchedFrom: string[];
  inLibrary: boolean;
  genres?: string[];
}

interface RecommendationsResponse {
  recommendations: Recommendation[];
  seedArtists: string[];
  total: number;
}

export default function DiscoverPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: hasLidarr, isLoading: lidarrLoading } = useHasLidarr();
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set());
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);


  const [addingArtist, setAddingArtist] = useState<string | null>(null);

  // slskd Search state
  const [slskdModalOpen, setSlskdModalOpen] = useState(false);
  const [slskdSearchArtist, setSlskdSearchArtist] = useState<{ name: string; image?: string } | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 250;

  const { addToast } = useToast();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch library via the shared hook (keyed under queryKeys.library)
  const { data: libraryData, isLoading: isLoadingLibrary } = useLibrary({
    page,
    limit,
    search: debouncedSearch || undefined,
  });
  const libraryArtists = libraryData?.artists ?? [];
  const totalPages = libraryData?.pagination?.totalPages ?? 1;
  const total = libraryData?.pagination?.total ?? 0;

  // Fetch profiles via the shared hook

  // Recommendations live in the React Query cache so they survive
  // navigation; fetched on demand via refetch (enabled: false).
  const {
    data: recsData,
    isFetching: isLoadingRecs,
    refetch: refetchRecs,
  } = useQuery<RecommendationsResponse>({
    queryKey: queryKeys.recommendations,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.post<RecommendationsResponse>('/api/discover/similar', {
        artistNames: Array.from(selectedArtists),
        limit: 100,
      }, { signal });
      if (error) throw new Error(error);
      return data!;
    },
    enabled: false,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
  const recommendations = recsData?.recommendations ?? [];

  /** Patch cached recommendations (e.g. mark an artist as added). */
  const updateRecommendations = (update: (recs: Recommendation[]) => Recommendation[]) => {
    queryClient.setQueryData<RecommendationsResponse>(queryKeys.recommendations, (old) =>
      old ? { ...old, recommendations: update(old.recommendations) } : old
    );
  };

  const toggleArtist = (name: string) => {
    const newSelected = new Set(selectedArtists);
    if (newSelected.has(name)) {
      newSelected.delete(name);
    } else {
      newSelected.add(name);
    }
    setSelectedArtists(newSelected);
  };

  const selectAll = () => {
    const newSelected = new Set(selectedArtists);
    libraryArtists.forEach(a => newSelected.add(a.name));
    setSelectedArtists(newSelected);
  };

  const clearSelection = () => {
    setSelectedArtists(new Set());
  };

  const removeFromSelection = (name: string) => {
    const newSelected = new Set(selectedArtists);
    newSelected.delete(name);
    setSelectedArtists(newSelected);
  };

  const getRecommendations = async () => {
    if (selectedArtists.size === 0) {
      addToast({ type: 'warning', title: 'Select at least one artist' });
      return;
    }

    const result = await refetchRecs();

    if (result.error) {
      addToast({ type: 'error', title: 'Failed to get recommendations', message: result.error.message });
    } else if (result.data) {
      if (result.data.recommendations.length === 0) {
        addToast({ type: 'info', title: 'No new recommendations found' });
      } else {
        addToast({
          type: 'success',
          title: `Found ${result.data.recommendations.length} recommendations`,
          message: `Based on ${result.data.seedArtists.length} selected artists`
        });
      }
    }
  };

  const optionsAction = useAddArtistOptions();
  const addToLidarr = async (rec: Recommendation) => {
    await optionsAction.runWithOptions({ name: rec.name, mbid: rec.mbid }, async (options, isCurrent) => {
      setAddingArtist(rec.name);
      try {
        const { data, error } = await api.post<{ success?: boolean }>('/api/discover/add', { artistName: rec.name, ...options });
        if (!isCurrent()) return;
        if (error || data?.success !== true) throw new Error(error || 'Addition was not confirmed');
        updateRecommendations(recs => recs.map(row => row === rec || row.mbid && row.mbid === rec.mbid ? { ...row, inLibrary: true } : row));
        setSelectedRecs(previous => { const next = new Set(previous); next.delete(rec.name); return next; });
        addToast({ type: 'success', title: `Added ${rec.name} to Lidarr` });
      } finally { if (isCurrent()) setAddingArtist(null); }
    });
  };

  // Recommendation selection functions
  const toggleRecSelection = (name: string) => {
    setSelectedRecs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(name)) {
        newSet.delete(name);
      } else {
        newSet.add(name);
      }
      return newSet;
    });
  };

  const selectAllRecs = () => {
    const availableRecs = recommendations.filter(r => !r.inLibrary).map(r => r.name);
    setSelectedRecs(new Set(availableRecs));
  };

  const clearRecSelection = () => {
    setSelectedRecs(new Set());
  };

  const bulkAddToLidarr = async () => {
    const remaining = new Set(recommendations.filter(rec => selectedRecs.has(rec.name) && !rec.inLibrary));
    if (!remaining.size) return;
    await optionsAction.runWithOptions({ name: `Add ${remaining.size} selected artists`, bulk: true }, async (options, isCurrent) => {
      setIsBulkAdding(true);
      let added = 0;
      try {
        for (const rec of remaining) {
          if (!isCurrent()) return;
          if (!rec.mbid) continue; // ponytail: unidentified recommendations require individual choice.
          const { data, error } = await api.post<{ success?: boolean }>('/api/discover/add', { artistName: rec.name, mbid: rec.mbid, ...options });
          if (!isCurrent()) return;
          if (error || data?.success !== true) continue;
          remaining.delete(rec); added++;
          updateRecommendations(recs => recs.map(row => row.mbid === rec.mbid ? { ...row, inLibrary: true } : row));
          setSelectedRecs(previous => { const next = new Set(previous); next.delete(rec.name); return next; });
        }
        if (added) addToast({ type: 'success', title: `Added ${added} artists to Lidarr` });
        if (remaining.size) throw new Error(`${remaining.size} additions failed. Identify unknown artists individually or confirm again to retry failures.`);
      } finally { if (isCurrent()) setIsBulkAdding(false); }
    });
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    // React Query will automatically refetch when page changes
  };

  // Get list of selected recs that are still available (not in library)
  const selectedRecsAvailable = recommendations.filter(r => selectedRecs.has(r.name) && !r.inLibrary);

  // Show friendly message when Lidarr is not connected
  if (!lidarrLoading && !hasLidarr) {
    return (
      <>
        <PageHeader title="Discover" description="Explore your library and find new music" />
        <Card className="p-8 text-center max-w-md mx-auto mt-8">
          <Library className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">Library Connection Required</h3>
          <p className="text-muted-foreground mb-4">
            Discover browses your existing music library to find similar artists. 
            Connect Lidarr to enable this feature.
          </p>
          <Button onClick={() => router.push('/connections')}>
            <Plus className="h-4 w-4 mr-2" /> Add Lidarr Connection
          </Button>
        </Card>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        description="Get artist recommendations based on your Lidarr library"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Library Selection Panel */}
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Your Library</h3>
                <Badge variant="secondary">{total} artists</Badge>
              </div>

              {/* Search */}
              <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Search your library..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" variant="secondary" size="icon">
                  <Search className="h-4 w-4" />
                </Button>
              </form>

              {/* Selection Controls */}
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-1" />
                  Select All on Page
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection} disabled={selectedArtists.size === 0}>
                  <Square className="h-4 w-4 mr-1" />
                  Clear All
                </Button>
                {selectedArtists.size > 0 && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => setShowSelectedPanel(!showSelectedPanel)}
                  >
                    {showSelectedPanel ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                    {selectedArtists.size} selected
                  </Button>
                )}
              </div>

              {/* Selected Artists Panel (Collapsible) */}
              {showSelectedPanel && selectedArtists.size > 0 && (
                <div className="border rounded-container p-3 bg-muted/30 max-h-40 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    {Array.from(selectedArtists).sort().map((name) => (
                      <Badge 
                        key={name} 
                        variant="secondary" 
                        className="flex items-center gap-1 pr-1"
                      >
                        <span className="truncate max-w-[150px]">{name}</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromSelection(name);
                          }}
                          className="ml-1 hover:bg-destructive/20 rounded-full p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* Artist List */}
              <div className="relative min-h-[300px] max-h-[600px] overflow-y-auto border rounded-container">
                {isLoadingLibrary && (
                  <div className="divide-y">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <Skeleton className="w-5 h-5 rounded" />
                        <Skeleton className="h-4 flex-1 max-w-[200px]" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="divide-y">
                  {libraryArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50 transition-colors ${
                        selectedArtists.has(artist.name) ? 'bg-primary/10' : ''
                      }`}
                      onClick={() => toggleArtist(artist.name)}
                    >
                      <div className="flex-shrink-0">
                        {selectedArtists.has(artist.name) ? (
                          <CheckSquare className="h-5 w-5 text-primary" />
                        ) : (
                          <Square className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{artist.name}</p>
                      </div>
                      {artist.monitored && (
                        <Badge variant="outline" className="flex-shrink-0">Monitored</Badge>
                      )}
                    </div>
                  ))}
                  {libraryArtists.length === 0 && !isLoadingLibrary && (
                    <div className="p-8 text-center text-muted-foreground">
                      <Music2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>No artists found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Get Recommendations Button */}
              <Button 
                className="w-full" 
                onClick={getRecommendations}
                disabled={selectedArtists.size === 0 || isLoadingRecs}
              >
                {isLoadingRecs ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Finding Similar Artists...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Get Recommendations ({selectedArtists.size} selected)
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Recommendations Panel */}
        <Card>
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Recommendations</h3>
                {recommendations.length > 0 && (
                  <Badge variant="secondary">{recommendations.length} found</Badge>
                )}
              </div>

              {/* Selection Controls for Recommendations */}
              {recommendations.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={selectAllRecs}>
                    <CheckSquare className="h-4 w-4 mr-1" />
                    Select All
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={clearRecSelection} 
                    disabled={selectedRecs.size === 0}
                  >
                    <Square className="h-4 w-4 mr-1" />
                    Clear
                  </Button>
                  {selectedRecsAvailable.length > 0 && (
                    <Button 
                      size="sm" 
                      onClick={() => void bulkAddToLidarr()}
                      disabled={isBulkAdding}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Add {selectedRecsAvailable.length} Selected
                    </Button>
                  )}
                </div>
              )}

              {/* Recommendations List */}
              <div className="relative min-h-[300px] max-h-[500px] overflow-y-auto border rounded-container">
                {isLoadingRecs && (
                  <div className="divide-y">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 px-4 py-3">
                        <Skeleton className="w-10 h-10 rounded-md" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-1/3" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                        <Skeleton className="h-6 w-20 rounded-full" />
                      </div>
                    ))}
                  </div>
                )}
                <div className="divide-y">
                  {recommendations.map((rec) => (
                    <div
                      key={rec.mbid ?? rec.name}
                      className={`flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors ${
                        selectedRecs.has(rec.name) && !rec.inLibrary ? 'bg-primary/10' : ''
                      }`}
                    >
                      {/* Selection Checkbox */}
                      {!rec.inLibrary && (
                        <button
                          className="flex-shrink-0"
                          onClick={() => toggleRecSelection(rec.name)}
                        >
                          {selectedRecs.has(rec.name) ? (
                            <CheckSquare className="h-5 w-5 text-primary" />
                          ) : (
                            <Square className="h-5 w-5 text-muted-foreground" />
                          )}
                        </button>
                      )}
                      {/* Artist Image */}
                      <div className="flex-shrink-0 w-10 h-10 rounded-md overflow-hidden bg-muted">
                        {rec.imageUrl ? (
                          <img
                            src={rec.imageUrl}
                            alt={rec.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music2 className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <p className="font-medium truncate">{rec.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Similar to: {rec.matchedFrom.slice(0, 3).join(', ')}
                          {rec.matchedFrom.length > 3 && ` +${rec.matchedFrom.length - 3} more`}
                        </p>
                        {rec.genres && rec.genres.length > 0 && (
                          <GenrePills genres={rec.genres} maxDisplay={3} size="sm" />
                        )}
                        {/* External links */}
                        <div className="flex gap-1">
                          {rec.url && (
                            <a
                              href={rec.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open on Last.fm"
                              className="p-1 rounded text-red-500 hover:text-red-400 hover:bg-muted transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <LastfmIcon className="h-3.5 w-3.5" />
                            </a>
                          )}
                          {rec.mbid && (
                            <a
                              href={`https://musicbrainz.org/artist/${rec.mbid}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open on MusicBrainz"
                              className="p-1 rounded text-orange-500 hover:text-orange-400 hover:bg-muted transition-colors"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <MusicBrainzIcon className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Badge variant="outline">
                          {rec.matchCount} match{rec.matchCount > 1 ? 'es' : ''}
                        </Badge>
                        {rec.inLibrary ? (
                          <Button size="sm" variant="outline" disabled>
                            <Check className="h-4 w-4 mr-1" />
                            Added
                          </Button>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              onClick={() => addToLidarr(rec)}
                              disabled={addingArtist === rec.name}
                              title="Add to Lidarr"
                            >
                              {addingArtist === rec.name ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add
                                </>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSlskdSearchArtist({ name: rec.name, image: rec.imageUrl });
                                setSlskdModalOpen(true);
                              }}
                              title="Search on Soulseek"
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {recommendations.length === 0 && !isLoadingRecs && (
                    <div className="p-8 text-center text-muted-foreground">
                      <Sparkles className="h-12 w-12 mx-auto mb-2 opacity-50" />
                      <p>Select artists and click &quot;Get Recommendations&quot;</p>
                      <p className="text-sm mt-1">
                        Uses Last.fm to find similar artists
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {optionsAction.dialog}

      {/* slskd Search Modal */}
      {slskdSearchArtist && (
        <SlskdSearchModal
          isOpen={slskdModalOpen}
          onClose={() => {
            setSlskdModalOpen(false);
            setSlskdSearchArtist(null);
          }}
          artistName={slskdSearchArtist.name}
          artistImage={slskdSearchArtist.image}
        />
      )}
    </div>
  );
}
