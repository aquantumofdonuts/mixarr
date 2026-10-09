'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ResultState } from '@/components/ui/result-state';
import { PageHeader } from '@/components/layout/page-header';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import { useListContext } from '@/hooks/useListContext';
import { useSearch } from './hooks/useSearch';
import { useArtistAdd } from './hooks/useArtistAdd';
import type { LabelResult } from './hooks/useSearch';
import { SearchBar } from './components/SearchBar';
import { ArtistSearch } from './components/ArtistSearch';
import { AlbumSearch } from './components/AlbumSearch';
import { LabelSearch } from './components/LabelSearch';
import { YearSearch } from './components/YearSearch';
import { AISearch } from './components/AISearch';
import { LabelArtistsModal } from './components/LabelArtistsModal';

export default function SearchPage() {
  const search = useSearch();
  const artistAdd = useArtistAdd(search.setResults, search.scope);
  const artists = ['artist', 'ai'].includes(search.resultType);
  const context = useListContext({ ready: search.hasSearched && !search.isStale, selectionOwner: false, restore: !artists });
  const [slskdSearchArtist, setSlskdSearchArtist] = useState<{ name: string; image?: string } | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<LabelResult | null>(null);
  const handleAlbumAddArtist = useCallback(async (artistId: string, artistName: string) => {
    const result = await artistAdd.handleAddArtist({ foreignArtistId: artistId, artistName });
    return { success: result === true, error: result === true ? undefined : 'Addition cancelled or unconfirmed' };
  }, [artistAdd.handleAddArtist]);
  const disabled = search.isSearching || search.isStale;
  const artistProps = { results: search.results, addingArtistId: artistAdd.addingArtistId, pendingIds: artistAdd.pendingIds,
    isBulkAdding: artistAdd.isBulkAdding, disabled, onAddArtist: artistAdd.handleAddArtist, onBatchAdd: artistAdd.handleBatchAdd,
    onSearchSlskd: setSlskdSearchArtist };
  return <>
    <PageHeader title="Search" description="Find artists, albums and labels" />
    <SearchBar query={search.query} searchType={search.searchType} onQueryChange={search.setQuery} onSearchTypeChange={search.setSearchType}
      onSearch={() => { void search.performSearch(1); }} isSearching={search.isSearching} sourceToggles={search.enabledSources} onToggleSource={search.toggleSource} aiAvailable={search.aiAvailable} />
    {search.isSearching && <p role="status" className="py-3 text-sm">Searching…{search.results.length > 0 && ` Showing previous results for “${search.resultQuery}”.`}</p>}
    {search.error && <ResultState kind="error" message={`${search.error}${search.results.length ? ` Showing previous results for “${search.resultQuery}”.` : ''}`} action={<Button variant="outline" onClick={search.retrySearch}>Retry search</Button>} />}
    {search.partialErrors.length > 0 && <ResultState kind="partial-results" message={search.partialErrors.join('; ')} action={<Button variant="outline" onClick={search.retrySearch}>Retry search</Button>} />}
    {search.results.length > 0 && <div className="space-y-3" aria-busy={search.isSearching}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b py-2">
        <h2 className="text-sm font-semibold"><span className="font-mono">{search.totalCount}</span> results for “{search.resultQuery}”</h2>
        {search.totalPages > 1 && ['album', 'label', 'year'].includes(search.resultType) && <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={search.page <= 1 || disabled} onClick={() => search.goToPage(search.page - 1)}>Previous page</Button>
          <span className="font-mono text-xs">Page {search.resultPage} of {search.totalPages}</span>
          <Button variant="outline" size="sm" disabled={search.page >= search.totalPages || disabled} onClick={() => search.goToPage(search.page + 1)}>Next page</Button>
        </div>}
      </div>
      {search.resultType === 'artist' && <ArtistSearch {...artistProps} />}
      {search.resultType === 'album' && <AlbumSearch key={search.resultScope} results={search.results} disabled={disabled} onOpen={context.remember} onAddArtist={handleAlbumAddArtist} />}
      {search.resultType === 'label' && <LabelSearch results={search.results} onViewArtists={setSelectedLabel} />}
      {search.resultType === 'year' && <YearSearch results={search.results} />}
      {search.resultType === 'ai' && <AISearch {...artistProps} aiPrompt={search.aiPrompt} aiProviders={search.aiProviders} />}
    </div>}
    {!search.committedQuery && <ResultState kind="not-searched" message="Enter an artist, album, label, year or listening prompt, then Search." />}
    {search.committedQuery && !search.isSearching && !search.error && search.hasSearched && search.results.length === 0 && <ResultState kind="no-matches" message="Try another query or search source." />}
    {artistAdd.optionsDialog}

    <LabelArtistsModal label={selectedLabel ? { name: selectedLabel.name, id: selectedLabel.id } : null} onClose={() => setSelectedLabel(null)} />
    {slskdSearchArtist && <SlskdSearchModal isOpen artistName={slskdSearchArtist.name} artistImage={slskdSearchArtist.image} onClose={() => setSlskdSearchArtist(null)} />}
  </>;
}
