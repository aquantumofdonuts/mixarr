'use client';

import Image from 'next/image';
import Music from 'lucide-react/dist/esm/icons/music';
import { ArtistLink, canonicalArtistMbid } from '@/components/artists/ArtistLink';
import { Button } from '@/components/ui/button';
import type { AcquisitionState, ArtistSourceRecord } from '@mixarr/shared-types';
import { cn } from '@/lib/utils';

export interface FeedCardProps {
  id: string;
  artistName: string;
  artistMbid?: string | null;
  imageUrl: string | null;
  status?: 'pending' | 'adding' | 'failed' | 'added' | 'dismissed';
  acquisitionState?: AcquisitionState;
  acquisitionMessage?: string;
  isLoading?: boolean;
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onOpen?: (trigger: HTMLElement) => void;
  tags?: string[] | null;
  listeners?: number | null;
  subscriptionName?: string | null;
  sourceRecords?: ArtistSourceRecord[];
  sourceRecordCount?: number;
  view?: 'list' | 'artwork';
}

function formatListeners(count: number) {
  return count >= 1_000_000 ? `${Math.floor(count / 1_000_000)}M` : count >= 1_000 ? `${Math.floor(count / 1_000)}K` : String(Math.max(0, count));
}

export function FeedCard({ id, artistName, artistMbid, imageUrl, status, acquisitionState, acquisitionMessage, isLoading,
  onApprove, onDismiss, onOpen, tags, listeners, subscriptionName, sourceRecords, sourceRecordCount, view = 'list' }: FeedCardProps) {
  const state = acquisitionState ?? (status === 'added' ? 'added' : status === 'adding' ? 'adding' : status === 'failed' ? 'uncertain' : 'available');
  const pending = isLoading || state === 'adding';
  const confirmed = state === 'added' || state === 'already-in-library';
  const identify = !canonicalArtistMbid(artistMbid) || state === 'identity-required';
  const source = sourceRecords?.[0];
  const additional = Math.max(0, (sourceRecordCount ?? sourceRecords?.length ?? 0) - 1);
  const message = acquisitionMessage || (state === 'adding' ? 'Waiting for Lidarr confirmation…' : state === 'added' ? 'Added to Lidarr' : state === 'already-in-library' ? 'Already in Lidarr'
    : state === 'connection-required' ? 'A working Lidarr connection is required.' : identify ? `Search for ${artistName} and choose the matching MusicBrainz artist.`
    : state === 'failed' ? 'Addition failed. Retry checks Lidarr first.' : state === 'uncertain' ? 'Addition is unconfirmed. Retry checks Lidarr first.' : '');
  return <article data-feed-id={id} aria-label={artistName} aria-busy={pending || undefined}
    className={cn('border-b border-border bg-background py-3', view === 'list' ? 'flex flex-wrap items-start gap-3' : 'flex flex-col gap-3 border p-3')}>
    <div className={cn('relative shrink-0 overflow-hidden rounded-button bg-muted', view === 'list' ? 'h-12 w-12' : 'aspect-square w-full')}>
      <ArtistLink mbid={artistMbid} onOpen={onOpen} aria-label={`Inspect artwork for ${artistName}`} className="block h-full w-full">{imageUrl ? <Image src={imageUrl} alt="" fill sizes={view === 'list' ? '48px' : '(max-width: 640px) 100vw, 240px'} className="object-cover" />
        : <div data-testid="image-placeholder" className="flex h-full items-center justify-center"><Music className="h-5 w-5 text-muted-foreground" aria-hidden="true" /></div>}</ArtistLink>
    </div>
    <div className={cn("min-w-0 flex-1 space-y-1", view === 'list' && 'basis-40')}>
      <ArtistLink mbid={artistMbid} onOpen={onOpen} className="break-words font-semibold">{artistName}</ArtistLink>
      <p className="text-xs text-muted-foreground">{source ? <>Discovered through {source.subscriptionId !== null ? <a className="text-link hover:underline" href={`/subscriptions/${source.subscriptionId}?tab=results`}>{source.label}</a> : source.label}{additional > 0 && ` · ${additional} more source record${additional === 1 ? '' : 's'}`}</>
        : subscriptionName ? `Discovered through ${subscriptionName}` : 'Discovery source unavailable'}</p>
      {(tags?.length || listeners !== null && listeners !== undefined) ? <p className="text-xs text-muted-foreground">{tags?.slice(0, 3).join(' · ')}{tags?.length && listeners !== null && listeners !== undefined ? ' · ' : ''}{listeners !== null && listeners !== undefined && <span className="font-mono">{formatListeners(listeners)} listeners</span>}</p> : null}
      {message && <p role="status" className={cn('text-xs', confirmed ? 'text-status-success' : 'text-muted-foreground')}>{message}</p>}
    </div>
    {!confirmed && status !== 'dismissed' && <div className="flex shrink-0 flex-wrap gap-2 sm:ml-auto">
      {state === 'connection-required' ? <a href="/connections" className="inline-flex min-h-11 items-center text-sm text-link hover:underline">Connect Lidarr</a>
        : identify ? <a href="/search" aria-label={`Identify artist ${artistName}`} className="inline-flex min-h-11 items-center text-sm text-link hover:underline">Identify artist</a>
        : <Button size="sm" disabled={pending} aria-label={`${state === 'failed' || state === 'uncertain' ? 'Retry' : 'Add artist'} ${artistName}`} onClick={() => onApprove(id)}>{state === 'failed' || state === 'uncertain' ? 'Retry' : 'Add artist'}</Button>}
      <Button size="sm" variant="outline" disabled={pending} aria-label={`Dismiss ${artistName}`} onClick={() => onDismiss(id)}>Dismiss</Button>
    </div>}
  </article>;
}
