'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';
import type { Profiles } from '@/lib/hooks';
import { Modal, ModalFooter } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { MbidSelection } from '@/app/search/components/MbidSelectionModal';
import type { MbidCandidate } from '@/app/search/hooks/useSearch';
import { canonicalArtistMbid } from './ArtistLink';

export interface ArtistAddOptions {
  qualityProfileId: number;
  metadataProfileId: number;
  rootFolderPath: string;
  monitorOption?: string;
  monitorNewItems?: string;
  searchOnAdd: boolean;
  mbid?: string;
}
interface AddRequest { name: string; mbid?: string | null; bulk?: boolean; album?: boolean; mixed?: boolean }
interface Action { request: AddRequest; execute: (options: ArtistAddOptions, isCurrent: () => boolean) => Promise<unknown>; resolve: (value: unknown) => void }

/** One action step shared by source-specific mutations. Failures leave entered options intact. */
export function useAddArtistOptions(scope = '') {
  const { user } = useAuth();
  const owner = `${user?.id ?? 'anonymous'}:${scope}`;
  const ownerRef = useRef({ value: owner });
  if (ownerRef.current.value !== owner) ownerRef.current = { value: owner };
  const [action, setAction] = useState<Action | null>(null);
  const active = useRef<Action | null>(null);
  const close = useCallback(() => { active.current?.resolve(null); active.current = null; setAction(null); }, []);
  useEffect(() => { close(); return close; }, [owner, close]);
  const runWithOptions = useCallback((request: AddRequest, execute: Action['execute']) => {
    if (active.current) return Promise.resolve(null);
    return new Promise<unknown>(resolve => {
      const actionOwner = ownerRef.current;
      const next: Action = { request, resolve, execute: async options => {
        if (ownerRef.current !== actionOwner) throw new Error('This action belongs to a previous session or list');
        const result = await execute(options, () => ownerRef.current === actionOwner && active.current === next);
        if (ownerRef.current !== actionOwner) return null;
        return result;
      } };
      active.current = next; setAction(next);
    });
  }, []);
  const dialog = action ? <AddArtistOptions key={owner} action={action} onClose={close} onComplete={result => {
    if (active.current !== action) return;
    action.resolve(result); active.current = null; setAction(null);
  }} /> : null;
  return { runWithOptions, dialog };
}

