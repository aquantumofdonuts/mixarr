'use client';

import { useAddArtistOptions, type ArtistAddOptions } from '@/components/artists/AddArtistOptions';
import { useEffect, useRef, useState } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, Tab, TabPanel, Skeleton } from '@/components/ui';
import { ResultState } from '@/components/ui/result-state';
import { useToast } from '@/components/ui/toast';
import { PageHeader } from '@/components/layout/page-header';
import { ArtistLink, canonicalArtistMbid } from '@/components/artists/ArtistLink';
import { useListContext } from '@/hooks/useListContext';
import { readPage, updateQuery } from '@/lib/list-state';
import { api } from '@/lib/api';
import { useSubscriptionDetail, useSubscriptionRuns, useSubscriptionResults, useSubscriptionRunDetails, useApproveResult, useRejectResult, RESULTS_PAGE_SIZE, type SubscriptionResult } from '@/lib/hooks';

const statuses = ['pending', 'queued', 'adding', 'added', 'skipped', 'failed', 'rejected'];
function positiveId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export default function SubscriptionDetailPage() {
  const params = useParams();
  const id = positiveId(typeof params.id === 'string' ? params.id : null);
  return id ? <SubscriptionDetail key={id} subscriptionId={id} /> : <ResultState kind="error" message="Invalid subscription ID" />;
}

