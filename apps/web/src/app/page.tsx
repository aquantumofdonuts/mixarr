'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/layout/page-header';
import { DashboardTiles } from '@/components/feed/DashboardTiles';
import { FeedGrid } from '@/components/feed/FeedGrid';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useListContext } from '@/hooks/useListContext';
import { updateQuery } from '@/lib/list-state';
import { useFeed, useApproveFeedItem, useDismissFeedItem, useRestoreDecision, type FeedItem } from '@/lib/hooks';

export default function Home() {
  const { addToast } = useToast();
  const params = useSearchParams(), pathname = usePathname(), router = useRouter();
  const view = params.get('view') === 'artwork' ? 'artwork' : 'list';
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error, refetch } = useFeed();
  const { remember } = useListContext({ ready: !!data && !isLoading });
  const approveMutation = useApproveFeedItem(), dismissMutation = useDismissFeedItem(), restoreMutation = useRestoreDecision('feed');
  // ponytail: session-only recent outcomes keep feedback visible without changing server offsets.
  const [recent, setRecent] = useState<FeedItem[]>([]);
  const [loadingIds, setLoadingIds] = useState(new Set<string>());
  const pending = useRef(new Set<string>());
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const items = useMemo(() => {
    const rows = new Map((data?.pages.flatMap(page => page.items) ?? []).map(item => [item.id, item]));
    for (const item of recent) rows.set(item.id, { ...rows.get(item.id), ...item });
    return [...rows.values()];
  }, [data, recent]);
  const truncation = data?.pages[0]?.truncation;
  function keep(item: FeedItem) {
    if (live.current) setRecent(previous => [...previous.filter(row => row.id !== item.id), item].slice(-20));
  }
  function begin(id: string) {
    if (pending.current.has(id)) return false;
    pending.current.add(id); setLoadingIds(new Set(pending.current)); return true;
  }
  function finish(id: string) {
    pending.current.delete(id);
    if (live.current) setLoadingIds(new Set(pending.current));
  }
  async function handleApprove(id: string) {
    const item = items.find(row => row.id === id);
    if (!item || !begin(id)) return;
    keep({ ...item, status: 'adding', acquisitionState: 'adding', acquisitionMessage: 'Waiting for Lidarr confirmation…' });
    try {
      const result = await approveMutation.mutateAsync(id);
      if (!live.current) return;
      const confirmed = result.outcome.state === 'added' || result.outcome.state === 'already-in-library';
      keep({ ...item, status: confirmed ? 'added' : 'failed', acquisitionState: result.outcome.state, acquisitionMessage: result.outcome.message });
      addToast({ type: confirmed ? 'success' : 'error', title: result.outcome.state === 'already-in-library' ? 'Already in Lidarr' : confirmed ? 'Added to Lidarr' : 'Addition unconfirmed', message: result.outcome.message });
    } catch (failure) {
      if (!live.current) return;
      const error = failure as Error & { code?: string };
      const state = error.code === 'IDENTITY_REQUIRED' ? 'identity-required' : error.code === 'CONNECTION_REQUIRED' ? 'connection-required' : error.code === 'IN_PROGRESS' ? 'adding' : 'uncertain';
      if (state === 'adding') setRecent(previous => previous.filter(row => row.id !== id));
      else keep({ ...item, status: 'failed', acquisitionState: state, acquisitionMessage: error.message });
      addToast({ type: 'error', title: 'Addition unconfirmed', message: error.message });
    } finally { finish(id); }
  }
  async function handleDismiss(id: string) {
    const item = items.find(row => row.id === id);
    if (!item || !begin(id)) return;
    try {
      const result = await dismissMutation.mutateAsync(id);
      if (!live.current) return;
      setRecent(previous => previous.filter(row => row.id !== id));
      const expires = Math.min(Date.now() + 10_000, Date.parse(result.undoExpiresAt));
      let used = false, restoring = false;
      async function undo() {
        if (used || restoring || !live.current) return;
        if (!Number.isFinite(expires) || Date.now() >= expires) {
          used = true; addToast({ type: 'info', title: 'Undo expired', message: 'The dismissal remains saved.' }); return;
        }
        restoring = true;
        try {
          await restoreMutation.mutateAsync(result.undoToken);
          used = true;
          if (!live.current) return;
          addToast({ type: 'info', title: 'Restored', message: `${item!.artistName} returned to discovery` });
        } catch (failure) {
          if (!live.current) return;
          const remaining = expires - Date.now();
          addToast({ type: 'error', title: 'Undo failed', message: (failure as Error).message,
            ...(remaining > 0 ? { duration: remaining, action: { label: 'Retry Undo', onClick: undo } } : {}) });
        } finally { restoring = false; }
      }
      addToast({ type: 'info', title: 'Dismissed', message: `${result.artistName} removed from discovery`, duration: Math.max(0, expires - Date.now()),
        ...(Number.isFinite(expires) && expires > Date.now() ? { action: { label: 'Undo', onClick: undo } } : {}) });
    } catch (failure) {
      if (live.current) addToast({ type: 'error', title: 'Failed to dismiss', message: (failure as Error).message });
    } finally { finish(id); }
  }
  function handleLoadMore() {
    if (!isFetchingNextPage && hasNextPage && !error) void fetchNextPage();
  }
  function changeView(next: 'list' | 'artwork') {
    router.replace(`${pathname}${updateQuery(new URLSearchParams(params.toString()), { view: next })}`, { scroll: false });
  }
  return <>
    <PageHeader title="Discovery" description="Review artists found through your sources">
      <div role="group" aria-label="Discovery view" className="flex gap-1">
        <Button variant="outline" aria-pressed={view === 'list'} onClick={() => changeView('list')}>List</Button>
        <Button variant="outline" aria-pressed={view === 'artwork'} onClick={() => changeView('artwork')}>Artwork</Button>
      </div>
    </PageHeader>
    <DashboardTiles />
    {error && <div role="alert" className="mb-4 border p-3 text-sm"><p>{items.length ? 'Some discoveries are unavailable. Existing discoveries remain visible.' : 'Discovery is unavailable. Please try again.'}</p><Button variant="outline" className="mt-2" onClick={() => void refetch()}>Retry discovery</Button></div>}
    {truncation?.aggregationTruncated && <p role="status" className="mb-3 text-sm text-muted-foreground">Showing a capped discovery sample from <span className="font-mono">{truncation.totalBeforeAggregationCap}</span> eligible source records. More records may contain additional artists.</p>}
    {(!error || items.length > 0) && <FeedGrid items={items} onApprove={handleApprove} onDismiss={handleDismiss} onLoadMore={handleLoadMore}
      hasMore={!!hasNextPage && !error} isLoading={isLoading || isFetchingNextPage} loadingIds={loadingIds} view={view} onOpen={remember} />}
  </>;
}
