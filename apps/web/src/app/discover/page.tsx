'use client';

import { useState, useEffect } from 'react';
import { Button, Card, CardContent, Input, Badge, useToast, Loading, Modal, ModalFooter } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { ReleaseTypeFilter, useReleaseTypeFilter } from '@/components/ReleaseTypeFilter';
import { GenrePills } from '@/components/GenrePills';
import { api } from '@/lib/api';
import { 
  Search, Sparkles, Plus, Check, ChevronLeft, ChevronRight, 
  CheckSquare, Square, Music2, RefreshCw, ChevronDown, ChevronUp, X,
  Download, Filter
} from 'lucide-react';
import { LastfmIcon, MusicBrainzIcon } from '@/components/ExternalLinks';
import { useQuery } from '@tanstack/react-query';

interface LibraryArtist {
  id: number;
  name: string;
  foreignArtistId: string;
  monitored: boolean;
}

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

interface Profiles {
  qualityProfiles: Array<{ id: number; name: string }>;
  metadataProfiles: Array<{ id: number; name: string }>;
  rootFolders: Array<{ id: number; path: string }>;
}

export default function DiscoverPage() {
  const [selectedArtists, setSelectedArtists] = useState<Set<string>>(new Set());
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const { types: releaseTypes, setTypes: setReleaseTypes } = useReleaseTypeFilter();
  const [selectedQuality, setSelectedQuality] = useState<number | null>(null);
  const [selectedMetadata, setSelectedMetadata] = useState<number | null>(null);
  const [selectedRootFolder, setSelectedRootFolder] = useState<string | null>(null);
  const [showSelectedPanel, setShowSelectedPanel] = useState(false);
  const [showBulkAddModal, setShowBulkAddModal] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [bulkAddProgress, setBulkAddProgress] = useState({ current: 0, total: 0, failed: 0 });
  const [addProfiles, setAddProfiles] = useState({
    qualityProfileId: 0,
    metadataProfileId: 0,
    rootFolderPath: ''
  });
  
  const [isLoadingRecs, setIsLoadingRecs] = useState(false);
  const [addingArtist, setAddingArtist] = useState<string | null>(null);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 500;
  
  const { addToast } = useToast();

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1); // Reset to first page on search
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fetch library with React Query
  const { data: libraryData, isLoading: isLoadingLibrary } = useQuery({
    queryKey: ['discover', 'library', page, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
      });
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      }
      const { data, error } = await api.get<{
        artists: LibraryArtist[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      }>(`/api/discover/library?${params}`);
      if (error) throw new Error(error);
      return data;
    },
    staleTime: 60 * 1000, // Library data is fairly stable
  });
  const libraryArtists = libraryData?.artists ?? [];
  const totalPages = libraryData?.pagination?.totalPages ?? 1;
  const total = libraryData?.pagination?.total ?? 0;

  // Fetch profiles with React Query
  const { data: profiles } = useQuery({
    queryKey: ['discover', 'profiles'],
    queryFn: async () => {
      const { data, error } = await api.get<Profiles>('/api/discover/profiles');
      if (error) throw new Error(error);
      return data;
    },
    staleTime: 5 * 60 * 1000, // Profiles rarely change
  });

  // Initialize profile selections when profiles load
  useEffect(() => {
    if (profiles) {
      if (profiles.qualityProfiles.length > 0 && selectedQuality === null) {
        setSelectedQuality(profiles.qualityProfiles[0].id);
      }
      if (profiles.metadataProfiles.length > 0 && selectedMetadata === null) {
        setSelectedMetadata(profiles.metadataProfiles[0].id);
      }
      if (profiles.rootFolders.length > 0 && selectedRootFolder === null) {
        setSelectedRootFolder(profiles.rootFolders[0].path);
      }
      if (addProfiles.qualityProfileId === 0) {
        setAddProfiles({
          qualityProfileId: profiles.qualityProfiles[0]?.id || 0,
          metadataProfileId: profiles.metadataProfiles[0]?.id || 0,
          rootFolderPath: profiles.rootFolders[0]?.path || ''
        });
      }
    }
  }, [profiles, selectedQuality, selectedMetadata, selectedRootFolder, addProfiles.qualityProfileId]);

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

    setIsLoadingRecs(true);
    setRecommendations([]);

    const { data, error } = await api.post<{
      recommendations: Recommendation[];
      seedArtists: string[];
      total: number;
    }>('/api/discover/similar', {
      artistNames: Array.from(selectedArtists),
      limit: 50,
    });

    if (error) {
      addToast({ type: 'error', title: 'Failed to get recommendations', message: error });
    } else if (data) {
      setRecommendations(data.recommendations);
      if (data.recommendations.length === 0) {
        addToast({ type: 'info', title: 'No new recommendations found' });
      } else {
        addToast({ 
          type: 'success', 
          title: `Found ${data.recommendations.length} recommendations`,
          message: `Based on ${data.seedArtists.length} selected artists`
        });
      }
    }
    setIsLoadingRecs(false);
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
      setRecommendations(prev => 
        prev.map(r => r.name === rec.name ? { ...r, inLibrary: true } : r)
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

    setIsBulkAdding(true);
    setBulkAddProgress({ current: 0, total: toAdd.length, failed: 0 });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < toAdd.length; i++) {
      const rec = toAdd[i];
      setBulkAddProgress({ current: i + 1, total: toAdd.length, failed: failCount });

      const { error } = await api.post('/api/discover/add', {
        artistName: rec.name,
        mbid: rec.mbid,
        qualityProfileId: addProfiles.qualityProfileId,
        metadataProfileId: addProfiles.metadataProfileId,
        rootFolderPath: addProfiles.rootFolderPath,
      });

      if (error) {
        failCount++;
        setBulkAddProgress({ current: i + 1, total: toAdd.length, failed: failCount });
      } else {
        successCount++;
        // Mark as in library
        setRecommendations(prev => 
          prev.map(r => r.name === rec.name ? { ...r, inLibrary: true } : r)
        );
      }

      // Small delay between adds to avoid overwhelming Lidarr
      if (i < toAdd.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    setIsBulkAdding(false);
    setShowBulkAddModal(false);
    setSelectedRecs(new Set());

    if (successCount > 0) {
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        description="Get artist recommendations based on your Lidarr library"
      />

      {/* Filters Section */}
      <Card>
        <CardContent className="p-4">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium w-full"
          >
            <Filter className="h-4 w-4" />
            Filters
            {showFilters ? (
              <ChevronUp className="h-4 w-4 ml-auto" />
            ) : (
              <ChevronDown className="h-4 w-4 ml-auto" />
            )}
            {releaseTypes.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {releaseTypes.length} release type{releaseTypes.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </button>
          {showFilters && (
            <div className="mt-4 pt-4 border-t">
              <ReleaseTypeFilter
                value={releaseTypes}
                onChange={setReleaseTypes}
              />
              <p className="text-xs text-muted-foreground mt-3">
                Filter recommendations by release type (for future subscription results)
              </p>
            </div>
          )}
        </CardContent>
      </Card>

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
                <div className="border rounded-lg p-3 bg-muted/30 max-h-40 overflow-y-auto">
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
              <div className="relative min-h-[300px] max-h-[600px] overflow-y-auto border rounded-lg">
                {isLoadingLibrary && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                    <Loading text="Loading library..." />
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
                <div className="grid grid-cols-1 gap-3 p-3 bg-muted/50 rounded-lg">
                  <div className="text-sm font-medium">Add Settings</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                      className="px-3 py-2 rounded-md border bg-background text-sm"
                      value={selectedQuality || ''}
                      onChange={(e) => setSelectedQuality(Number(e.target.value))}
                    >
                      {profiles.qualityProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select
                      className="px-3 py-2 rounded-md border bg-background text-sm"
                      value={selectedMetadata || ''}
                      onChange={(e) => setSelectedMetadata(Number(e.target.value))}
                    >
                      {profiles.metadataProfiles.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <select
                      className="px-3 py-2 rounded-md border bg-background text-sm"
                      value={selectedRootFolder || ''}
                      onChange={(e) => setSelectedRootFolder(e.target.value)}
                    >
                      {profiles.rootFolders.map(p => (
                        <option key={p.id} value={p.path}>{p.path}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Recommendations List */}
              <div className="relative min-h-[300px] max-h-[500px] overflow-y-auto border rounded-lg">
                {isLoadingRecs && (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm z-10">
                    <Loading text="Finding recommendations..." />
                  </div>
                )}
                <div className="divide-y">
                  {recommendations.map((rec, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors ${
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
                      {/* Artist Image - larger size */}
                      <div className="flex-shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-md overflow-hidden bg-muted">
                        {rec.imageUrl ? (
                          <img
                            src={rec.imageUrl}
                            alt={rec.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music2 className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{rec.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          Similar to: {rec.matchedFrom.slice(0, 3).join(', ')}
                          {rec.matchedFrom.length > 3 && ` +${rec.matchedFrom.length - 3} more`}
                        </p>
                        {rec.genres && rec.genres.length > 0 && (
                          <GenrePills genres={rec.genres} maxDisplay={3} size="sm" className="mt-1" />
                        )}
                        {/* External links */}
                        <div className="flex gap-1 mt-1">
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
                      <Badge variant="outline" className="flex-shrink-0">
                        {rec.matchCount} match{rec.matchCount > 1 ? 'es' : ''}
                      </Badge>
                      {rec.inLibrary ? (
                        <Button size="sm" variant="outline" disabled>
                          <Check className="h-4 w-4 mr-1" />
                          Added
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => addToLidarr(rec)}
                          disabled={addingArtist === rec.name}
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
                      )}
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

      {/* Bulk Add Modal */}
      <Modal
        isOpen={showBulkAddModal}
        onClose={() => !isBulkAdding && setShowBulkAddModal(false)}
        title={`Add ${selectedRecs.size} Artist${selectedRecs.size > 1 ? 's' : ''} to Lidarr`}
      >
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Quality Profile</label>
            <select
              className="w-full border rounded-lg px-3 py-2 bg-background"
              value={addProfiles.qualityProfileId}
              onChange={(e) => setAddProfiles(p => ({ ...p, qualityProfileId: Number(e.target.value) }))}
              disabled={isBulkAdding}
            >
              {profiles?.qualityProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Metadata Profile</label>
            <select
              className="w-full border rounded-lg px-3 py-2 bg-background"
              value={addProfiles.metadataProfileId}
              onChange={(e) => setAddProfiles(p => ({ ...p, metadataProfileId: Number(e.target.value) }))}
              disabled={isBulkAdding}
            >
              {profiles?.metadataProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Root Folder</label>
            <select
              className="w-full border rounded-lg px-3 py-2 bg-background"
              value={addProfiles.rootFolderPath}
              onChange={(e) => setAddProfiles(p => ({ ...p, rootFolderPath: e.target.value }))}
              disabled={isBulkAdding}
            >
              {profiles?.rootFolders.map(f => (
                <option key={f.path} value={f.path}>{f.path}</option>
              ))}
            </select>
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
            onClick={() => setShowBulkAddModal(false)}
            disabled={isBulkAdding}
          >
            Cancel
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
    </div>
  );
}
