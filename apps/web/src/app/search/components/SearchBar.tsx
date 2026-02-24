'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import SearchIcon from 'lucide-react/dist/esm/icons/search';
import type { SearchType, SearchSource } from '../hooks/useSearch';

export interface SearchBarProps {
  query: string;
  searchType: SearchType;
  onQueryChange: (query: string) => void;
  onSearchTypeChange: (type: SearchType) => void;
  onSearch: () => void;
  isSearching: boolean;
  sourceToggles: Set<SearchSource>;
  onToggleSource: (source: SearchSource) => void;
  aiAvailable: boolean | null;
}

const ALL_SOURCES: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];

export function SearchBar({
  query,
  searchType,
  onQueryChange,
  onSearchTypeChange,
  onSearch,
  isSearching,
  sourceToggles,
  onToggleSource,
  aiAvailable,
}: SearchBarProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onSearch();
  };

  return (
    <Card className="mb-8">
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            <select
              value={searchType}
              onChange={(e) => onSearchTypeChange(e.target.value as SearchType)}
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
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={handleKeyDown}
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
            <Button onClick={onSearch} disabled={isSearching || !query.trim()}>
              {isSearching ? 'Searching...' : 'Search'}
            </Button>
          </div>

          {/* Source Toggles (for artist search only) */}
          {searchType === 'artist' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground mr-1">Sources:</span>
              {ALL_SOURCES.map((source) => (
                <Button
                  key={source}
                  variant={sourceToggles.has(source) ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onToggleSource(source)}
                >
                  {source.charAt(0).toUpperCase() + source.slice(1)}
                </Button>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
