'use client';

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/toast';

export type SearchType = 'artist' | 'album' | 'label' | 'year' | 'ai';
export type SearchSource = 'spotify' | 'deezer' | 'tidal' | 'bandcamp';

export interface ArtistResult {
  foreignArtistId: string;
  artistName: string;
  overview?: string;
  imageUrl?: string;
  inLibrary?: boolean;
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

export interface MbidCandidate {
  id: string;
  name: string;
  disambiguation?: string;
  country?: string;
}

export interface AlbumResult {
  id: string;
  title: string;
  date?: string;
  'artist-credit'?: Array<{ artist: { id: string; name: string } }>;
}

export interface LabelResult {
  id: string;
  name: string;
  country?: string;
  type?: string;
}

const PAGE_SIZE = 25;

/**
 * Hook that owns all search state and logic for the search page.
 *
 * Manages query, search type, results, pagination, source toggles (artist search),
 * and AI availability/prompt state.
 */
export function useSearch() {
  const [searchType, setSearchTypeRaw] = useState<SearchType>('artist');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { addToast } = useToast();

  // Source toggles for artist search
  const [enabledSources, setEnabledSources] = useState<Set<SearchSource>>(
    new Set(['spotify', 'deezer', 'tidal', 'bandcamp']),
  );

  // AI search state
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

  const toggleSource = useCallback((source: SearchSource) => {
    setEnabledSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) {
        next.delete(source);
      } else {
        next.add(source);
      }
      // Ensure at least one source remains enabled
      return next.size > 0 ? next : prev;
    });
  }, []);

  const performSearch = useCallback(
    async (pageNum = 1) => {
      if (!query.trim()) return;

      setIsSearching(true);
      setResults([]);
      setPage(pageNum);

      try {
      // ---------- AI search ----------
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
            const hasErrors = data.errors && data.errors.length > 0;
            addToast({
              type: hasErrors ? 'error' : 'info',
              title: hasErrors ? 'AI Search Error' : 'No results found',
              message: data.message || 'No recommendations found',
            });
          }
        }
        return;
      }

      // ---------- Standard searches ----------
      const offset = (pageNum - 1) * PAGE_SIZE;
      let endpoint = '';

      switch (searchType) {
        case 'artist': {
          const sourcesParam = Array.from(enabledSources).join(',');
          endpoint = `/api/search/discover?q=${encodeURIComponent(query)}&sources=${sourcesParam}`;
          break;
        }
        case 'album':
          endpoint = `/api/search/album?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`;
          break;
        case 'label':
          endpoint = `/api/search/label?q=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`;
          break;
        case 'year':
          endpoint = `/api/search/year?year=${encodeURIComponent(query)}&limit=${PAGE_SIZE}&offset=${offset}`;
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
            inLibrary: r.inLibrary,
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

        if (
          (data.results || data.releases || data.labels || data.releaseGroups || []).length === 0
        ) {
          addToast({ type: 'info', title: 'No results found' });
        }
      }
      } finally {
        setIsSearching(false);
      }
    },
    [query, searchType, enabledSources, addToast],
  );

  /** Change the active search type, clearing previous results. */
  const setSearchType = useCallback((type: SearchType) => {
    setSearchTypeRaw(type);
    setResults([]);
  }, []);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return {
    // State
    searchType,
    query,
    results,
    isSearching,
    page,
    totalCount,
    totalPages,
    pageSize: PAGE_SIZE,
    enabledSources,
    aiAvailable,
    aiPrompt,
    aiProviders,

    // Actions
    setQuery,
    setSearchType,
    setPage,
    setResults,
    toggleSource,
    performSearch,
  };
}
