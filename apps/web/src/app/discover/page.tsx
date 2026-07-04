'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui';
import { Modal, ModalFooter } from '@/components/ui/modal';
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
import { useHasLidarr, useLibrary, useProfiles, queryKeys } from '@/lib/hooks';

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
  const [selectedQuality, setSelectedQuality] = useState<number | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<number | null>(null);
  const [selectedRootFolder, setSelectedRootFolder] = useState<string | null>(null);
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [isCancellingBulk, setIsCancellingBulk] = useState(false);
  const bulkCancelRef = useRef(false);
  const [bulkAddProgress, setBulkAddProgress] = useState({ current: 0, total: 0, failed: 0 });

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
  const { data: profiles } = useProfiles();

  // Recommendations live in the React Query cache so they survive
  // navigation; fetched on demand via refetch (enabled: false).
  const {
    data: recsData,
    isFetching: isLoadingRecs,
    refetch: refetchRecs,
  } = useQuery<RecommendationsResponse>({
    queryKey: queryKeys.recommendations,
    queryFn: async () => {
      const { data, error } = await api.post<RecommendationsResponse>('/api/discover/similar', {
        artistNames: Array.from(selectedArtists),
        limit: 100,
      });
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

  // Initialize profile selections when profiles load - use connection
  // defaults if available, falling back to the first option. Functional
  // updates keep this effect dependent on `profiles` alone.
  useEffect(() => {
    if (!profiles) return;
    if (profiles.qualityProfiles.length > 0) {
      const defaultId = profiles.defaults?.qualityProfileId;
      const validDefault = defaultId && profiles.qualityProfiles.some(p => p.id === defaultId);
      setSelectedQuality(prev => prev ?? (validDefault ? defaultId : profiles.qualityProfiles[0].id));
    }
    if (profiles.metadataProfiles.length > 0) {
      const defaultId = profiles.defaults?.metadataProfileId;
      const validDefault = defaultId && profiles.metadataProfiles.some(p => p.id === defaultId);
      setSelectedMetadata(prev => prev ?? (validDefault ? defaultId : profiles.metadataProfiles[0].id));
    }
    if (profiles.rootFolders.length > 0) {
      const defaultPath = profiles.defaults?.rootFolderPath;
      const validDefault = defaultPath && profiles.rootFolders.some(f => f.path === defaultPath);
      setSelectedRootFolder(prev => prev ?? (validDefault ? defaultPath : profiles.rootFolders[0].path));
    }
  }, [profiles]);

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

  const addToLidarr = async (rec: Recommendation) => {
    if (!selectedQuality || !selectedMetadata || !selectedRootFolder) {
      addToast({ type: 'warning', title: 'Please select profiles first' });
      return;
    }

    setAddingArtist(rec.name);

    const { error } = await api.post('/api/discover/add', {
      artistName: rec.name,
      mbid: rec.mbid,
      qualityProfileId: selectedQuality,
      metadataProfileId: selectedMetadata,
      rootFolderPath: selectedRootFolder,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to add artist', message: error });
    } else {
      addToast({ type: 'success', title: `Added ${rec.name} to Lidarr` });
      // Mark as in library and remove from selection
      updateRecommendations(recs =>
        recs.map(r => r.name === rec.name ? { ...r, inLibrary: true } : r)
      );
      setSelectedRecs(prev => {
        const newSet = new Set(prev);
        newSet.delete(rec.name);
        return newSet;
      });
    }
    setAddingArtist(null);
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

  const cancelBulkAdd = () => {
    bulkCancelRef.current = true;
    setIsCancellingBulk(true);
  };

  const bulkAddToLidarr = async () => {
    if (!selectedQuality || !selectedMetadata || !selectedRootFolder) {
      addToast({ type: 'warning', title: 'Please select profiles first' });
      return;
    }

    const toAdd = recommendations.filter(r => selectedRecs.has(r.name) && !r.inLibrary);
    if (toAdd.length === 0) {
      addToast({ type: 'warning', title: 'No artists to add' });
      return;
    }

    bulkCancelRef.current = false;
    setIsCancellingBulk(false);
    setIsBulkAdding(true);
    setBulkAddProgress({ current: 0, total: toAdd.length, failed: 0 });

    let successCount = 0;
    let failCount = 0;
    let cancelled = false;

    for (let i = 0; i < toAdd.length; i++) {
      if (bulkCancelRef.current) {
        cancelled = true;
        break;
      }

      const rec = toAdd[i];
      setBulkAddProgress({ current: i + 1, total: toAdd.length, failed: failCount });

      const { error } = await api.post('/api/discover/add', {
        artistName: rec.name,
        mbid: rec.mbid,
        qualityProfileId: selectedQuality,
        metadataProfileId: selectedMetadata,
        rootFolderPath: selectedRootFolder,
      });

      if (error) {
        failCount++;
        setBulkAddProgress({ current: i + 1, total: toAdd.length, failed: failCount });
      } else {
        successCount++;
        // Mark as in library and drop from selection so a re-run skips it
        updateRecommendations(recs =>
          recs.map(r => r.name === rec.name ? { ...r, inLibrary: true } : r)
        );
        setSelectedRecs(prev => {
          const newSet = new Set(prev);
          newSet.delete(rec.name);
          return newSet;
        });
      }

      // Small delay between adds to avoid overwhelming Lidarr
      if (i < toAdd.length - 1 && !bulkCancelRef.current) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsBulkAdding(false);
    setIsCancellingBulk(false);
    setShowBulkAddModal(false);
    if (!cancelled) {
      setSelectedRecs(new Set());
    }

    if (cancelled) {
      addToast({
        type: 'info',
        title: 'Bulk add stopped',
        message: `Added ${successCount} of ${toAdd.length}${failCount > 0 ? `, ${failCount} failed` : ''}`,
      });
    } else if (successCount > 0) {
      addToast({
        type: 'success',
        title: `Added ${successCount} artist${successCount > 1 ? 's' : ''} to Lidarr`,
        message: failCount > 0 ? `${failCount} failed` : undefined
      });
    } else {
      addToast({ type: 'error', title: 'Failed to add artists' });
    }
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
                      onClick={() => setShowBulkAddModal(true)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Add {selectedRecsAvailable.length} Selected
                    </Button>
                  )}
                </div>
              )}

              {/* Profile Selection */}
              {profiles && (
                <div className="grid grid-cols-1 gap-3 p-3 bg-muted/50 rounded-container">
                  <div className="text-sm font-medium">Add Settings</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <Select
                      value={String(selectedQuality || '')}
                      onChange={(e) => setSelectedQuality(Number(e.target.value))}
                      options={profiles.qualityProfiles.map(p => ({ value: String(p.id), label: p.name }))}
                    />
                    <Select
                      value={String(selectedMetadata || '')}
                      onChange={(e) => setSelectedMetadata(Number(e.target.value))}
                      options={profiles.metadataProfiles.map(p => ({ value: String(p.id), label: p.name }))}
                    />
                    <Select
                      value={String(selectedRootFolder || '')}
                      onChange={(e) => setSelectedRootFolder(e.target.value)}
                      options={profiles.rootFolders.map(p => ({ value: p.path, label: p.path }))}
                    />
                  </div>
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

      {/* Bulk Add Modal — uses the same profile selections as single add */}
      <Modal
        isOpen={showBulkAddModal}
        onClose={() => !isBulkAdding && setShowBulkAddModal(false)}
        title={`Add ${selectedRecs.size} Artist${selectedRecs.size > 1 ? 's' : ''} to Lidarr`}
      >
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="bulk-quality-profile">Quality Profile</label>
            <Select
              id="bulk-quality-profile"
              value={String(selectedQuality || '')}
              onChange={(e) => setSelectedQuality(Number(e.target.value))}
              disabled={isBulkAdding}
              options={profiles?.qualityProfiles.map(p => ({ value: String(p.id), label: p.name })) ?? []}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="bulk-metadata-profile">Metadata Profile</label>
            <Select
              id="bulk-metadata-profile"
              value={String(selectedMetadata || '')}
              onChange={(e) => setSelectedMetadata(Number(e.target.value))}
              disabled={isBulkAdding}
              options={profiles?.metadataProfiles.map(p => ({ value: String(p.id), label: p.name })) ?? []}
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="bulk-root-folder">Root Folder</label>
            <Select
              id="bulk-root-folder"
              value={selectedRootFolder || ''}
              onChange={(e) => setSelectedRootFolder(e.target.value)}
              disabled={isBulkAdding}
              options={profiles?.rootFolders.map(f => ({ value: f.path, label: f.path })) ?? []}
            />
          </div>

          {isBulkAdding && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Progress</span>
                <span>{bulkAddProgress.current} / {bulkAddProgress.total}</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${(bulkAddProgress.current / bulkAddProgress.total) * 100}%` }}
                />
              </div>
              {bulkAddProgress.failed > 0 && (
                <p className="text-sm text-destructive">
                  {bulkAddProgress.failed} failed
                </p>
              )}
            </div>
          )}
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => (isBulkAdding ? cancelBulkAdd() : setShowBulkAddModal(false))}
            disabled={isCancellingBulk}
          >
            {isBulkAdding ? (isCancellingBulk ? 'Stopping…' : 'Stop') : 'Cancel'}
          </Button>
          <Button
            onClick={bulkAddToLidarr}
            disabled={isBulkAdding}
          >
            {isBulkAdding ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Add All
              </>
            )}
          </Button>
        </ModalFooter>
      </Modal>

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
