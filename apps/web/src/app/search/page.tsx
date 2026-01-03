'use client';

import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { Button, Card, CardContent, Input, Badge, useToast, LoadingOverlay, Modal, ModalFooter, Select } from '@/components/ui';
import { PageHeader } from '@/components/layout/page-header';
import { ArtistCard } from '@/components/ArtistCard';
import { AlbumCard } from '@/components/AlbumCard';
import { ExternalLinks } from '@/components/ExternalLinks';
import { api } from '@/lib/api';
import { Search as SearchIcon, Plus, Music, ChevronLeft, ChevronRight, CheckSquare, Square, X, Loader2, Sparkles } from 'lucide-react';

type SearchType = 'artist' | 'album' | 'label' | 'year' | 'ai';
type SearchSource = 'spotify' | 'deezer' | 'tidal' | 'bandcamp';

interface ArtistResult {
  foreignArtistId: string;
  artistName: string;
  overview?: string;
  imageUrl?: string;
  inLibrary: boolean;
  sources?: SearchSource[];
  spotifyId?: string;
  deezerId?: number;
  popularity?: number;
  followers?: number;
  fans?: number;
  lastfm?: {
    listeners: number;
    playcount: number;
    tags: string[];
  };
}

interface MbidCandidate {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
}

interface AlbumResult {
  id: string;
  title: string;
  date?: string;
  'artist-credit'?: Array<{ artist: { id: string; name: string } }>;
}

interface LabelResult {
  id: string;
  name: string;
  country?: string;
  type?: string;
}

interface LabelArtist {
  id: string;
  name: string;
  sortName?: string;
  imageUrl?: string | null;
}