export function AddArtistOptions({ action, onClose, onComplete }: { action: Action; onClose: () => void; onComplete: (result: unknown) => void }) {
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [options, setOptions] = useState<ArtistAddOptions>({ qualityProfileId: 0, metadataProfileId: 0, rootFolderPath: '', monitorOption: 'all', monitorNewItems: 'all', searchOnAdd: true });
  const [candidates, setCandidates] = useState<MbidCandidate[]>([]);
  const [identity, setIdentity] = useState(canonicalArtistMbid(action.request.mbid) || '');
  const [loading, setLoading] = useState(true), [working, setWorking] = useState(false), [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void (async () => {
      try {
        const response = await api.get<Profiles>('/api/discover/profiles', { signal: controller.signal });
        if (response.error || !response.data) throw new Error(response.error || 'Lidarr options unavailable');
        if (controller.signal.aborted) return;
        const data = response.data;
        if (!Array.isArray(data.qualityProfiles) || !Array.isArray(data.metadataProfiles) || !Array.isArray(data.rootFolders) || !data.qualityProfiles.every(p => p && Number.isInteger(p.id) && p.id > 0 && typeof p.name === 'string') || !data.metadataProfiles.every(p => p && Number.isInteger(p.id) && p.id > 0 && typeof p.name === 'string') || !data.rootFolders.every(p => p && Number.isInteger(p.id) && typeof p.path === 'string')) throw new Error('Lidarr options unavailable; retry');
        setProfiles(data);
        setOptions(previous => ({ ...previous,
          qualityProfileId: previous.qualityProfileId || data.defaults?.qualityProfileId || data.qualityProfiles[0]?.id || 0,
          metadataProfileId: previous.metadataProfileId || data.defaults?.metadataProfileId || data.metadataProfiles[0]?.id || 0,
          rootFolderPath: previous.rootFolderPath || data.defaults?.rootFolderPath || data.rootFolders[0]?.path || '',
          ...(attempt === 0 ? { monitorOption: data.defaults?.monitorOption || 'all', monitorNewItems: data.defaults?.monitorNewItems || 'all', searchOnAdd: data.defaults?.searchOnAdd ?? true } : {}),
        }));
        if (!identity && !action.request.bulk) {
          const found = await api.get<{ results: MbidCandidate[] }>(`/api/search/musicbrainz/artist?${new URLSearchParams({ q: action.request.name })}`, { signal: controller.signal });
          if (found.error) throw new Error(found.error);
          if (controller.signal.aborted) return;
          const choices = (Array.isArray(found.data?.results) ? found.data.results : []).filter(candidate => candidate && typeof candidate === 'object' && typeof candidate.id === 'string' && canonicalArtistMbid(candidate.id) && typeof candidate.name === 'string' && (candidate.country === undefined || typeof candidate.country === 'string') && (candidate.disambiguation === undefined || typeof candidate.disambiguation === 'string'));
          setCandidates([...new Map(choices.map(candidate => { const id = canonicalArtistMbid(candidate.id)!; return [id, { ...candidate, id }]; })).values()]);
          if (!choices.length) throw new Error('No artist identities found. Retry the identity search.');
        }
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Lidarr options unavailable'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
    // Identity is an explicit choice; selecting it must not reload/reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  const submit = async () => {
    if (working || loading) return;
    const invalid = !profiles?.rootFolders.some(p => p.path === options.rootFolderPath) ? '[name="rootFolderPath"]'
      : !profiles.qualityProfiles.some(p => p.id === options.qualityProfileId) ? '[name="qualityProfileId"]'
      : !profiles.metadataProfiles.some(p => p.id === options.metadataProfileId) ? '[name="metadataProfileId"]'
      : !action.request.bulk && !identity ? '[name="identity"]' : null;
    if (invalid) { setError('Choose an available value for each required field and an artist identity.'); form.current?.querySelector<HTMLElement>(invalid)?.focus(); return; }
    setWorking(true); setError('');
    try {
      const { monitorOption, monitorNewItems, ...albumOptions } = options;
      const result = await action.execute({ ...(action.request.album ? albumOptions : options), ...(!action.request.bulk ? { mbid: identity } : {}) }, () => mounted.current);
      if (mounted.current) onComplete(result);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Addition was not confirmed; retry'); }
    finally { if (mounted.current) setWorking(false); }
  };
  const selectClass = 'min-h-11 w-full rounded-button border border-border bg-background px-2 text-sm';
  return <Modal isOpen onClose={() => { if (!working) onClose(); }} title="Add artist options" size="lg">
    <p className="mb-4 text-sm">{action.request.bulk ? action.request.name : `Add ${action.request.name} to Lidarr`}</p>
    {action.request.album && <p className="mb-3 text-sm">Only this album will be monitored. A missing artist is also added.</p>}
    {action.request.mixed && <p className="mb-3 text-sm">Album monitoring options apply to artist review items. Each album review item monitors only its chosen album. Search on add applies to both.</p>}
    {loading && <p role="status">Loading Lidarr options…</p>}
    {error && <div role="alert" className="mb-3 space-y-2"><p>{error}</p>{(!profiles || (!identity && !candidates.length && !action.request.bulk)) && <Button variant="outline" onClick={() => setAttempt(value => value + 1)}>Retry options</Button>}</div>}
    <form ref={form} onSubmit={event => { event.preventDefault(); void submit(); }} className="space-y-3">
      {!canonicalArtistMbid(action.request.mbid) && !action.request.bulk && <MbidSelection candidates={candidates} selected={identity} onSelect={setIdentity} disabled={working} />}
      <label className="block text-sm">Root folder<select name="rootFolderPath" className={selectClass} value={options.rootFolderPath} disabled={working || loading} onChange={event => setOptions({ ...options, rootFolderPath: event.target.value })}><option value="">Choose root folder</option>{profiles?.rootFolders.map(folder => <option key={folder.id} value={folder.path}>{folder.path}</option>)}</select></label>
      <label className="block text-sm">Quality profile<select name="qualityProfileId" className={selectClass} value={options.qualityProfileId} disabled={working || loading} onChange={event => setOptions({ ...options, qualityProfileId: Number(event.target.value) })}><option value={0}>Choose quality profile</option>{profiles?.qualityProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      <label className="block text-sm">Metadata profile<select name="metadataProfileId" className={selectClass} value={options.metadataProfileId} disabled={working || loading} onChange={event => setOptions({ ...options, metadataProfileId: Number(event.target.value) })}><option value={0}>Choose metadata profile</option>{profiles?.metadataProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
      {!action.request.album && <><label className="block text-sm">Monitor albums<select name="monitorOption" className={selectClass} disabled={working || loading} value={options.monitorOption} onChange={event => setOptions({ ...options, monitorOption: event.target.value })}>{['all', 'future', 'missing', 'existing', 'first', 'latest', 'none'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><label className="block text-sm">Monitor new albums<select name="monitorNewItems" className={selectClass} disabled={working || loading} value={options.monitorNewItems} onChange={event => setOptions({ ...options, monitorNewItems: event.target.value })}>{['all', 'none', 'new'].map(value => <option key={value} value={value}>{value}</option>)}</select></label></>}
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="searchOnAdd" checked={options.searchOnAdd} disabled={working || loading} onChange={event => setOptions({ ...options, searchOnAdd: event.target.checked })} />Search on add</label>
    </form>
    <ModalFooter><Button variant="outline" disabled={working} onClick={onClose}>Cancel</Button><Button disabled={loading || !profiles} isLoading={working} onClick={() => void submit()}>Confirm add</Button></ModalFooter>
  </Modal>;
}
