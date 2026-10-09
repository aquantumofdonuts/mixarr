'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import { useHasLidarr, useLibrary, queryKeys } from '@/lib/hooks';
import { readPage, retainSelection, updateQuery } from '@/lib/list-state';
import { useListContext } from '@/hooks/useListContext';
import { ArtistLink, canonicalArtistMbid } from '@/components/artists/ArtistLink';
import { useAddArtistOptions } from '@/components/artists/AddArtistOptions';
import { Button } from '@/components/ui/button';
import { BulkToolbar } from '@/components/ui/bulk-toolbar';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/layout/page-header';
import { GenrePills } from '@/components/GenrePills';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import { useToast } from '@/components/ui/toast';
import Music2 from 'lucide-react/dist/esm/icons/music-2';

interface Recommendation {
  name: string; mbid?: string; url?: string; imageUrl?: string;
  matchCount: number; matchedFrom: string[]; inLibrary: boolean; genres?: string[];
}
interface RecommendationsResponse {
  recommendations: Recommendation[]; seedArtists: string[]; total: number;
  failedSeedArtists?: string[];
}
const MAX_SEEDS = 20, MAX_SAVED_SEEDS = 100;

export default function DiscoverPage() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const { user } = useAuth();
  const actor = user?.id ?? null;
  const queryClient = useQueryClient();
  const { data: hasLidarr, isLoading: lidarrLoading } = useHasLidarr();
  const { addToast } = useToast();
  const page = readPage(params.get('page'));
  const committedSearch = params.get('q')?.slice(0, 500) ?? '';
  const [search, setSearch] = useState(committedSearch);
  useEffect(() => setSearch(committedSearch), [committedSearch]);
  const query = params.toString();
  const seedValues = useMemo(() => [...new Set(new URLSearchParams(query).getAll('seed').slice(0, MAX_SEEDS).map(value => canonicalArtistMbid(value) || value.slice(0, 500)))], [query]);
  const seedIds = useMemo(() => seedValues.filter(value => canonicalArtistMbid(value)).sort(), [seedValues]);
  const seedSignature = seedIds.join(',');
  const { data: library, isLoading: loadingLibrary, error: libraryError, refetch: retryLibrary } = useLibrary({ page, limit: 50, search: committedSearch || undefined });
  const [storedSeeds, setStoredSeeds] = useState<{ actor: number | null; names: Record<string, string> }>({ actor: null, names: {} });
  useEffect(() => {
    const names: Record<string, string> = {};
    if (actor !== null) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`mixarr:discovery-seeds:${actor}`) || '{}');
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [id, name] of Object.entries(saved).slice(0, MAX_SAVED_SEEDS)) {
          const identity = canonicalArtistMbid(id);
          if (identity && typeof name === 'string' && name.length > 0 && name.length <= 500) names[identity] = name;
        }
      } catch { /* ponytail: unavailable session storage leaves URL identities recoverable from the library. */ }
    }
    setStoredSeeds({ actor, names });
  }, [actor]);
  const seedNames = useMemo(() => {
    const names = { ...(storedSeeds.actor === actor ? storedSeeds.names : {}) };
    for (const artist of library?.artists ?? []) {
      const id = canonicalArtistMbid(artist.foreignArtistId);
      if (id && typeof artist.name === 'string' && artist.name.length > 0 && artist.name.length <= 500) names[id] = artist.name;
    }
    return names;
  }, [actor, storedSeeds, library]);
  useEffect(() => {
    if (actor === null || storedSeeds.actor !== actor) return;
    // Keep bounded previously chosen identities so Back can restore an off-page seed.
    const saved = Object.fromEntries([...Object.entries(storedSeeds.names).filter(([id]) => !seedIds.includes(id)), ...seedIds.filter(id => seedNames[id]).map(id => [id, seedNames[id]])].slice(-MAX_SAVED_SEEDS));
    try { sessionStorage.setItem(`mixarr:discovery-seeds:${actor}`, JSON.stringify(saved)); }
    catch { /* ponytail: session storage is optional; canonical seeds stay in the URL. */ }
  }, [actor, storedSeeds, seedIds, seedNames]);

  const allResolved = seedValues.length > 0 && seedIds.length === seedValues.length && seedIds.every(id => seedNames[id]);
  const recommendationKey = [...queryKeys.recommendations, actor, seedSignature, seedIds.map(id => seedNames[id] || ''), 'lastfm', 100] as const;
  const keySignature = JSON.stringify(recommendationKey);
  const { data: recsData, isFetching: loadingRecommendations, error: recommendationError, refetch: retryRecommendations } = useQuery<RecommendationsResponse>({
    queryKey: recommendationKey,
    queryFn: async ({ signal }) => {
      const { data, error } = await api.post<RecommendationsResponse>('/api/discover/similar', { artistNames: seedIds.map(id => seedNames[id]), limit: 100 }, { signal });
      if (error || !data) throw new Error(error || 'Recommendations unavailable');
      return data;
    },
    enabled: actor !== null && !!hasLidarr && allResolved,
    staleTime: 60 * 1000, gcTime: 30 * 60 * 1000, retry: false,
  });
  useEffect(() => () => { void queryClient.cancelQueries({ queryKey: recommendationKey, exact: true }); }, [keySignature, queryClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const failedSeeds = recsData?.failedSeedArtists ?? [];
  const everySeedFailed = !!recsData && failedSeeds.length > 0 && failedSeeds.length === recsData.seedArtists.length;
  const providerFailed = allResolved && (!!recommendationError || everySeedFailed);
  // ponytail: retain one successful response for this mounted actor, never another actor's cached rows.
  const lastSuccess = useRef<{ actor: number | null; key: string; data: RecommendationsResponse } | null>(null);
  if (lastSuccess.current?.actor !== actor) lastSuccess.current = null;
  if (actor !== null && allResolved && recsData && !providerFailed) lastSuccess.current = { actor, key: keySignature, data: recsData };
  const displayData = seedValues.length > 0 ? (allResolved && recsData && !providerFailed ? recsData : lastSuccess.current?.data) : undefined;
  const showingPrevious = !!displayData && (!allResolved || !recsData || providerFailed || lastSuccess.current?.key !== keySignature);
  const actionsUnavailable = showingPrevious || loadingRecommendations || providerFailed || !allResolved;
  const recommendations = displayData?.recommendations ?? [];
  const context = useListContext({ ready: !loadingLibrary && !loadingRecommendations, retainSelectionOnScopeChange: true });
  // ponytail: canonical/provider identities survive reordering; unresolved names are scoped to this response object.
  const unresolvedKeys = useRef(new WeakMap<Recommendation, string>()), nextKey = useRef(0);
  const rowKey = useCallback((rec: Recommendation) => {
    const mbid = canonicalArtistMbid(rec.mbid);
    if (mbid) return `mbid:${mbid}`;
    if (rec.url?.startsWith('https://www.last.fm/music/')) return `lastfm:${rec.url}`;
    if (!unresolvedKeys.current.has(rec)) unresolvedKeys.current.set(rec, `unresolved:${++nextKey.current}`);
    return unresolvedKeys.current.get(rec)!;
  }, []);
  const { setSelected } = context;
  useEffect(() => {
    if (!allResolved || !recsData || loadingRecommendations || providerFailed) return;
    const available = new Set(recsData.recommendations.filter(rec => !rec.inLibrary).map(rowKey));
    setSelected(previous => retainSelection(previous, available));
  }, [recsData, allResolved, loadingRecommendations, providerFailed, setSelected, rowKey]);
  const optionsAction = useAddArtistOptions(`${keySignature}:${actionsUnavailable ? 'previous' : 'current'}`);
  const [adding, setAdding] = useState<string | null>(null), [bulkAdding, setBulkAdding] = useState(false);
  useEffect(() => { setAdding(null); setBulkAdding(false); }, [keySignature]);
  const [soulseekArtist, setSoulseekArtist] = useState<{ name: string; image?: string } | null>(null);
  const selected = recommendations.filter(rec => context.selected.has(rowKey(rec)) && !rec.inLibrary);
  const patchConfirmed = (rec: Recommendation, mbid?: string) => {
    const key = rowKey(rec);
    queryClient.setQueryData<RecommendationsResponse>(recommendationKey, old => old ? { ...old, recommendations: old.recommendations.map(row => rowKey(row) === key ? { ...row, ...(mbid ? { mbid } : {}), inLibrary: true } : row) } : old);
    context.setSelected(previous => { const next = new Set(previous); next.delete(key); return next; });
  };
  const addArtist = async (rec: Recommendation) => {
    if (actionsUnavailable) return;
    await optionsAction.runWithOptions({ name: rec.name, mbid: canonicalArtistMbid(rec.mbid) }, async (options, isCurrent) => {
      setAdding(rowKey(rec));
      try {
        const { data, error } = await api.post<{ success?: boolean }>('/api/discover/add', { artistName: rec.name, ...options });
        if (!isCurrent()) return;
        if (error || data?.success !== true) throw new Error(error || 'Addition was not confirmed');
        patchConfirmed(rec, options.mbid); addToast({ type: 'success', title: `Added ${rec.name} to Lidarr` });
      } finally { if (isCurrent()) setAdding(null); }
    });
  };
  const bulkAdd = async () => {
    if (actionsUnavailable) return;
    const remaining = new Set(selected);
    if (!remaining.size) return;
    await optionsAction.runWithOptions({ name: `Add ${remaining.size} selected artists`, bulk: true }, async (options, isCurrent) => {
      setBulkAdding(true); let added = 0;
      try {
        for (const rec of remaining) {
          if (!isCurrent()) return;
          const mbid = canonicalArtistMbid(rec.mbid);
          if (!mbid) continue; // ponytail: unknown recommendations require an individual explicit identity choice.
          const { data, error } = await api.post<{ success?: boolean }>('/api/discover/add', { artistName: rec.name, ...options, mbid });
          if (!isCurrent()) return;
          if (error || data?.success !== true) continue;
          remaining.delete(rec); added++; patchConfirmed(rec);
        }
        if (added) addToast({ type: 'success', title: `Added ${added} artists to Lidarr` });
        if (remaining.size) throw new Error(`${remaining.size} additions failed. Identify unknown artists individually or confirm again to retry failures.`);
      } finally { if (isCurrent()) setBulkAdding(false); }
    });
  };
  function setSeeds(values: string[]) {
    const next = new URLSearchParams(params.toString()); next.delete('seed');
    for (const value of [...new Set(values)].slice(0, MAX_SEEDS)) next.append('seed', value);
    // Retain owned library names before changing the URL/page.
    const names = Object.fromEntries([...Object.entries(storedSeeds.actor === actor ? storedSeeds.names : {}).filter(([id]) => !values.includes(id)), ...values.filter(id => canonicalArtistMbid(id) && seedNames[id]).slice(0, MAX_SEEDS).map(id => [id, seedNames[id]])].slice(-MAX_SAVED_SEEDS));
    setStoredSeeds({ actor, names });
    if (actor !== null) try { sessionStorage.setItem(`mixarr:discovery-seeds:${actor}`, JSON.stringify(names)); } catch { /* optional tab memory */ }
    router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  }

  if (!lidarrLoading && !hasLidarr) return <div className="space-y-4"><PageHeader title="Discover" description="Find similar artists from your library" /><p>Connect Lidarr to choose library seeds.</p><Button onClick={() => router.push('/connections')}>Add Lidarr connection</Button></div>;
  return <div className="space-y-6">
    <PageHeader title="Discover" description="Choose library seeds, then explore similar artists" />
    <section aria-labelledby="seed-heading" className="space-y-3">
      <h2 id="seed-heading" className="text-lg font-semibold">Seed artists</h2>
      <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); router.push(`${pathname}${updateQuery(new URLSearchParams(params.toString()), { q: search.slice(0, 500), page: null })}`, { scroll: false }); }}>
        <Input aria-label="Search library seeds" value={search} onChange={event => setSearch(event.target.value)} className="min-w-0 flex-1" />
        <Button type="submit" variant="outline">Search library</Button>
      </form>
      <p className="text-sm text-muted-foreground">Choose up to {MAX_SEEDS} artists. Recommendations use Last.fm artist names from your library.</p>
      {seedValues.length > 0 && <ul aria-label="Selected seeds" className="flex flex-wrap gap-2">{seedValues.map(value => <li key={value} className="flex min-w-0 items-center gap-2 border px-2 py-1 text-sm"><span className="break-all">{seedNames[value] || (canonicalArtistMbid(value) ? `Unresolved seed ID: ${value}. Find this artist in your library.` : `Unresolved saved seed: ${value}. Choose a library identity.`)}</span><Button size="sm" variant="ghost" aria-label={`Remove seed ${seedNames[value] || value}`} onClick={() => setSeeds(seedValues.filter(id => id !== value))}>Remove</Button></li>)}</ul>}
      {loadingLibrary && <p role="status">Loading library seeds…</p>}
      {libraryError && <div role="alert"><p>Library seeds unavailable: {libraryError.message}</p><Button variant="outline" onClick={() => void retryLibrary()}>Retry library</Button></div>}
      <div className="divide-y border-y">{(library?.artists ?? []).map(artist => {
        const id = canonicalArtistMbid(artist.foreignArtistId);
        return <article key={artist.id} className="flex items-center gap-3 py-2"><label className="flex h-11 w-11 shrink-0 items-center justify-center"><input type="checkbox" aria-label={`Use ${artist.name} as seed`} checked={!!id && seedIds.includes(id)} disabled={!id || (!seedIds.includes(id) && seedValues.length >= MAX_SEEDS)} onChange={() => { if (id) setSeeds(seedIds.includes(id) ? seedValues.filter(value => value !== id) : [...seedValues, id]); }} /></label><div className="min-w-0 flex-1"><ArtistLink mbid={id} onOpen={context.remember}>{artist.name}</ArtistLink>{!id && <p className="text-xs text-muted-foreground">Unresolved library identity</p>}</div></article>;
      })}</div>
      {!loadingLibrary && !libraryError && !library?.artists.length && <p>No library artists match this search.</p>}
      {(library?.pagination.totalPages ?? 1) > 1 && <nav aria-label="Library seed pages" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page === 1} onClick={() => router.push(`${pathname}${updateQuery(new URLSearchParams(params.toString()), { page: String(page - 1) })}`, { scroll: false })}>Previous seeds</Button><span className="font-mono text-sm">Page {page} of {library?.pagination.totalPages}</span><Button variant="outline" disabled={page >= (library?.pagination.totalPages ?? 1)} onClick={() => router.push(`${pathname}${updateQuery(new URLSearchParams(params.toString()), { page: String(page + 1) })}`, { scroll: false })}>Next seeds</Button></nav>}
    </section>
    <section aria-labelledby="recommendation-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="recommendation-heading" className="text-lg font-semibold">Recommendations</h2><Button variant="outline" disabled={!allResolved || loadingRecommendations} onClick={() => void retryRecommendations()}>Find similar artists</Button></div>
      {seedValues.length === 0 && <p>Choose seed artists from your library to find recommendations.</p>}
      {seedValues.length > 0 && !allResolved && <p>Resolve saved seeds by choosing their library identities before finding recommendations.</p>}
      {loadingRecommendations && <p role="status">Finding similar artists…</p>}
      {showingPrevious && <p role="status">Previous recommendations for {displayData?.seedArtists.join(', ')}. {providerFailed ? 'Current seed request failed; retry to refresh.' : !allResolved ? 'Resolve current seeds to refresh.' : 'Waiting for the current seed request.'}</p>}
      {providerFailed && <div role="alert"><p>Last.fm recommendations are unavailable. {recommendationError?.message}</p><Button variant="outline" onClick={() => void retryRecommendations()}>Retry recommendations</Button></div>}
      {allResolved && !providerFailed && failedSeeds.length > 0 && <p role="status">Partial recommendations: Last.fm was unavailable for {failedSeeds.join(', ')}.</p>}
      {allResolved && recsData && !loadingRecommendations && !providerFailed && !recommendations.length && <p>No new matches for these seed artists.</p>}
      {!!recommendations.length && <Button variant="outline" disabled={actionsUnavailable} onClick={() => context.setSelected(new Set(recommendations.filter(rec => !rec.inLibrary).map(rowKey)))}>Select loaded recommendations</Button>}
      <div className="divide-y border-y">{recommendations.map(rec => {
        const key = rowKey(rec);
        return <article key={key} className="flex flex-wrap items-center gap-3 py-3">
          {!rec.inLibrary && <label className="flex h-11 w-11 shrink-0 items-center justify-center"><input type="checkbox" aria-label={`Select ${rec.name}`} disabled={actionsUnavailable} checked={context.selected.has(key)} onChange={() => context.setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next; })} /></label>}
          <ArtistLink mbid={rec.mbid} onOpen={context.remember} aria-label={`Inspect artist ${rec.name}`}><span className="flex h-10 w-10 items-center justify-center bg-muted">{rec.imageUrl ? <img src={rec.imageUrl} alt="" className="h-full w-full object-cover" /> : <Music2 className="h-5 w-5" />}</span></ArtistLink>
          <div className="min-w-0 flex-1"><ArtistLink mbid={rec.mbid} onOpen={context.remember} onIdentify={actionsUnavailable ? undefined : () => void addArtist(rec)}>{rec.name}</ArtistLink><p className="text-xs text-muted-foreground">Similar to: {rec.matchedFrom.join(', ')} · <span className="font-mono">{rec.matchCount}</span> {rec.matchCount === 1 ? 'match' : 'matches'}</p>{rec.genres?.length ? <GenrePills genres={rec.genres} maxDisplay={3} size="sm" /> : null}</div>
          <div className="flex flex-wrap gap-2">{rec.inLibrary ? <span className="text-sm">In Lidarr</span> : <><Button size="sm" aria-label={`Add artist ${rec.name}`} disabled={actionsUnavailable || adding === key || bulkAdding} onClick={() => void addArtist(rec)}>{adding === key ? 'Adding…' : 'Add artist'}</Button><Button size="sm" variant="outline" disabled={actionsUnavailable} onClick={() => setSoulseekArtist({ name: rec.name, image: rec.imageUrl })}>Search Soulseek</Button></>}</div>
        </article>;
      })}</div>
      <BulkToolbar selectedCount={selected.length} scopeLabel={showingPrevious ? 'Previous seed recommendations' : 'Loaded recommendations'} pending={bulkAdding} actions={[{ label: 'Add selected artists', disabled: actionsUnavailable, onClick: () => void bulkAdd() }]} onClear={() => context.setSelected(new Set())} />
    </section>
    {soulseekArtist && <SlskdSearchModal isOpen artistName={soulseekArtist.name} artistImage={soulseekArtist.image} onClose={() => setSoulseekArtist(null)} />}
    {optionsAction.dialog}
  </div>;
}