export default function SearchPage() {
  const [searchType, setSearchType] = useState<SearchType>('artist');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addingArtist, setAddingArtist] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { addToast } = useToast();
  const pageSize = 25;

  // Multi-source search state
  const [enabledSources, setEnabledSources] = useState<Set<SearchSource>>(
    new Set(['spotify', 'deezer', 'tidal', 'bandcamp'])
  );
  const [mbidCandidates, setMbidCandidates] = useState<MbidCandidate[] | null>(null);
  const [selectingArtist, setSelectingArtist] = useState<ArtistResult | null>(null);

  // Label artists modal state
  const [labelArtists, setLabelArtists] = useState<LabelArtist[]>([]);
  const [selectedLabelArtistIds, setSelectedLabelArtistIds] = useState<Set<string>>(new Set());
  const [loadingLabelArtists, setLoadingLabelArtists] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<LabelResult | null>(null);
  const [addingLabelArtists, setAddingLabelArtists] = useState(false);
  
  // Label modal controls state
  const [labelSearchQuery, setLabelSearchQuery] = useState('');
  const [labelSortOrder, setLabelSortOrder] = useState<'asc' | 'desc'>('asc');
  const [hasMoreLabelArtists, setHasMoreLabelArtists] = useState(true);
  const [isLoadingMoreArtists, setIsLoadingMoreArtists] = useState(false);
  const [totalLabelArtists, setTotalLabelArtists] = useState(0);
  const labelModalRef = useRef<HTMLDivElement>(null);
  const labelPageSize = 50;

  // AI Search state
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProviders, setAiProviders] = useState<string[]>([]);

  // Check AI availability on mount
  useEffect(() => {
    const checkAiStatus = async () => {
      const { data } = await api.get<{ available: boolean }>('/api/search/ai/status');
      setAiAvailable(data?.available ?? false);
    };
    checkAiStatus();
  }, []);

  // Helper to handle add artist errors with friendly messages
  const handleAddArtistError = (error: string, artistName: string) => {
    if (error.includes('ArtistExistsValidator') || error.includes('already been added')) {
      addToast({ 
        type: 'info', 
        title: 'Already in Library', 
        message: `"${artistName}" is already in your Lidarr library` 
      });
    } else {
      addToast({ type: 'error', title: 'Failed to add artist', message: error });
    }
  };

  const handleSearch = async (pageNum = 1) => {
    if (!query.trim()) return;

    setIsSearching(true);
    setResults([]);
    setSelectedIds(new Set());
    setPage(pageNum);

    // AI Search flow
    if (searchType === 'ai') {
      const { data, error } = await api.post<{
        prompt: string;
        results: ArtistResult[];
        aiProviders: string[];
        message?: string;
        errors?: string[];
      }>('/api/search/ai', { prompt: query.trim() });

      if (error) {
        addToast({ type: 'error', title: 'AI Search failed', message: error });
      } else if (data) {
        setAiPrompt(data.prompt);
        setAiProviders(data.aiProviders);
        setResults(data.results);
        setTotalCount(data.results.length);
        
        if (data.results.length === 0) {
          // Show error toast if there were provider errors, info toast otherwise
          const hasErrors = data.errors && data.errors.length > 0;
          addToast({ 
            type: hasErrors ? 'error' : 'info', 
            title: hasErrors ? 'AI Search Error' : 'No results found',
            message: data.message || 'No recommendations found'
          });
        }
      }
      setIsSearching(false);
      return;
    }

    const offset = (pageNum - 1) * pageSize;
    let endpoint = '';
    
    switch (searchType) {
      case 'artist':
        const sourcesParam = Array.from(enabledSources).join(',');
        endpoint = `/api/search/discover?q=${encodeURIComponent(query)}&sources=${sourcesParam}`;
        break;
      case 'album':
        endpoint = `/api/search/album?q=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`;
        break;
      case 'label':
        endpoint = `/api/search/label?q=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`;
        break;
      case 'year':
        endpoint = `/api/search/year?year=${encodeURIComponent(query)}&limit=${pageSize}&offset=${offset}`;
        break;
    }

    const { data, error } = await api.get<any>(endpoint);

    if (error) {
      addToast({ type: 'error', title: 'Search failed', message: error });
    } else if (data) {
      if (searchType === 'artist') {
        const artistResults = (data.results || []).map((r: any) => ({
          foreignArtistId: r.mbid || '',
          artistName: r.name,
          overview: r.genres?.join(', ') || '',
          imageUrl: r.imageUrl,
          inLibrary: r.inLibrary || false,
          sources: r.sources || [],
          spotifyId: r.spotifyId,
          deezerId: r.deezerId,
          popularity: r.popularity,
          followers: r.followers,
          fans: r.fans,
        }));
        setResults(artistResults);
        setTotalCount(artistResults.length);
      } else if (searchType === 'album') {
        setResults(data.releases || []);
        setTotalCount(data.count || 0);
      } else if (searchType === 'label') {
        setResults(data.labels || []);
        setTotalCount(data.count || 0);
      } else if (searchType === 'year') {
        setResults(data.releaseGroups || []);
        setTotalCount(data.count || 0);
      }
      
      if ((data.results || data.releases || data.labels || data.releaseGroups || []).length === 0) {
        addToast({ type: 'info', title: 'No results found' });
      }
    }
    setIsSearching(false);
  };

  const handleAdd = async (artist: ArtistResult) => {
    // If no MBID, use discovery add endpoint
    if (!artist.foreignArtistId) {
      setAddingArtist(artist.artistName);
      
      const { data, error } = await api.post<{ 
        success?: boolean; 
        artist?: any;
        error?: string;
        candidates?: MbidCandidate[];
        artistName?: string;
      }>('/api/search/discover/add', {
        artistName: artist.artistName,
      });

      if (error) {
        handleAddArtistError(error, artist.artistName);
      } else if (data?.candidates) {
        // Show MBID selection modal
        setMbidCandidates(data.candidates);
        setSelectingArtist(artist);
      } else if (data?.success) {
        addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
        setResults(prev => prev.map(r => 
          r.artistName === artist.artistName ? { ...r, inLibrary: true, foreignArtistId: data.artist?.foreignArtistId } : r
        ));
      }
      setAddingArtist(null);
      return;
    }
    
    // Existing flow for artists with MBID
    setAddingArtist(artist.foreignArtistId);

    const { data, error } = await api.post<{ success: boolean; artist?: any }>('/api/search/artists/add', {
      foreignArtistId: artist.foreignArtistId,
    });

    if (error) {
      handleAddArtistError(error, artist.artistName);
    } else if (data?.success) {
      addToast({ type: 'success', title: 'Artist added', message: `${artist.artistName} added to Lidarr` });
      setResults(prev => prev.map(r => 
        r.foreignArtistId === artist.foreignArtistId ? { ...r, inLibrary: true } : r
      ));
    }
    setAddingArtist(null);
  };

  const handleSelectMbid = async (mbid: string) => {
    if (!selectingArtist) return;
    
    setAddingArtist(selectingArtist.artistName);
    setMbidCandidates(null);
    
    const { data, error } = await api.post<{ success: boolean; artist?: any }>('/api/search/discover/add', {
      artistName: selectingArtist.artistName,
      mbid,
    });

    if (error) {
      handleAddArtistError(error, selectingArtist.artistName);
    } else if (data?.success) {
      addToast({ type: 'success', title: 'Artist added', message: `${selectingArtist.artistName} added to Lidarr` });
      setResults(prev => prev.map(r => 
        r.artistName === selectingArtist.artistName ? { ...r, inLibrary: true, foreignArtistId: mbid } : r
      ));
    }
    
    setSelectingArtist(null);
    setAddingArtist(null);
  };

  const handleBulkAdd = async () => {
    if (selectedIds.size === 0) return;
    
    setIsBulkAdding(true);
    const { data, error } = await api.post<{ added: string[]; skipped: string[]; failed: { id: string; error: string }[] }>(
      '/api/search/batch',
      { artistIds: Array.from(selectedIds) }
    );

    if (error) {
      addToast({ type: 'error', title: 'Bulk add failed', message: error });
    } else if (data) {
      addToast({ 
        type: 'success', 
        title: 'Bulk add complete', 
        message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}` 
      });
      const addedSet = new Set([...data.added, ...data.skipped]);
      setResults(prev => prev.map(r => 
        addedSet.has(r.foreignArtistId) ? { ...r, inLibrary: true } : r
      ));
      setSelectedIds(new Set());
    }
    setIsBulkAdding(false);
  };

  // Load artists from a label (initial load)
  const loadLabelArtists = async (label: LabelResult) => {
    setSelectedLabel(label);
    setLoadingLabelArtists(true);
    setLabelArtists([]);
    setSelectedLabelArtistIds(new Set());
    setLabelSearchQuery('');
    setLabelSortOrder('asc');
    setHasMoreLabelArtists(true);

    const { data, error } = await api.get<{ artists: LabelArtist[]; count: number }>(
      `/api/search/label/${label.id}/artists?limit=${labelPageSize}&offset=0`
    );
    
    if (error) {
      addToast({ type: 'error', title: 'Failed to load artists', message: error });
      setSelectedLabel(null);
    } else if (data?.artists) {
      setLabelArtists(data.artists);
      setTotalLabelArtists(data.count);
      setHasMoreLabelArtists(data.artists.length >= labelPageSize);
      if (data.artists.length === 0) {
        addToast({ type: 'info', title: 'No artists found for this label' });
      }
    }
    setLoadingLabelArtists(false);
  };

  // Load more artists for infinite scroll
  const loadMoreLabelArtists = useCallback(async () => {
    if (!selectedLabel || isLoadingMoreArtists || !hasMoreLabelArtists) return;
    
    setIsLoadingMoreArtists(true);
    const newOffset = labelArtists.length;
    
    const { data, error } = await api.get<{ artists: LabelArtist[]; count: number }>(
      `/api/search/label/${selectedLabel.id}/artists?limit=${labelPageSize}&offset=${newOffset}`
    );
    
    if (!error && data?.artists) {
      setLabelArtists(prev => [...prev, ...data.artists]);
      setHasMoreLabelArtists(data.artists.length >= labelPageSize);
    }
    setIsLoadingMoreArtists(false);
  }, [selectedLabel, isLoadingMoreArtists, hasMoreLabelArtists, labelArtists.length]);

  // Filtered and sorted label artists
  const displayedLabelArtists = useMemo(() => {
    let filtered = labelArtists;
    
    // Apply search filter
    if (labelSearchQuery.trim()) {
      const query = labelSearchQuery.toLowerCase();
      filtered = filtered.filter(a => a.name.toLowerCase().includes(query));
    }
    
    // Apply sort
    return [...filtered].sort((a, b) => {
      const cmp = a.name.localeCompare(b.name);
      return labelSortOrder === 'asc' ? cmp : -cmp;
    });
  }, [labelArtists, labelSearchQuery, labelSortOrder]);

  // Handle scroll for infinite loading
  const handleLabelModalScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const scrollBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    
    // Load more when within 100px of bottom
    if (scrollBottom < 100 && hasMoreLabelArtists && !isLoadingMoreArtists && !labelSearchQuery) {
      loadMoreLabelArtists();
    }
  }, [hasMoreLabelArtists, isLoadingMoreArtists, labelSearchQuery, loadMoreLabelArtists]);

  const closeLabelModal = () => {
    setSelectedLabel(null);
    setLabelArtists([]);
    setSelectedLabelArtistIds(new Set());
  };

  const toggleLabelArtistSelect = (id: string) => {
    setSelectedLabelArtistIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const addLabelArtists = async () => {
    if (selectedLabelArtistIds.size === 0) return;
    
    setAddingLabelArtists(true);
    const { data, error } = await api.post<{ added: string[]; skipped: string[]; failed: { id: string; error: string }[] }>(
      '/api/search/batch',
      { artistIds: Array.from(selectedLabelArtistIds) }
    );

    if (error) {
      addToast({ type: 'error', title: 'Failed to add artists', message: error });
    } else if (data) {
      addToast({ 
        type: 'success', 
        title: 'Artists added', 
        message: `Added: ${data.added.length}, Skipped: ${data.skipped.length}, Failed: ${data.failed.length}` 
      });
      setSelectedLabelArtistIds(new Set());
      closeLabelModal();
    }
    setAddingLabelArtists(false);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    if (searchType !== 'artist') return;
    const allIds = results
      .filter((r: ArtistResult) => !r.inLibrary)
      .map((r: ArtistResult) => r.foreignArtistId);
    setSelectedIds(new Set(allIds));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch(1);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <>
      <PageHeader
        title="Search"
        description="Find and add artists to your Lidarr library"
      />

      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4">
            <div className="flex gap-3">
              <select
                value={searchType}
                onChange={(e) => {
                  setSearchType(e.target.value as SearchType);
                  setResults([]);
                  setSelectedIds(new Set());
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="artist">Artist</option>
                <option value="album">Album</option>
                <option value="label">Label</option>
                <option value="year">Year</option>
                <option value="ai" disabled={aiAvailable === false}>
                  AI Search
                </option>
              </select>
              
              <div className="relative flex-1">
                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={
                    searchType === 'ai' 
                      ? "Describe what you're looking for..." 
                      : searchType === 'year' 
                      ? 'Enter year (e.g., 2024)' 
                      : `Search for ${searchType}...`
                  }
                  className="pl-10"
                />
              </div>
              <Button onClick={() => handleSearch(1)} disabled={isSearching || !query.trim()}>
                {isSearching ? 'Searching...' : 'Search'}
              </Button>
            </div>

            {/* Source Toggles (for artist search only) */}
            {searchType === 'artist' && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground mr-1">Sources:</span>
                {(['spotify', 'deezer', 'tidal', 'bandcamp'] as SearchSource[]).map((source) => (
                  <Button
                    key={source}
                    variant={enabledSources.has(source) ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      const newSources = new Set(enabledSources);
                      if (newSources.has(source)) {
                        newSources.delete(source);
                      } else {
                        newSources.add(source);
                      }
                      // Ensure at least one source is enabled
                      if (newSources.size > 0) {
                        setEnabledSources(newSources);
                      }
                    }}
                  >
                    {source.charAt(0).toUpperCase() + source.slice(1)}
                  </Button>
                ))}
              </div>
            )}

            {(searchType === 'artist' || searchType === 'ai') && results.length > 0 && (
              <div className="flex items-center gap-3 border-t pt-4">
                <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
                <Button variant="outline" size="sm" onClick={deselectAll}>Deselect All</Button>
                {selectedIds.size > 0 && (
                  <Button size="sm" onClick={handleBulkAdd} disabled={isBulkAdding}>
                    {isBulkAdding ? 'Adding...' : `Add ${selectedIds.size} Selected`}
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <LoadingOverlay isLoading={isSearching} text="Searching...">
        {results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {totalCount} result{totalCount !== 1 ? 's' : ''} found
              </h2>
              
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleSearch(page - 1)} disabled={page <= 1 || isSearching}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {page} of {totalPages}</span>
                  <Button variant="outline" size="sm" onClick={() => handleSearch(page + 1)} disabled={page >= totalPages || isSearching}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
            
            {/* AI Results Banner */}
            {searchType === 'ai' && results.length > 0 && (
              <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/20 rounded-lg p-4 mb-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-purple-400" />
                  <span className="text-purple-400 font-medium">AI Recommendations for:</span>
                  <span className="text-zinc-300">"{aiPrompt}"</span>
                </div>
                {aiProviders.length > 0 && (
                  <p className="text-zinc-500 text-sm mt-1">
                    Powered by {aiProviders.join(' & ')}
                  </p>
                )}
              </div>
            )}

            {(searchType === 'artist' || searchType === 'ai') && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(results as ArtistResult[]).map((artist, i) => (
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
                    onAdd={() => handleAdd(artist)}
                    isAdding={addingArtist === artist.foreignArtistId || addingArtist === artist.artistName}
                  />
                ))}
              </div>
            )}

            {searchType === 'album' && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(results as AlbumResult[]).map((album, i) => (
                  <AlbumCard
                    key={`${album.id}-${i}`}
                    id={album.id}
                    title={album.title}
                    artistId={album['artist-credit']?.[0]?.artist?.id}
                    artistName={album['artist-credit']?.[0]?.artist?.name}
                    date={album.date}
                    onAddArtist={async (artistId, artistName) => {
                      const { error } = await api.post('/api/search/artists/add', { foreignArtistId: artistId });
                      if (error) {
                        handleAddArtistError(error, artistName);
                      } else {
                        addToast({ type: 'success', title: 'Artist added', message: `${artistName} added to Lidarr` });
                      }
                    }}
                  />
                ))}
              </div>
            )}

            {searchType === 'label' && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {(results as LabelResult[]).map((label, i) => (
                  <Card key={`${label.id}-${i}`} className="p-4">
                    <h3 className="font-semibold truncate">{label.name}</h3>
                    <div className="flex gap-2 mt-1">
                      {label.type && <Badge variant="outline" className="text-xs">{label.type}</Badge>}
                      {label.country && <Badge variant="outline" className="text-xs">{label.country}</Badge>}
                    </div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => loadLabelArtists(label)}>
                      View Artists
                    </Button>
                  </Card>
                ))}
              </div>
            )}

            {searchType === 'year' && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {results.map((rg: any, i: number) => (
                  <Card key={`${rg.id}-${i}`} className="p-4">
                    <h3 className="font-semibold truncate">{rg.title}</h3>
                    {rg['artist-credit']?.[0]?.artist && <p className="text-sm text-muted-foreground truncate">{rg['artist-credit'][0].artist.name}</p>}
                    <div className="flex gap-2 mt-1">
                      {rg['primary-type'] && <Badge variant="outline" className="text-xs">{rg['primary-type']}</Badge>}
                      {rg['first-release-date'] && <span className="text-xs text-muted-foreground">{rg['first-release-date']}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {!isSearching && results.length === 0 && query && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No results found</p>
              <p className="text-sm text-muted-foreground mt-1">Try a different search term</p>
            </CardContent>
          </Card>
        )}

        {!isSearching && !query && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Enter a search term</p>
              <p className="text-sm text-muted-foreground mt-1">Search by artist, album, label, or year</p>
            </CardContent>
          </Card>
        )}
      </LoadingOverlay>

      {/* Label Artists Modal */}
      {selectedLabel && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">{selectedLabel.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {loadingLabelArtists ? 'Loading...' : `${totalLabelArtists > 0 ? totalLabelArtists : labelArtists.length} artists found`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {selectedLabelArtistIds.size > 0 && (
                  <Button size="sm" onClick={addLabelArtists} disabled={addingLabelArtists}>
                    {addingLabelArtists ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                    Add {selectedLabelArtistIds.size} Selected
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={closeLabelModal}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            
            {/* Search and Sort Controls */}
            {!loadingLabelArtists && labelArtists.length > 0 && (
              <div className="p-4 border-b bg-muted/30 space-y-3">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    placeholder="Filter artists by name..."
                    value={labelSearchQuery}
                    onChange={(e) => setLabelSearchQuery(e.target.value)}
                    className="pl-10 h-11 text-base"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {displayedLabelArtists.length} of {labelArtists.length} artists
                  </span>
                  <Select
                    value={labelSortOrder}
                    onChange={(e) => setLabelSortOrder(e.target.value as 'asc' | 'desc')}
                    options={[
                      { value: 'asc', label: 'A → Z' },
                      { value: 'desc', label: 'Z → A' },
                    ]}
                    className="w-28"
                  />
                </div>
              </div>
            )}
            
            <div 
              className="flex-1 overflow-auto p-4"
              onScroll={handleLabelModalScroll}
              ref={labelModalRef}
            >
              {loadingLabelArtists ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : labelArtists.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No artists found</p>
              ) : displayedLabelArtists.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No artists match your search</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2 mb-4">
                    <Button variant="outline" size="sm" onClick={() => setSelectedLabelArtistIds(new Set(displayedLabelArtists.map(a => a.id)))}>
                      Select All{labelSearchQuery ? ' Visible' : ''}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setSelectedLabelArtistIds(new Set())}>
                      Deselect All
                    </Button>
                  </div>
                  {displayedLabelArtists.map((artist) => (
                    <div
                      key={artist.id}
                      className="flex items-center gap-3 p-3 rounded hover:bg-muted cursor-pointer"
                      onClick={() => toggleLabelArtistSelect(artist.id)}
                    >
                      {selectedLabelArtistIds.has(artist.id) ? (
                        <CheckSquare className="h-5 w-5 text-primary flex-shrink-0" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                      )}
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-md bg-muted flex items-center justify-center flex-shrink-0 overflow-hidden">
                        {artist.imageUrl ? (
                          <img src={artist.imageUrl} alt={artist.name} className="w-full h-full object-cover" />
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
                  {isLoadingMoreArtists && (
                    <div className="flex items-center justify-center py-4">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mr-2" />
                      <span className="text-sm text-muted-foreground">Loading more...</span>
                    </div>
                  )}
                  
                  {/* End of list indicator */}
                  {!hasMoreLabelArtists && labelArtists.length > labelPageSize && !labelSearchQuery && (
                    <p className="text-center text-sm text-muted-foreground py-2">All artists loaded</p>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* MBID Selection Modal */}
      <Modal
        isOpen={mbidCandidates !== null && selectingArtist !== null}
        onClose={() => {
          setMbidCandidates(null);
          setSelectingArtist(null);
        }}
        title="Select Artist"
        size="lg"
      >
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground mb-4">
            Multiple matches found in MusicBrainz for &quot;{selectingArtist?.artistName}&quot;. 
            Please select the correct artist:
          </p>
          {mbidCandidates?.map((candidate) => (
            <button
              key={candidate.id}
              className="w-full p-3 text-left rounded-lg border hover:bg-muted/50 transition-colors"
              onClick={() => handleSelectMbid(candidate.id)}
            >
              <div className="font-medium">{candidate.name}</div>
              {candidate.disambiguation && (
                <div className="text-sm text-muted-foreground">{candidate.disambiguation}</div>
              )}
              {candidate.country && (
                <div className="text-xs text-muted-foreground">Country: {candidate.country}</div>
              )}
            </button>
          ))}
        </div>
        <ModalFooter>
          <Button
            variant="outline"
            onClick={() => {
              setMbidCandidates(null);
              setSelectingArtist(null);
            }}
          >
            Cancel
          </Button>
        </ModalFooter>
      </Modal>
    </>
  );
}
