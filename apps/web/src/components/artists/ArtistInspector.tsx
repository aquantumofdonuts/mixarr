'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useArtistDetail, useArtistReleases } from '@/lib/hooks';
import { useListContext } from '@/hooks/useListContext';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useArtistAdd } from '@/app/search/hooks/useArtistAdd';
import { canonicalArtistMbid } from './ArtistLink';

export function ArtistInspector({ restoreContext = true }: { restoreContext?: boolean }) {
  const params = useSearchParams();
  const { closeInspector } = useListContext({ ready: true, selectionOwner: false, restore: restoreContext });
  const { user } = useAuth();
  const identity = canonicalArtistMbid(params.get('artist'));
  // A new identity owns a fresh add action. A previous request cannot mark its replacement as acquired.
  return <InspectorPanel key={`${user?.id}:${identity}`} identity={identity} isOpen={params.has('artist')} onClose={closeInspector} />;
}

function InspectorPanel({ identity, isOpen, onClose }: { identity: string | null; isOpen: boolean; onClose: () => void }) {
  const detail = useArtistDetail(identity), releases = useArtistReleases(identity);
  const { user } = useAuth();
  const client = useQueryClient();
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const refreshConfirmed = useCallback((updater: (previous: any[]) => any[]) => {
    if (!live.current || !identity) return;
    const confirmed = updater([{ foreignArtistId: identity, inLibrary: false }]).some(row => row.foreignArtistId === identity && row.inLibrary);
    if (confirmed) {
      void client.invalidateQueries({ queryKey: ['artists', user?.id ?? null, identity, 'detail'] });
      void client.invalidateQueries({ queryKey: ['discover', 'library'] });
    }
  }, [client, user?.id, identity]);
  const { handleAddArtist, addingArtistId, optionsDialog } = useArtistAdd(refreshConfirmed);
  const pages = detail.data?.pages.filter(page => page.mbid.toLowerCase() === identity) ?? [];
  const artist = pages[0];
  const sources = [...new Map(pages.flatMap(page => page.sources).map(source => [source.key, source])).values()];
  // Chronology describes the loaded pages only; MusicBrainz paging is not a complete discography.
  const chronology = [...new Map((releases.data?.pages.flatMap(page => page.releaseGroups) ?? []).map(release => [release.id, release])).values()]
    .sort((a, b) => (b['first-release-date'] || '').localeCompare(a['first-release-date'] || '') || a.title.localeCompare(b.title));
  const unavailable = artist?.unavailable ?? [];

  return <><Modal isOpen={isOpen} onClose={onClose} title={artist?.name || 'Artist details'} placement="inspector">
    {!identity ? <p role="alert">This artist link does not contain a valid MusicBrainz identity.</p> : <>
      {detail.isPending && <p role="status">Loading artist details…</p>}
      {detail.isError && <div role="alert" className="mb-4 space-y-2"><p>{detail.error?.message || 'Artist details unavailable'}</p><Button variant="outline" onClick={() => void detail.refetch()}>Retry artist details</Button></div>}
      {artist && <>
        <div className="flex items-start gap-3 border-b pb-4">
          {artist.imageUrl && <img src={artist.imageUrl} alt="" className="h-16 w-16 shrink-0 rounded-button object-cover" />}
          <div className="min-w-0 space-y-1">
            {artist.disambiguation && <p className="text-sm text-muted-foreground">{artist.disambiguation}</p>}
            <p className="text-sm">{artist.membership === 'in-library' ? 'In Lidarr' : artist.membership === 'not-in-library' ? 'Not in Lidarr' : 'Collection membership unavailable'}</p>
            <p className="break-all font-mono text-xs text-muted-foreground">{artist.mbid}</p>
            <a href={`https://musicbrainz.org/artist/${artist.mbid}`} target="_blank" rel="noopener noreferrer" className="text-sm text-link hover:underline">MusicBrainz identity</a>
          </div>
        </div>
        {unavailable.length > 0 && <div role="status" className="space-y-2 border-b py-3 text-sm">
          {unavailable.includes('metadata') && <p>Artist metadata unavailable</p>}
          {unavailable.includes('sources') && <p>Known source records unavailable</p>}
          {!detail.isError && <Button variant="outline" onClick={() => void detail.refetch()}>Retry artist details</Button>}
        </div>}
        <section aria-labelledby="artist-sources-heading" className="border-b py-4">
          <h3 id="artist-sources-heading" className="mb-1 font-semibold">Known sources</h3>
          <p className="mb-3 text-xs text-muted-foreground">Stored discovery evidence; each row is an original record.</p>
          {sources.length === 0 && !unavailable.includes('sources') && <p className="text-sm text-muted-foreground">No known source records.</p>}
          <ul className="divide-y">{sources.map(source => <li key={source.key} className="py-3 text-sm">
            {source.subscriptionId !== null ? <a className="text-link hover:underline" href={`/subscriptions/${source.subscriptionId}?tab=results`}>{source.label}</a> : <span>{source.label}</span>}
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <time dateTime={source.recordedAt}>{new Date(source.recordedAt).toLocaleString()}</time>
              <span className="font-mono">{source.recordStatus}</span>
              {source.subscriptionId !== null && source.runId !== null && <a className="text-link hover:underline" href={`/subscriptions/${source.subscriptionId}?tab=runs&run=${source.runId}`}>Run {source.runId}</a>}
              {source.sourceUrl && <a className="text-link hover:underline" href={source.sourceUrl} target="_blank" rel="noopener noreferrer">Source page</a>}
            </div>
          </li>)}</ul>
          {detail.hasNextPage && <Button variant="outline" isLoading={detail.isFetchingNextPage} onClick={() => void detail.fetchNextPage()}>Load more sources</Button>}
        </section>
      </>}
      <section aria-labelledby="artist-releases-heading" className="py-4">
        <h3 id="artist-releases-heading" className="font-semibold">Release chronology</h3>
        <p className="mb-3 text-xs text-muted-foreground">Loaded release groups, newest first.</p>
        {releases.isPending && <p role="status">Loading releases…</p>}
        {releases.isError && <div role="alert" className="mb-3 space-y-2"><p>{releases.error?.message || 'Releases unavailable'}</p><Button variant="outline" onClick={() => void releases.refetch()}>Retry releases</Button></div>}
        {!releases.isPending && !releases.isError && chronology.length === 0 && <p className="text-sm text-muted-foreground">No release groups returned.</p>}
        <ul className="divide-y">{chronology.map(release => <li key={release.id} className="flex items-start gap-3 py-3 text-sm">
          <time className="w-24 shrink-0 font-mono text-xs text-muted-foreground" dateTime={release['first-release-date'] || undefined}>{release['first-release-date'] || 'Undated'}</time>
          <div className="min-w-0"><a className="text-link hover:underline" href={`https://musicbrainz.org/release-group/${release.id}`} target="_blank" rel="noopener noreferrer">{release.title}</a>{release['primary-type'] && <p className="text-xs text-muted-foreground">{release['primary-type']}</p>}</div>
        </li>)}</ul>
        {releases.hasNextPage && <Button variant="outline" isLoading={releases.isFetchingNextPage} onClick={() => void releases.fetchNextPage()}>Load more releases</Button>}
      </section>
    </>}
    <ModalFooter>{identity && <a className="inline-flex min-h-11 items-center text-sm text-link hover:underline" href={`/constellation?seed=${identity}`}>Explore collaborations</a>}<Button variant="outline" onClick={onClose}>Back to list</Button>
      {artist && artist.membership !== 'in-library' && <Button isLoading={addingArtistId !== null} onClick={() => void handleAddArtist({ foreignArtistId: artist.mbid, artistName: artist.name })}>Add artist</Button>}
    </ModalFooter>
  </Modal>{optionsDialog}</>;
}
