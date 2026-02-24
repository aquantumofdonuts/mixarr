'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingOverlay } from '@/components/ui/loading';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import { api } from '@/lib/api';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import SearchIcon from 'lucide-react/dist/esm/icons/search';

import { useSearch } from './hooks/useSearch';
import { useArtistAdd, isAlreadyExistsError } from './hooks/useArtistAdd';
import type { LabelResult } from './hooks/useSearch';
import { SearchBar } from './components/SearchBar';
import { ArtistSearch } from './components/ArtistSearch';
import { AlbumSearch } from './components/AlbumSearch';
import { LabelSearch } from './components/LabelSearch';
import { YearSearch } from './components/YearSearch';
import { AISearch } from './components/AISearch';
import { MbidSelectionModal } from './components/MbidSelectionModal';
import { LabelArtistsModal } from './components/LabelArtistsModal';

export default function SearchPage() {
  const search = useSearch();
  const artistAdd = useArtistAdd(search.setResults);
  const { addToast } = useToast();

  const [slskdModalOpen, setSlskdModalOpen] = useState(false);
  const [slskdSearchArtist, setSlskdSearchArtist] = useState<{ name: string; image?: string } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<LabelResult | null>(null);

  const handleSearchSlskd = useCallback((artist: { name: string; image?: string }) => {
    setSlskdSearchArtist(artist);
    setSlskdModalOpen(true);
  }, []);

  const handleAlbumAddArtist = useCallback(async (artistId: string, artistName: string) => {
    const { error } = await api.post('/api/search/artists/add', { foreignArtistId: artistId });
    if (error) {
      if (isAlreadyExistsError(error)) {
        addToast({ type: 'info', title: 'Already in Library', message: `"${artistName}" is already in your Lidarr library` });
      } else {
        addToast({ type: 'error', title: 'Failed to add artist', message: error });
      }
    } else {
      addToast({ type: 'success', title: 'Artist added', message: `${artistName} added to Lidarr` });
    }
  }, [addToast]);

  const showPagination = search.totalPages > 1 && ['album', 'label', 'year'].includes(search.searchType);

  return (
    <>
      <PageHeader title="Search" description="Find and add artists to your Lidarr library" />

      <SearchBar
        query={search.query} searchType={search.searchType}
        onQueryChange={search.setQuery} onSearchTypeChange={search.setSearchType}
        onSearch={() => search.performSearch(1)} isSearching={search.isSearching}
        sourceToggles={search.enabledSources} onToggleSource={search.toggleSource}
        aiAvailable={search.aiAvailable}
      />

      <LoadingOverlay isLoading={search.isSearching} text="Searching...">
        {search.results.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {search.totalCount} result{search.totalCount !== 1 ? 's' : ''} found
              </h2>
              {showPagination && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={search.page <= 1 || search.isSearching}
                    onClick={() => search.performSearch(search.page - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm">Page {search.page} of {search.totalPages}</span>
                  <Button variant="outline" size="sm" disabled={search.page >= search.totalPages || search.isSearching}
                    onClick={() => search.performSearch(search.page + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            {search.searchType === 'artist' && (
              <ArtistSearch results={search.results} addingArtistId={artistAdd.addingArtistId}
                isBulkAdding={artistAdd.isBulkAdding} onAddArtist={artistAdd.handleAddArtist}
                onBatchAdd={artistAdd.handleBatchAdd} onSearchSlskd={handleSearchSlskd} />
            )}
            {search.searchType === 'album' && (
              <AlbumSearch results={search.results} onAddArtist={handleAlbumAddArtist} />
            )}
            {search.searchType === 'label' && (
              <LabelSearch results={search.results} onViewArtists={setSelectedLabel} />
            )}
            {search.searchType === 'year' && <YearSearch results={search.results} />}
            {search.searchType === 'ai' && (
              <AISearch results={search.results} aiPrompt={search.aiPrompt} aiProviders={search.aiProviders}
                addingArtistId={artistAdd.addingArtistId} isBulkAdding={artistAdd.isBulkAdding}
                onAddArtist={artistAdd.handleAddArtist} onBatchAdd={artistAdd.handleBatchAdd}
                onSearchSlskd={handleSearchSlskd} />
            )}
          </div>
        )}

        {!search.isSearching && search.results.length === 0 && search.query && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">No results found</p>
              <p className="text-sm text-muted-foreground mt-1">Try a different search term</p>
            </CardContent>
          </Card>
        )}
        {!search.isSearching && !search.query && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <SearchIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <p className="text-muted-foreground">Enter a search term</p>
              <p className="text-sm text-muted-foreground mt-1">Search by artist, album, label, or year</p>
            </CardContent>
          </Card>
        )}
      </LoadingOverlay>

      <MbidSelectionModal candidates={artistAdd.mbidCandidates} artist={artistAdd.selectingArtist}
        onSelect={artistAdd.handleAddWithMbid} onClose={artistAdd.clearMbidModal} />
      <LabelArtistsModal
        label={selectedLabel ? { name: selectedLabel.name, id: selectedLabel.id } : null}
        onClose={() => setSelectedLabel(null)} />
      {slskdSearchArtist && (
        <SlskdSearchModal isOpen={slskdModalOpen} artistName={slskdSearchArtist.name}
          artistImage={slskdSearchArtist.image}
          onClose={() => { setSlskdModalOpen(false); setSlskdSearchArtist(null); }} />
      )}
    </>
  );
}