function SubscriptionDetail({ subscriptionId }: { subscriptionId: number }) {
  const pathname = usePathname(), params = useSearchParams(), router = useRouter();
  const { addToast } = useToast();
  const tab = params.get('tab') === 'results' ? 'results' : 'runs';
  const status = statuses.includes(params.get('status') || '') ? params.get('status')! : '';
  const page = readPage(params.get('page')) - 1;
  const runId = positiveId(params.get('run'));
  const subscription = useSubscriptionDetail(subscriptionId);
  const runs = useSubscriptionRuns(subscriptionId);
  const results = useSubscriptionResults(subscriptionId, status, page);
  const runDetails = useSubscriptionRunDetails(subscriptionId, tab === 'runs' ? runId : null);
  const approve = useApproveResult(subscriptionId), reject = useRejectResult(subscriptionId);
  const context = useListContext({ ready: !!subscription.data && (tab === 'results' ? !!results.data && !results.isPlaceholderData : !!runs.data && (!runId || !!runDetails.data)), selectionOwner: false });
  const [pending, setPending] = useState<Set<number>>(new Set());
  const pendingRef = useRef(new Set<number>());
  const [messages, setMessages] = useState<Record<number, string>>({});
  const lookup = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const scope = `${pathname}${updateQuery(new URLSearchParams(params.toString()), { artist: null })}`;
  const optionsAction = useAddArtistOptions(scope);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (tab !== 'results' || !results.isSuccess || results.isPlaceholderData || !results.data) return;
    const lastPage = Math.max(1, Math.ceil(results.data.total / RESULTS_PAGE_SIZE));
    if (page + 1 > lastPage) router.replace(`${pathname}${updateQuery(new URLSearchParams(params.toString()), { page: lastPage > 1 ? String(lastPage) : null })}`, { scroll: false });
  }, [tab, page, results.isSuccess, results.isPlaceholderData, results.data, router, pathname, params]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; lookup.current?.abort(); };
  }, []);
  useEffect(() => { lookup.current?.abort(); }, [scope]);
  function navigate(patch: Record<string, string | null>, replace = false) {
    const method = replace ? router.replace : router.push;
    method(`${pathname}${updateQuery(new URLSearchParams(params.toString()), patch)}`, { scroll: false });
  }
  function markPending(id: number, value: boolean) {
    if (value) pendingRef.current.add(id); else pendingRef.current.delete(id);
    if (mounted.current) setPending(new Set(pendingRef.current));
  }
  async function actOnResult(result: SubscriptionResult, action: 'approve' | 'reject', mbid?: string, options?: ArtistAddOptions, isCurrent = () => true) {
    if (pendingRef.current.has(result.id)) return;
    const actionScope = scope;
    markPending(result.id, true);
    try {
      const response = action === 'approve' ? await approve.mutateAsync(options ? { resultId: result.id, mbid, options } : mbid ? { resultId: result.id, mbid } : result.id) : await reject.mutateAsync(result.id);
      if (isCurrent() && mounted.current && scopeRef.current === actionScope) {
        const message = action === 'reject' ? 'Result rejected' : response?.outcome === 'already-in-library' ? 'Artist already in Lidarr' : 'Artist added to Lidarr';
        setMessages(previous => ({ ...previous, [result.id]: message }));
        addToast({ type: 'success', title: message });
      }
    } catch (error) {
      if (isCurrent() && mounted.current && scopeRef.current === actionScope) {
        const message = error instanceof Error ? error.message : 'Decision failed; retry';
        setMessages(previous => ({ ...previous, [result.id]: message }));
        addToast({ type: 'error', title: 'Acquisition or decision not confirmed', message });
        if (options) throw error;
      }
    } finally { markPending(result.id, false); }
  }
  async function addResult(result: SubscriptionResult) {
    const name = result.itemType === 'album' ? result.artistName || result.name : result.name;
    await optionsAction.runWithOptions({ name, mbid: result.mbid, album: result.itemType === 'album' }, (options, current) => actOnResult(result, 'approve', options.mbid, options, current));
  }
  async function runNow() {
    if (running) return;
    setRunning(true);
    const actionScope = scope;
    try {
      const { error } = await api.post(`/api/jobs/run/subscription/${subscriptionId}`);
      if (mounted.current && scopeRef.current === actionScope) addToast({ type: error ? 'error' : 'success', title: error ? 'Run could not be started' : 'Subscription run started', message: error || undefined });
    } finally { if (mounted.current) setRunning(false); }
  }
  function renderResult(result: SubscriptionResult) {
    const artistName = result.itemType === 'album' ? result.artistName || 'Unidentified artist' : result.name;
    const identity = canonicalArtistMbid(result.mbid);
    const actionable = ['pending', 'queued', 'failed'].includes(result.status);
    const checking = result.status === 'adding';
    return <article key={result.id} className="flex min-w-0 flex-wrap items-center gap-3 border-b py-3" aria-label={`Result ${result.id}`}>
      <ArtistLink mbid={identity} onOpen={context.remember} aria-label={`Inspect artist ${artistName}`} className="block h-12 w-12 shrink-0 overflow-hidden rounded bg-muted">{result.imageUrl && <img src={result.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />}</ArtistLink>
      <div className="min-w-0 flex-1 basis-40">
        <ArtistLink mbid={identity} onOpen={context.remember} className="break-words font-semibold">{artistName}</ArtistLink>
        {result.itemType === 'album' && <p className="break-words text-sm text-muted-foreground">Album: {result.name}</p>}
        <p className="text-xs text-muted-foreground">{subscription.data?.name}{result.runId && <> · <Link className="text-link hover:underline" href={`${pathname}?tab=runs&run=${result.runId}`}>Run <span className="font-mono">{result.runId}</span></Link></>}</p>
        {result.errorMessage && !messages[result.id] && <p className="break-words text-sm">{result.errorMessage.replace(/^[A-Z_]+: /, '')}</p>}
        {result.skipReason && <p className="break-words text-xs text-muted-foreground">{result.skipReason}</p>}
        {messages[result.id] && <p role="status" className="break-words text-sm">{messages[result.id]}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={result.status === 'failed' ? 'destructive' : 'secondary'}>{result.status === 'added' ? 'Record marked added' : result.status}</Badge>
        {(actionable || checking) && <>
          <Button size="sm" variant="outline" disabled={pending.has(result.id) || results.isPlaceholderData} aria-label={`${checking ? 'Check acquisition' : identity ? result.status === 'failed' ? 'Retry add artist' : 'Add artist' : 'Identify and add artist'} ${artistName}`} onClick={() => void (checking ? actOnResult(result, 'approve') : addResult(result))}>{pending.has(result.id) ? 'Working…' : checking ? 'Check acquisition' : identity ? result.status === 'failed' ? 'Retry' : 'Add artist' : 'Identify artist'}</Button>
          {actionable && <Button size="sm" variant="outline" disabled={pending.has(result.id) || results.isPlaceholderData} aria-label={`Reject result ${result.name}`} onClick={() => void actOnResult(result, 'reject')}>Reject</Button>}
        </>}
      </div>
    </article>;
  }
  function filter() {
    return <label className="flex items-center gap-2 text-sm">Result status<select aria-label="Result status" value={status} onChange={event => navigate({ status: event.target.value || null, page: null }, true)} className="min-h-11 rounded border bg-background px-2"><option value="">All statuses</option>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label>;
  }
  function runContent() {
    if (runDetails.isError) return <ResultState kind="error" message="Run results could not be loaded" action={<Button onClick={() => void runDetails.refetch()}>Retry run results</Button>} />;
    if (!runDetails.data) return <Skeleton className="h-16 w-full" />;
    const matches = runDetails.data.results.filter(result => !status || result.status === status);
    return <div className="px-3 pb-3"><div className="flex flex-wrap items-center gap-3">{filter()}<Button variant="outline" disabled={runDetails.isFetching} onClick={() => { setMessages({}); void Promise.all([runDetails.refetch(), runs.refetch()]); }}>Refresh run results</Button></div>{matches.length ? matches.map(renderResult) : <ResultState kind="no-records" message={status ? `No ${status} results found in this run` : 'This run has no results'} />}</div>;
  }
  if (subscription.isError) return <ResultState kind="error" message="Subscription could not be loaded" action={<Button onClick={() => void subscription.refetch()}>Retry subscription</Button>} />;
  if (!subscription.data) return <Skeleton className="h-24 w-full" />;
  const data = subscription.data;
  const actualPage = Math.floor((results.data?.offset || 0) / RESULTS_PAGE_SIZE) + 1;
  const pages = Math.max(1, Math.ceil((results.data?.total || 0) / RESULTS_PAGE_SIZE));
  return <>
    <nav aria-label="Breadcrumb" className="mb-3 text-sm"><Link href="/subscriptions" className="text-link hover:underline">Subscriptions</Link><span className="mx-2 text-muted-foreground">/</span>{data.name}</nav>
    <PageHeader title={data.name} description={`${data.type.replaceAll('_', ' ')} · Result handling: ${data.resultHandling}`}><Button onClick={() => void runNow()} disabled={running}>{running ? 'Starting…' : 'Run now'}</Button></PageHeader>
    <Tabs value={tab} onChange={value => navigate({ tab: value, run: null, status: null, page: null })} className="mb-4">
      <Tab value="runs" label="Run history" /><Tab value="results" label="All results" />
      <TabPanel value="runs">
        {runs.isError ? <ResultState kind="error" message="Run history could not be loaded" action={<Button onClick={() => void runs.refetch()}>Retry run history</Button>} /> : !runs.data ? <Skeleton className="h-16" /> : <>
          {!runs.data.length && !runId && <ResultState kind="no-records" message="No runs yet. Run this subscription to find results." />}
          {(runId && !runs.data.some(run => run.id === runId) ? [...runs.data, runDetails.data?.run || { id: runId, status: 'Run details', startedAt: '', resultsCount: null, addedCount: null, skippedCount: null, errorMessage: null }] : runs.data).map(run => <details key={run.id} data-run={run.id} open={runId === run.id} className="group border-b">
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-3" onClick={event => { event.preventDefault(); navigate({ run: runId === run.id ? null : String(run.id), page: null }); }}>
              <ChevronRight className="h-4 w-4 shrink-0 transition-transform duration-[140ms] group-open:rotate-90" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="font-mono text-sm">Run {run.id}</span>{run.startedAt && <span className="ml-2 text-sm">{new Date(run.startedAt).toLocaleString()}</span>}<span className="block font-mono text-xs text-muted-foreground">{run.resultsCount !== null && `${run.resultsCount} result records · ${run.addedCount} marked added · ${run.skippedCount} skipped`}{run.errorMessage}</span></span><Badge variant="secondary">{run.status}</Badge>
            </summary>
            {runId === run.id && <><Link href={`${pathname}?tab=runs&run=${run.id}`} className="ml-3 text-xs text-link hover:underline">Link to run {run.id}</Link>{runContent()}</>}
          </details>)}
        </>}
      </TabPanel>
      <TabPanel value="results">
        <div className="flex flex-wrap items-center gap-3">{filter()}<Button variant="outline" disabled={results.isFetching} onClick={() => { setMessages({}); void results.refetch(); }}>Refresh results</Button></div>
        {results.isError && <ResultState kind="error" message="Subscription results could not be loaded" action={<Button onClick={() => void results.refetch()}>Retry results</Button>} />}
        {!results.data ? !results.isError && <Skeleton className="mt-3 h-16" /> : <>
          <p role="status" className="my-3 text-sm text-muted-foreground">{results.isPlaceholderData ? `Showing page ${actualPage} while loading page ${page + 1}` : `Page ${actualPage} of ${pages} · ${results.data.total} ${status || 'total'} result records`}{results.isFetching && !results.isPlaceholderData ? ' · Updating…' : ''}</p>
          {!results.isPlaceholderData && page + 1 > pages ? <p role="status">Loading the last available page…</p> : results.data.results.length ? results.data.results.map(renderResult) : <ResultState kind="no-records" message={status ? `No ${status} results found` : 'This subscription has no results'} />}
          {(pages > 1 || page > 0) && <nav aria-label="Result pages" className="mt-4 flex flex-wrap items-center gap-3"><Button variant="outline" aria-label="Previous page" disabled={page === 0 || results.isPlaceholderData} onClick={() => navigate({ page: page > 1 ? String(page) : null })}>Previous</Button><span className="font-mono text-sm">Page {actualPage} of {pages}</span><Button variant="outline" aria-label="Next page" disabled={page + 1 >= pages || results.isPlaceholderData} onClick={() => navigate({ page: String(page + 2) })}>Next</Button></nav>}
        </>}
      </TabPanel>
    </Tabs>
    {optionsAction.dialog}
  </>;
}
