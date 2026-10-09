'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { canonicalArtistMbid } from '@/components/artists/ArtistLink';

export interface ResolvedPerson { mbid: string; personId: number; name: string }
interface Candidate { id: string; name: string; country?: string; disambiguation?: string }
export interface IdentityResponse { mbid: string | null; personId: number | null; displayName?: string; needsManual: boolean }
export function personIdentifier(value: string | null): number | null {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/** A deliberately chosen MusicBrainz candidate is required before resolving a graph person. */
export function ArtistLookup({ label, onChange, actorId, initialPersonId }: {
  label: string; onChange: (person: ResolvedPerson | null) => void; actorId?: number; initialPersonId?: number | null;
}) {
  const namespace = useId();
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'searching' | 'choices' | 'empty' | 'resolving' | 'resolved' | 'unresolved' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null);
  const resolved = useRef<{ actorId: number | undefined; person: ResolvedPerson } | null>(null);
  const callback = useRef(onChange); callback.current = onChange;
  const retire = () => { request.current?.abort(); request.current = null; };
  useEffect(() => {
    if (initialPersonId && resolved.current && resolved.current.actorId === actorId && resolved.current.person.personId === initialPersonId) return;
    resolved.current = null;
    retire(); callback.current(null); setQuery(''); setChoices([]); setSelected(null); setState('idle');
    if (!initialPersonId) return;
    const controller = new AbortController(); request.current = controller;
    setState('resolving');
    void api.get<IdentityResponse>(`/api/constellation/identity?personId=${initialPersonId}`, { signal: controller.signal }).then(async ({ data, error }) => {
      if (controller.signal.aborted) return;
      const mbid = canonicalArtistMbid(data?.mbid);
      let name = typeof data?.displayName === 'string' ? data.displayName.trim() : '';
      if (mbid && data && !data.needsManual && data.personId === initialPersonId && !name) {
        const detail = await api.get<{ name: string; mbid: string }>(`/api/search/artist/${mbid}/detail`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (detail.error || !detail.data) { setMessage(detail.error || 'Artist name unavailable'); setState('error'); return; }
        if (canonicalArtistMbid(detail.data.mbid) === mbid && typeof detail.data.name === 'string') name = detail.data.name.trim();
      }
      if (error || !data) { setMessage(error || 'Identity lookup failed'); setState('error'); return; }
      if (!mbid || !name || data.needsManual || data.personId !== initialPersonId) { setState('unresolved'); return; }
      setQuery(name); setSelected(mbid); setState('resolved');
      const person = { mbid, personId: initialPersonId, name };
      resolved.current = { actorId, person }; callback.current(person);
    }).catch(() => { if (!controller.signal.aborted) { setMessage('Identity lookup failed'); setState('error'); } });
    return retire;
  }, [actorId, initialPersonId, retry]);
  useEffect(() => () => retire(), []);

  async function search() {
    if (!query.trim()) return;
    retire(); resolved.current = null; callback.current(null); setSelected(null); setState('searching');
    const controller = new AbortController(); request.current = controller;
    try {
      const { data, error } = await api.get<{ results: Candidate[] }>(`/api/search/musicbrainz/artist?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error(error || 'Artist search failed');
      const seen = new Set<string>();
      const candidates = (Array.isArray(data.results) ? data.results : []).filter(candidate => {
        const id = canonicalArtistMbid(candidate?.id);
        if (!id || typeof candidate.name !== 'string' || !candidate.name.trim() || seen.has(id)) return false;
        seen.add(id); return true;
      }).map(candidate => ({ id: candidate.id.toLowerCase(), name: candidate.name.trim(), country: typeof candidate.country === 'string' ? candidate.country : undefined, disambiguation: typeof candidate.disambiguation === 'string' ? candidate.disambiguation : undefined }));
      setChoices(candidates); setState(candidates.length ? 'choices' : 'empty');
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Artist search failed'); setState('error'); }
    }
  }
  async function resolve(candidate: Candidate) {
    retire(); resolved.current = null; callback.current(null); setSelected(candidate.id); setState('resolving');
    const controller = new AbortController(); request.current = controller;
    try {
      const { data, error } = await api.get<IdentityResponse>(`/api/constellation/identity?mbid=${candidate.id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (error || !data) throw new Error(error || 'Identity lookup failed');
      const personId = personIdentifier(String(data.personId));
      if (!personId || data.needsManual || canonicalArtistMbid(data.mbid) !== candidate.id) { setState('unresolved'); return; }
      setQuery(candidate.name); setState('resolved');
      const person = { mbid: candidate.id, personId, name: candidate.name }; resolved.current = { actorId, person }; callback.current(person);
    } catch (error) {
      if (!controller.signal.aborted) { setMessage(error instanceof Error ? error.message : 'Identity lookup failed'); setState('error'); }
    }
  }
  return <div className="min-w-0 space-y-2">
    <label htmlFor={namespace} className="text-sm font-medium">{label}</label>
    <div className="flex min-w-0 gap-2"><input id={namespace} value={query} maxLength={200} placeholder="Artist name" className="min-h-11 min-w-0 flex-1 rounded-button border bg-background px-2 text-sm" onChange={event => { resolved.current = null; retire(); setQuery(event.target.value); setChoices([]); setSelected(null); setState('idle'); callback.current(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} />
      <button type="button" className="min-h-11 shrink-0 rounded-button border px-3 text-sm" disabled={!query.trim() || state === 'searching'} onClick={() => void search()}>Search</button></div>
    {choices.length > 0 && <fieldset className="space-y-1"><legend className="text-xs text-muted-foreground">Choose {label.toLowerCase()} identity</legend>{choices.map(candidate => <label key={candidate.id} className="flex min-h-11 items-start gap-2 break-words py-2 text-sm"><input type="radio" name={`${namespace}-candidate`} className="mt-1 shrink-0" checked={selected === candidate.id} onChange={() => void resolve(candidate)} /><span className="min-w-0">{candidate.name}<span className="block text-xs text-muted-foreground">{[candidate.disambiguation, candidate.country].filter(value => typeof value === 'string').join(' · ') || 'No disambiguation supplied'}</span><span className="block break-all font-mono text-[10px] text-muted-foreground">{candidate.id}</span></span></label>)}</fieldset>}
    {(state === 'searching' || state === 'resolving') && <p role="status" className="text-xs">{state === 'searching' ? 'Searching artists…' : 'Resolving graph identity…'}</p>}
    {state === 'empty' && <p role="status" className="text-xs">No matching artists. Try another name.</p>}
    {state === 'resolved' && resolved.current && <p role="status" className="text-xs"><span>{query} selected</span><span className="block font-mono text-xs text-muted-foreground">Discogs person ID: {resolved.current.person.personId}</span></p>}
    {state === 'unresolved' && <p role="status" className="text-xs">No verified graph identity. Choose another artist or check the MusicBrainz Discogs link.</p>}
    {state === 'error' && <div role="alert" className="text-xs">{message} <button type="button" className="min-h-11 text-link underline" onClick={() => { const candidate = choices.find(choice => choice.id === selected); if (candidate) void resolve(candidate); else if (initialPersonId && !query) { setRetry(value => value + 1); } else void search(); }}>Retry {label.toLowerCase()}</button></div>}
  </div>;
}
