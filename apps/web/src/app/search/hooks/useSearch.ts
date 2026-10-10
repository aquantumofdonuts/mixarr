'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { readPage, updateQuery } from '@/lib/list-state';

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
  tidalId?: string;
  bandcampId?: number;
  resultKey?: string;
  acquisitionError?: string;
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
const SOURCES: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];
const TYPES: SearchType[] = ['artist', 'album', 'label', 'year', 'ai'];
// ponytail: name-only identities last only as long as their request's result objects.
const unidentifiedKeys = new WeakMap<ArtistResult, string>();
let unidentifiedSequence = 0;
export function artistResultKey(artist: ArtistResult): string {
  const stable = artist.resultKey || artist.foreignArtistId || [artist.spotifyId && `spotify:${artist.spotifyId}`, artist.deezerId && `deezer:${artist.deezerId}`, artist.tidalId && `tidal:${artist.tidalId}`, artist.bandcampId && `bandcamp:${artist.bandcampId}`].filter(Boolean).join('|');
  if (stable) return stable;
  let key = unidentifiedKeys.get(artist);
  if (!key) { key = `unidentified:${++unidentifiedSequence}`; unidentifiedKeys.set(artist, key); }
  return key;
}

export function useSearch() {
  const params = useSearchParams(), router = useRouter(), pathname = usePathname();
  const committedQuery = params.get('q')?.trim() || '';
  const searchType = TYPES.includes(params.get('tab') as SearchType) ? params.get('tab') as SearchType : 'artist';
  const sources = SOURCES.filter(source => (params.get('sources') || SOURCES.join(',')).split(',').includes(source));
  const sourcesKey = (sources.length ? sources : SOURCES).join(',');
  const enabledSources = new Set(sourcesKey.split(',') as SearchSource[]);
  const page = readPage(params.get('page'));
  const scope = JSON.stringify([committedQuery, searchType, sourcesKey, page]);
  const [query, setQuery] = useState(committedQuery);
  const [results, setResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [resultScope, setResultScope] = useState<string | null>(null);
  const [resultType, setResultType] = useState<SearchType>(searchType);
  const [resultQuery, setResultQuery] = useState('');
  const [resultPage, setResultPage] = useState(page);
  const [retry, setRetry] = useState(0);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProviders, setAiProviders] = useState<string[]>([]);
  const paramsRef = useRef(params.toString()); paramsRef.current = params.toString();

  useEffect(() => setQuery(committedQuery), [committedQuery]);
  useEffect(() => {
    const controller = new AbortController();
    api.get<{ available: boolean }>('/api/search/ai/status', { signal: controller.signal })
      .then(({ data }) => { if (!controller.signal.aborted) setAiAvailable(data?.available ?? false); }).catch(() => {});
    return () => controller.abort();
  }, []);

  const navigate = useCallback((patch: Record<string, string | null>, method: 'push' | 'replace' = 'push') => {
    router[method](`${pathname}${updateQuery(new URLSearchParams(paramsRef.current), patch)}`, { scroll: false });
  }, [pathname, router]);
  const setSearchType = useCallback((type: SearchType) => navigate({ tab: type, page: null }), [navigate]);
  const toggleSource = useCallback((source: SearchSource) => {
    const next = new Set(sourcesKey.split(',') as SearchSource[]);
    if (next.has(source)) next.delete(source); else next.add(source);
    if (next.size) navigate({ sources: SOURCES.filter(item => next.has(item)).join(','), page: null }, 'replace');
  }, [navigate, sourcesKey]);
  const performSearch = useCallback(async (pageNum = 1) => {
    if (!query.trim()) return;
    if (query.trim() === committedQuery && pageNum === page) setRetry(value => value + 1);
    else navigate({ q: query.trim(), tab: searchType, page: pageNum > 1 ? String(pageNum) : null });
  }, [query, committedQuery, page, searchType, navigate]);
  const goToPage = useCallback((next: number) => navigate({ page: next > 1 ? String(next) : null }), [navigate]);

  useEffect(() => {
    const controller = new AbortController();
    if (!committedQuery) {
      setResults([]); setResultScope(null); setTotalCount(0); setError(null); setPartialErrors([]); setIsSearching(false);
      return () => controller.abort();
    }
    setIsSearching(true); setError(null); setPartialErrors([]);
    async function load() {
      try {
        const offset = (page - 1) * PAGE_SIZE;
        const endpoint = searchType === 'artist' ? `/api/search/discover?q=${encodeURIComponent(committedQuery)}&sources=${sourcesKey}`
          : searchType === 'year' ? `/api/search/year?year=${encodeURIComponent(committedQuery)}&limit=${PAGE_SIZE}&offset=${offset}`
          : `/api/search/${searchType}?q=${encodeURIComponent(committedQuery)}&limit=${PAGE_SIZE}&offset=${offset}`;
        const response = searchType === 'ai'
          ? await api.post<any>('/api/search/ai', { prompt: committedQuery }, { signal: controller.signal })
          : await api.get<any>(endpoint, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.error || !response.data) { setError(response.error || 'The provider returned no response. Retry the search.'); return; }
        const data = response.data;
        let next;
        if (searchType === 'artist') {
          next = (data.results || []).map((r: any) => {
            const artist: ArtistResult = { foreignArtistId: r.mbid || '', artistName: r.name, overview: r.genres?.join(', ') || '', imageUrl: r.imageUrl, inLibrary: r.inLibrary, sources: r.sources || [], spotifyId: r.spotifyId, deezerId: r.deezerId, tidalId: r.tidalId, bandcampId: r.bandcampId, popularity: r.popularity, followers: r.followers, fans: r.fans };
            return { ...artist, resultKey: artistResultKey(artist) };
          });
        } else {
          next = data.results || data.releases || data.labels || data.releaseGroups || [];
          if (searchType === 'ai') next = next.map((artist: ArtistResult) => ({ ...artist, resultKey: artistResultKey(artist) }));
        }
        if (!next.length && data.errors?.length) { setError(data.message || data.errors.join('; ')); return; }
        setResults(next); setTotalCount(['artist', 'ai'].includes(searchType) ? next.length : data.count || 0);
        setPartialErrors(data.errors || []);
        setAiPrompt(data.prompt || ''); setAiProviders(data.aiProviders || []);
        setResultScope(scope); setResultType(searchType); setResultQuery(committedQuery); setResultPage(page);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Search failed');
      } finally { if (!controller.signal.aborted) setIsSearching(false); }
    }
    void load();
    return () => controller.abort();
  }, [scope, retry, committedQuery, searchType, sourcesKey, page]);

  return { searchType, query, committedQuery, results, isSearching, page, totalCount, totalPages: Math.ceil(totalCount / PAGE_SIZE), pageSize: PAGE_SIZE,
    enabledSources, aiAvailable, aiPrompt, aiProviders, error, partialErrors, scope, resultScope, resultType, resultQuery, resultPage,
    hasSearched: resultScope !== null, isStale: resultScope !== null && resultScope !== scope,
    setQuery, setSearchType, setResults, toggleSource, performSearch, goToPage, retrySearch: () => setRetry(value => value + 1) };
}
