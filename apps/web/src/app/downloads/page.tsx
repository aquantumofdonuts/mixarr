'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { PageHeader } from '@/components/layout/page-header';
import { useAuth } from '@/lib/auth';
import { useSlskdDownloads, useRetrySlskdDownload, useCancelSlskdDownload, SlskdDownload } from '@/lib/hooks';

const statusOptions = ['all', 'queued_locally', 'pending', 'downloading', 'organizing', 'completed', 'failed', 'cancelled'] as const;
type StatusFilter = typeof statusOptions[number];
const label = (status: string) => status[0].toUpperCase() + status.slice(1).replaceAll('_', ' ');

function formatBytes(value: number | string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes === 0) return '0 B';
  const index = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${['B', 'KB', 'MB', 'GB'][index]}`;
}

function DownloadRow({ download }: { download: SlskdDownload }) {
  const retry = useRetrySlskdDownload();
  const cancel = useCancelSlskdDownload();
  const [confirmation, setConfirmation] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const filename = download.filename.split(/[\\/]/).filter(Boolean).pop() || download.filename;
  const active = ['queued_locally', 'pending', 'downloading', 'organizing'].includes(download.status);
  const pending = retry.isPending || cancel.isPending;
  const changeTracking = async () => {
    if (confirmation === null || pending) return;
    setError(null);
    try {
      await cancel.mutateAsync({ id: download.id, remove: confirmation });
      if (mounted.current) { setFeedback(confirmation ? 'Mixarr record removed.' : 'Tracking marked cancelled. The remote transfer may continue.'); setConfirmation(null); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not update tracking');
    }
  };
  const retryDownload = async () => {
    if (pending) return;
    setError(null);
    try { await retry.mutateAsync(download.id); if (mounted.current) setFeedback('Download queued for retry.'); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not retry download'); }
  };
  return <article aria-label={`Download ${download.id}`} className="border-b py-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <h2 className="break-words font-semibold">{download.artistName}</h2>
        <p className="break-words text-sm text-muted-foreground">{download.albumName || 'Release unknown'}{download.albumYear ? ` (${download.albumYear})` : ''}</p>
        <p className="mt-1 break-all font-mono text-xs" title={download.filename}>{filename}</p>
        <p className="mt-1 break-words text-xs text-muted-foreground">Peer: {download.username} · <span className="font-mono">{formatBytes(download.fileSize)}</span></p>
        <p className="text-xs text-muted-foreground">{new Date(download.createdAt).toLocaleString()}</p>
      </div>
      <div className="min-w-0 text-sm" role="status">
        <p className={download.status === 'completed' ? 'text-status-success' : download.status === 'failed' ? 'text-status-error' : 'font-medium'}>{label(download.status)}</p>
        {active && <p className="text-xs text-muted-foreground">Transfer percentage unavailable</p>}
      </div>
    </div>
    {download.error && <p className="mt-2 break-words text-sm text-status-error">{download.error}</p>}
    {download.finalPath && <p className="mt-2 break-all text-sm">Organized to: <span className="font-mono">{download.finalPath}</span></p>}
    <div className="mt-3 flex flex-wrap gap-2">
      {download.status === 'failed' && <Button variant="outline" onClick={retryDownload} disabled={pending}>{retry.isPending ? 'Queuing retry…' : 'Retry download'}</Button>}
      <Button variant="outline" disabled={pending} onClick={() => { setError(null); setConfirmation(!active); }}>{active ? 'Cancel tracking' : 'Remove record'}</Button>
    </div>
    {error && confirmation === null && <div role="alert" className="mt-2 break-words text-sm"><p>{error}</p></div>}
    {feedback && <p role="status" className="mt-2 break-words text-sm">{feedback}</p>}
    <Modal isOpen={confirmation !== null} onClose={() => { if (!pending) { setConfirmation(null); setError(null); } }} title={confirmation ? 'Remove download record' : 'Cancel download tracking'} size="sm">
      <p className="break-words font-semibold">{download.artistName} — {download.albumName || 'Release unknown'}</p>
      <p className="mt-1 break-all font-mono text-xs">{filename}</p>
      <p className="mt-3 text-sm">{confirmation ? 'Remove this record from Mixarr. Downloaded files are kept.' : 'Mark this download cancelled in Mixarr tracking only. The remote slskd transfer may continue.'}</p>
      {error && <p role="alert" className="mt-3 break-words text-sm text-status-error">{error}</p>}
      <ModalFooter>
        <Button variant="outline" disabled={pending} onClick={() => { setConfirmation(null); setError(null); }}>Keep record</Button>
        <Button disabled={pending} onClick={changeTracking}>{pending ? 'Saving…' : error ? 'Retry' : confirmation ? 'Remove record' : 'Mark cancelled'}</Button>
      </ModalFooter>
    </Modal>
  </article>;
}

export default function DownloadsPage() {
  const router = useRouter(), pathname = usePathname(), params = useSearchParams();
  const rawStatus = params.get('status');
  const status: StatusFilter = statusOptions.includes(rawStatus as StatusFilter) ? rawStatus as StatusFilter : 'all';
  const { user } = useAuth();
  const query = useSlskdDownloads(status === 'all' ? undefined : status);
  const downloads = query.data || [];
  const setStatus = (value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value === 'all') next.delete('status'); else next.set('status', value);
    router.push(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };
  return <>
    <PageHeader title="slskd Downloads" description="Track Soulseek downloads and recover failed transfers" />
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1 text-sm">Download status
        <select value={status} onChange={event => setStatus(event.target.value)} className="min-h-11 rounded-button border bg-background px-3">
          {statusOptions.map(option => <option key={option} value={option}>{label(option)}</option>)}
        </select>
      </label>
      <Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch({ cancelRefetch: false })}>{query.isFetching ? 'Refreshing…' : 'Refresh downloads'}</Button>
    </div>
    {query.isLoading ? <p role="status">Loading downloads…</p> : <>
      {query.isError && <div role="alert" className="mb-4 border p-3"><p>{downloads.length ? 'Could not refresh downloads. Showing the last loaded records.' : 'Could not load downloads.'}</p><p className="break-words text-sm text-muted-foreground">{query.error.message}</p><Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch({ cancelRefetch: false })}>Retry loading downloads</Button></div>}
      {query.data && <p className="mb-3 text-sm text-muted-foreground"><span className="font-mono">{downloads.length}</span> loaded records · {status === 'all' ? 'All statuses' : label(status)} · Up to 100 returned records, newest first. Counts describe this loaded set only.</p>}
      {!query.isError && downloads.length === 0 && <p>{status === 'all' ? 'No downloads yet. Soulseek downloads will appear here.' : `No ${label(status).toLowerCase()} downloads in the returned set.`}</p>}
      <div>{downloads.map(download => <DownloadRow key={`${user?.id}:${user?.role}:${download.id}`} download={download} />)}</div>
    </>}
  </>;
}
