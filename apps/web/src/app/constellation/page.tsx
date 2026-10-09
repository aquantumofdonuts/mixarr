'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { canonicalArtistMbid } from '@/components/artists/ArtistLink';
import { ArtistLookup, personIdentifier, type ResolvedPerson } from '@/components/constellation/ArtistLookup';
import { ConstellationView } from '@/components/constellation/ConstellationView';
import { ConstellationPlayerProvider } from '@/components/constellation/ConstellationPlayer';

export default function ConstellationPage() {
  const params = useSearchParams(), router = useRouter();
  const { user } = useAuth();
  const [selection, setSelection] = useState<ResolvedPerson | null>(null);
  const seed = canonicalArtistMbid(params.get('seed'));
  const focus = personIdentifier(params.get('focus'));
  const from = personIdentifier(params.get('from')), to = personIdentifier(params.get('to'));
  const mode = params.get('mode') === 'interesting' ? 'interesting' : 'shortest';
  function navigate(changes: Record<string, string | null>, replace = false) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value); }
    router[replace ? 'replace' : 'push'](`/constellation${next.size ? `?${next}` : ''}`, { scroll: false });
  }
  return <ConstellationPlayerProvider key={user?.id}><div className="space-y-4">
    <PageHeader title="Constellation" description="Follow the people, roles and releases behind the music." />
    <div className="max-w-xl space-y-2"><ArtistLookup label="Seed artist" actorId={user?.id} onChange={setSelection} />
      <button type="button" disabled={!selection} className="min-h-11 rounded-button bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50" onClick={() => { if (selection) navigate({ seed: selection.mbid, focus: String(selection.personId), from: null, to: null, mode: null }); }}>Explore artist</button></div>
    {params.has('seed') && !seed && <p role="alert">The seed must be a valid MusicBrainz artist identity. Search by name to choose an artist.</p>}
    {seed ? <ConstellationView key={`${user?.id}:${seed}`} seed={{ type: 'artist', id: seed }} actorId={user?.id} requestedFocus={focus} pathFrom={from} pathTo={to} pathMode={mode}
      onFocusChange={(personId, replace) => navigate({ focus: String(personId) }, replace)}
      onPathChange={(fromId, toId, pathMode) => navigate({ from: String(fromId), to: String(toId), mode: pathMode })} />
      : <div className="flex min-h-64 items-center justify-center border p-6 text-center text-sm text-muted-foreground">Search for an artist, choose their MusicBrainz identity, then explore their credited collaborators.</div>}
  </div></ConstellationPlayerProvider>;
}
