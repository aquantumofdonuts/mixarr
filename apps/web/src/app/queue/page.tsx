'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAddArtistOptions, type ArtistAddOptions } from '@/components/artists/AddArtistOptions';
import { ArtistLink, canonicalArtistMbid } from '@/components/artists/ArtistLink';
import { Button } from '@/components/ui/button';
import { BulkToolbar } from '@/components/ui/bulk-toolbar';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { SlskdSearchModal } from '@/components/slskd/SearchModal';
import { useAuth } from '@/lib/auth';
import { updateQuery, retainSelection } from '@/lib/list-state';
import { useListContext } from '@/hooks/useListContext';
import { ReviewAcquisitionError, useReviewQueue, useUpdateReviewItem, useBulkUpdateReview, useRestoreDecision, type ReviewItem, type ReviewAcquisitionOutcome, type ReviewAcquisitionResponse } from '@/lib/hooks';
import Music2 from 'lucide-react/dist/esm/icons/music-2';

type Status = 'pending' | 'approved' | 'rejected';
type QueueData = { items: ReviewItem[]; total: number; nextCursor: string | null };
const confirmed = (outcome: ReviewAcquisitionOutcome) => outcome.state === 'added' || outcome.state === 'already-in-library';

export default function QueuePage() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const { user } = useAuth(), { addToast, isCurrent: notificationIsCurrent } = useToast();
  const actor = `${user?.id}:${user?.role}`;
  const actorOwner = useRef({ actor });
  if (actorOwner.current.actor !== actor) actorOwner.current = { actor };
  const status: Status = ['pending', 'approved', 'rejected'].includes(params.get('status') || '') ? params.get('status') as Status : 'pending';
  const itemType = ['artist', 'album'].includes(params.get('itemType') || '') ? params.get('itemType') as 'artist' | 'album' : undefined;
  const q = (params.get('q') || '').slice(0, 120).trim();
  const rawCursor = params.get('cursor'), cursor = rawCursor && rawCursor.length <= 1024 && /^[\w-]+$/.test(rawCursor) ? rawCursor : null;
  const scope = `${actor}:${status}:${itemType || ''}:${q}`, generation = `${scope}:${cursor || ''}`;
  const owner = useRef({ generation });
  if (owner.current.generation !== generation) owner.current = { generation };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = (captured: typeof owner.current) => mounted.current && owner.current === captured;
  // ponytail: keep only cursors this mounted page actually visited; direct links have no invented Previous page.
  const history = useRef<{ scope: string; cursors: Array<string | null> }>({ scope, cursors: [cursor] });
  if (history.current.scope !== scope) history.current = { scope, cursors: [cursor] };
  if (!history.current.cursors.includes(cursor)) history.current.cursors = [cursor];
  const index = history.current.cursors.indexOf(cursor);
  const previous = index > 0 ? history.current.cursors[index - 1] : undefined;
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q, generation]);
  const queryString = params.toString();
  useEffect(() => {
    if (search.slice(0, 120).trim() === q) return;
    const timer = setTimeout(() => router.replace(`${pathname}${updateQuery(new URLSearchParams(queryString), { q: search.slice(0, 120).trim(), cursor: null })}`, { scroll: false }), 300);
    return () => clearTimeout(timer);
  }, [search, q, queryString, pathname, router, actor]);
  const queue = useReviewQueue(status, itemType, { q, cursor, limit: 50 });
  const lastSuccess = useRef<{ actor: string; generation: string; data: QueueData } | null>(null);
  if (lastSuccess.current?.actor !== actor) lastSuccess.current = null;
  if (queue.data && !queue.error) lastSuccess.current = { actor, generation, data: queue.data };
  const data = queue.data || lastSuccess.current?.data;
  const showingPrevious = !!data && (!queue.data || lastSuccess.current?.generation !== generation);
  const unavailable = showingPrevious || queue.isFetching || !!queue.error;
  const items = data?.items || [];
  const context = useListContext({ ready: !queue.isFetching, retainSelectionOnScopeChange: true });
  const { setSelected } = context;
  useEffect(() => {
    if (!queue.data || unavailable) return;
    setSelected(old => retainSelection(old, new Set(queue.data.items.filter(item => item.status === 'pending' && item.userId === user?.id).map(item => String(item.id)))));
  }, [queue.data, unavailable, user?.id, setSelected]);
  function navigate(changes: Record<string, string | null>, replace = false) {
    const url = `${pathname}${updateQuery(new URLSearchParams(params.toString()), changes)}`;
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }
  useEffect(() => {
    if (!cursor || !queue.data || queue.data.items.length || queue.isFetching || queue.error) return;
    router.replace(`${pathname}${updateQuery(new URLSearchParams(queryString), { cursor: previous ?? null })}`, { scroll: false });
  }, [cursor, queue.data, queue.isFetching, queue.error, previous, pathname, queryString, router]);
  const optionsAction = useAddArtistOptions(generation);
  const update = useUpdateReviewItem(), bulk = useBulkUpdateReview(), restore = useRestoreDecision('review');
  const [processing, setProcessing] = useState(false);
  const [recent, setRecent] = useState<{ owner: typeof actorOwner.current; rows: Array<ReviewAcquisitionOutcome & { name: string }> }>({ owner: actorOwner.current, rows: [] });
  const [soulseek, setSoulseek] = useState<{ name: string; image?: string } | null>(null);
  useEffect(() => { setProcessing(false); setSoulseek(null); }, [generation]);
  const eligible = items.filter(item => item.userId === user?.id && item.status === 'pending');
  const selected = eligible.filter(item => context.selected.has(String(item.id)));
  const busy = unavailable || processing;
  const latestQueue = useRef({ items: queue.data?.items, unavailable });
  latestQueue.current = { items: queue.data?.items, unavailable };
  function recordOutcomes(outcomes: ReviewAcquisitionOutcome[], requested: ReviewItem[]) {
    const submitted = new Map(requested.map(item => [item.id, item]));
    const actual = outcomes.filter(outcome => submitted.has(outcome.id));
    setRecent(old => ({ owner: actorOwner.current, rows: [...(old.owner === actorOwner.current ? old.rows.filter(row => !actual.some(outcome => outcome.id === row.id)) : []), ...actual.map(outcome => ({ ...outcome, name: submitted.get(outcome.id)!.artistName }))].slice(-100) }));
    const successes = new Set(actual.filter(confirmed).map(outcome => String(outcome.id)));
    setSelected(old => new Set([...old].filter(id => !successes.has(id))));
    return actual;
  }
  function offerUndo(response: ReviewAcquisitionResponse | null | undefined) {
    const capturedActor = actorOwner.current;
    const actorIsCurrent = () => notificationIsCurrent() && actorOwner.current === capturedActor;
    if (!response?.undoToken || !response.undoExpiresAt) return;
    const expires = Math.min(Date.now() + 10_000, Date.parse(response.undoExpiresAt));
    let pending = false, used = false;
    const undo = async () => {
      if (!actorIsCurrent() || pending || used || Date.now() >= expires) return;
      pending = true;
      try {
        await restore.mutateAsync(response.undoToken!);
        used = true;
        if (actorIsCurrent()) addToast({ type: 'info', title: 'Rejection restored' });
      } catch (error) {
        if (actorIsCurrent()) addToast({ type: 'error', title: 'Could not restore rejection', message: error instanceof Error ? error.message : 'Restoration failed', duration: Math.max(1, expires - Date.now()), ...(Date.now() < expires ? { action: { label: 'Retry Undo', onClick: () => void undo() } } : {}) });
      } finally { pending = false; }
    };
    addToast({ type: 'info', title: 'Review items rejected', duration: Math.max(1, expires - Date.now()), action: { label: 'Undo', onClick: () => void undo() } });
  }
  async function reject(requested: ReviewItem[]) {
    if (busy || !requested.length) return;
    const captured = owner.current; setProcessing(true);
    try {
      const response = requested.length === 1 ? await update.mutateAsync({ id: requested[0].id, status: 'rejected' }) : await bulk.mutateAsync({ ids: requested.map(item => item.id), status: 'rejected' });
      if (!current(captured)) return;
      const ids = new Set(requested.map(item => String(item.id)));
      setSelected(old => new Set([...old].filter(id => !ids.has(id))));
      offerUndo(response);
    } catch (error) { if (current(captured)) addToast({ type: 'error', title: 'Rejection failed', message: error instanceof Error ? error.message : 'Retry the rejection' }); }
    finally { if (current(captured)) setProcessing(false); }
  }
  async function acquire(requested: ReviewItem[], multiple = false) {
    if (busy || !requested.length) return;
    if (multiple && requested.some(item => !canonicalArtistMbid(item.mbid))) { addToast({ type: 'error', title: 'Identify each selected artist with its individual Add action before adding the selection' }); return; }
    const remaining = new Map(requested.map(item => [item.id, item]));
    await optionsAction.runWithOptions({ name: multiple ? `Add ${requested.length} selected review items` : requested[0].artistName, mbid: multiple ? undefined : requested[0].mbid, bulk: multiple, album: requested.every(item => item.itemType === 'album'), mixed: requested.some(item => item.itemType === 'album') && requested.some(item => item.itemType === 'artist') }, async (options: ArtistAddOptions, isCurrent) => {
      if (latestQueue.current.unavailable || !latestQueue.current.items) throw new Error('Wait for the current queue to refresh before retrying.');
      const pendingIds = new Set(latestQueue.current.items.filter(item => item.userId === user?.id && item.status === 'pending').map(item => item.id));
      for (const id of remaining.keys()) if (!pendingIds.has(id)) remaining.delete(id);
      if (!remaining.size) throw new Error('These records are no longer pending. Check their artist details to verify collection membership.');
      const submitted = [...remaining.values()];
      const captured = owner.current; setProcessing(true);
      const active = () => current(captured) && isCurrent();
      let outcomes: ReviewAcquisitionOutcome[] = [];
      try {
        const response = multiple ? await bulk.mutateAsync({ ids: [...remaining.keys()], status: 'approved', options }) : await update.mutateAsync({ id: requested[0].id, status: 'approved', options });
        outcomes = response?.outcomes || [];
      } catch (error) {
        if (!active()) return;
        if (error instanceof ReviewAcquisitionError) outcomes = error.outcomes;
        // A lost response cannot establish whether the provider mutation happened.
        if (!outcomes.length) outcomes = submitted.map(item => ({ id: item.id, state: 'uncertain', message: 'The response did not confirm acquisition. Check the library or refresh before retrying.' }));
      } finally { if (active()) setProcessing(false); }
      if (!active()) return;
      const reported = new Set(outcomes.map(outcome => outcome.id));
      const actual = recordOutcomes([...outcomes, ...submitted.filter(item => !reported.has(item.id)).map(item => ({ id: item.id, state: 'uncertain' as const, message: 'No acquisition outcome was returned. Check the library before retrying.' }))], submitted);
      actual.filter(confirmed).forEach(outcome => remaining.delete(outcome.id));
      if (remaining.size) throw new Error(`${remaining.size} review additions need attention. Confirm again to retry only these items; uncertain results check membership first.`);
    });
  }
  return <div className="space-y-4">
    <PageHeader title="Review Queue" description="Review imports and add chosen artists or albums to Lidarr" />
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 w-full text-sm sm:w-auto sm:flex-1">Search the complete queue<Input aria-label="Search review queue" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="text-sm">Review status<select aria-label="Review status" value={status} className="block min-h-11 border bg-background px-2" onChange={event => { setSearch(q); navigate({ status: event.target.value, cursor: null }); }}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
      <label className="text-sm">Item type<select aria-label="Review item type" value={itemType || ''} className="block min-h-11 border bg-background px-2" onChange={event => { setSearch(q); navigate({ itemType: event.target.value || null, cursor: null }); }}><option value="">All items</option><option value="artist">Artists</option><option value="album">Albums</option></select></label>
    </div>
    {data ? <p className="text-sm"><span className="font-mono">{data.total}</span> matching review items · <span className="font-mono">{items.length}</span> on this page</p> : <p className="text-sm">Matching review count is {queue.error ? 'unavailable' : 'loading'}.</p>}
    {queue.isFetching && <p role="status">Loading review queue…</p>}
    {showingPrevious && <p role="status">Previous queue results. Actions are unavailable until the current page loads.</p>}
    {queue.error && <div role="alert"><p>Review queue unavailable: {queue.error.message}</p><Button variant="outline" onClick={() => void queue.refetch()}>Retry queue</Button></div>}
    {queue.data && !queue.isFetching && !queue.error && !items.length && <div className="space-y-2">{q || itemType ? <><p>No review items match your search or item type.</p><Button variant="outline" onClick={() => { setSearch(''); navigate({ q: null, itemType: null, cursor: null }); }}>Clear queue filters</Button></> : <><p>No {status} review items.</p>{status === 'pending' ? <p className="text-sm text-muted-foreground">Review items appear when subscriptions use queue result handling. <Link href="/subscriptions" prefetch={false} className="text-link underline">Review subscriptions</Link></p> : <Button variant="outline" onClick={() => navigate({ status: 'pending', cursor: null })}>View pending items</Button>}</>}</div>}
    <section aria-label="Review items" className="divide-y border-y">
      {status === 'pending' && eligible.length > 0 && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" aria-label="Select loaded page" disabled={busy} checked={eligible.every(item => context.selected.has(String(item.id)))} onChange={event => setSelected(event.target.checked ? new Set(eligible.map(item => String(item.id))) : new Set())} />Select loaded page · your pending items only</label>}
      {items.map(item => <article key={item.id} aria-label={`Review item ${item.id}`} className="flex flex-wrap items-center gap-3 py-3">
        {item.status === 'pending' && <label className="flex h-11 w-11 shrink-0 items-center justify-center"><input type="checkbox" aria-label={`Select review item ${item.id}`} checked={context.selected.has(String(item.id))} disabled={busy || item.userId !== user?.id} onChange={event => setSelected(old => { const next = new Set(old); if (event.target.checked) next.add(String(item.id)); else next.delete(String(item.id)); return next; })} /></label>}
        <div className="h-10 w-10 shrink-0 bg-muted">{item.imageUrl ? <img src={item.imageUrl} alt="" className="h-full w-full object-cover" /> : <Music2 aria-hidden="true" className="m-2 h-6 w-6 text-muted-foreground" />}</div>
        <div className="min-w-0 flex-1 basis-32"><ArtistLink mbid={canonicalArtistMbid(item.mbid)} onOpen={context.remember}>{item.artistName}</ArtistLink>{item.albumName && <p className="break-words text-sm">{item.albumName}</p>}<p className="break-words text-xs text-muted-foreground">{item.source} · {item.itemType} · {new Date(item.createdAt).toLocaleDateString()}{user?.role === 'admin' && ` · Owner: ${item.user?.displayName || item.user?.username || item.userId}`}</p><p className="font-mono text-xs">Review decision: {item.status} · #{item.id}</p>{item.userId !== user?.id && <p className="text-xs text-muted-foreground">Only the owner can act on this item.</p>}</div>
        {item.status === 'pending' && <div className="flex w-full flex-wrap gap-2 sm:w-auto"><Button size="sm" variant="outline" disabled={busy || item.userId !== user?.id} onClick={() => setSoulseek({ name: item.artistName, image: item.imageUrl })}>Search Soulseek</Button><Button size="sm" variant="outline" disabled={busy || item.userId !== user?.id} onClick={() => void acquire([item])}>Add {item.itemType}</Button><Button size="sm" variant="outline" disabled={busy || item.userId !== user?.id} onClick={() => void reject([item])}>Reject</Button></div>}
      </article>)}
    </section>
    <nav aria-label="Review queue pages" className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={previous === undefined || queue.isFetching} onClick={() => navigate({ cursor: previous ?? null })}>Previous page</Button><Button variant="outline" disabled={!queue.data?.nextCursor || unavailable} onClick={() => {
      const next = queue.data!.nextCursor!;
      history.current.cursors = [...history.current.cursors.slice(0, index < 0 ? 1 : index + 1), next].slice(-100);
      navigate({ cursor: next });
    }}>Next page</Button>{cursor && <Button variant="ghost" onClick={() => navigate({ cursor: null })}>Back to first page</Button>}</nav>
    {recent.owner === actorOwner.current && recent.rows.length > 0 && <section aria-label="Recent acquisition outcomes" className="space-y-2"><h2 className="font-semibold">Recent acquisition outcomes</h2><p className="text-xs text-muted-foreground">Results for submitted records. Review decisions alone do not establish collection membership.</p>{recent.rows.map(row => <p key={row.id} className="break-words text-sm"><span className="font-mono">#{row.id}</span> {row.name} · <span className={confirmed(row) ? 'text-status-success' : 'text-status-warning'}>{row.state === 'added' ? 'Added to Lidarr' : row.state === 'already-in-library' ? 'Already in Lidarr' : row.state === 'identity-required' ? 'Identity required' : row.state === 'uncertain' ? 'Outcome uncertain' : 'Addition failed'}</span> · {row.message}</p>)}</section>}
    <BulkToolbar selectedCount={selected.length} scopeLabel="Loaded page · your pending review items" pending={busy} onClear={() => setSelected(new Set())} actions={[{ label: 'Add selected items', onClick: () => void acquire(selected, true) }, { label: 'Reject selected items', onClick: () => void reject(selected) }]} />
    {optionsAction.dialog}
    {soulseek && <SlskdSearchModal isOpen artistName={soulseek.name} artistImage={soulseek.image} onClose={() => setSoulseek(null)} />}
  </div>;
}
