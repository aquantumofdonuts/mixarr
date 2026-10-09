'use client';

import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useConstellationSettings, useConstellationUsage, useUpdateConstellationSettings, type ConstellationSettings as Settings } from '@/lib/hooks';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type Draft = Omit<Settings, 'orbitEdgeBudget' | 'dailyApiBudget' | 'fanoutN' | 'pathMaxDegrees'> & {
  orbitEdgeBudget: string; dailyApiBudget: string; fanoutN: string; pathMaxDegrees: string;
};
const budgets = [
  ['orbitEdgeBudget', 'Orbit edge budget', 'Bounds the edges materialized during each taste-orbit warm.'],
  ['dailyApiBudget', 'Daily API budget', 'Bounds charged live Discogs request reservations per UTC day, including failed and rejected requests.'],
  ['fanoutN', 'Fan-out', 'Bounds neighbors kept per node; exploration uses at most 49 neighbors within a 50-person graph.'],
  ['pathMaxDegrees', 'Path max degrees', 'Bounds path traversal; the server also limits paths to 10 degrees.'],
] as const;
function toDraft(settings: Settings): Draft {
  return { ...settings, orbitEdgeBudget: String(settings.orbitEdgeBudget), dailyApiBudget: String(settings.dailyApiBudget), fanoutN: String(settings.fanoutN), pathMaxDegrees: String(settings.pathMaxDegrees) };
}

export function ConstellationSettings() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <AdminConstellationSettings key={user.id} /> : null;
}

function AdminConstellationSettings() {
  const query = useConstellationSettings();
  const usage = useConstellationUsage();
  const update = useUpdateConstellationSettings();
  const [baseline, setBaseline] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const active = useRef(false);
  const request = useRef<AbortController | null>(null);
  const dirty = !!draft && !!baseline && JSON.stringify(draft) !== JSON.stringify(baseline);
  const preserve = useRef(false);
  preserve.current = dirty || saving;
  useUnsavedChanges(dirty);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!query.data || preserve.current) return;
    const initial = toDraft(query.data);
    setBaseline(initial); setDraft(initial);
  }, [query.data]);

  const save = async () => {
    if (!draft || !baseline || saving || request.current || !dirty) return;
    const fail = (key: string, message: string) => {
      setError(message); setInvalid(key); document.getElementById(`constellation-${key}`)?.focus();
    };
    if (typeof draft.constellationIndexEnabled !== 'boolean') return fail('constellationIndexEnabled', 'Index enabled must be a boolean.');
    if (!draft.constellationIndexPath.length) return fail('constellationIndexPath', 'Index path must not be empty.');
    for (const [key, label] of budgets) {
      if (!draft[key].trim() || !Number.isInteger(Number(draft[key])) || Number(draft[key]) <= 0) return fail(key, `${label} must be a positive integer.`);
    }
    if (draft.indexRefresh !== 'monthly' && draft.indexRefresh !== 'off') return fail('indexRefresh', 'Index refresh must be monthly or off.');
    const submitted = { ...draft };
    const values: Settings = { ...submitted, orbitEdgeBudget: Number(submitted.orbitEdgeBudget), dailyApiBudget: Number(submitted.dailyApiBudget), fanoutN: Number(submitted.fanoutN), pathMaxDegrees: Number(submitted.pathMaxDegrees) };
    const changes = Object.fromEntries(Object.entries(values).filter(([key]) => submitted[key as keyof Draft] !== baseline[key as keyof Draft]));
    const controller = new AbortController(); request.current = controller;
    setSaving(true); setError(null); setInvalid(null); setSaved(false);
    try {
      await update.mutateAsync({ changes, signal: controller.signal });
      if (!active.current || request.current !== controller) return;
      setBaseline(submitted); setSaved(true);
    } catch (cause) {
      if (!active.current || request.current !== controller) return;
      setError(cause instanceof Error ? cause.message : 'Failed to save constellation settings.');
    } finally {
      if (active.current && request.current === controller) { request.current = null; setSaving(false); }
    }
  };
  const edit = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft(current => current && ({ ...current, [key]: value })); setSaved(false);
  };
  return <Card role="region" aria-label="Constellation settings">
    <CardHeader>
      <CardTitle>Constellation</CardTitle>
      <CardDescription>System-wide collaboration index and exploration budgets (Admin only)</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {query.error && <div><p role="alert">{query.error.message}</p><Button variant="outline" onClick={() => void query.refetch()}>Retry loading constellation settings</Button></div>}
      {query.isPending && <p role="status">Loading constellation settings…</p>}
      {draft && <fieldset className="space-y-4">
        <div className="flex items-start justify-between gap-4 border-b pb-3">
          <div><label htmlFor="constellation-constellationIndexEnabled" className="font-medium">Local credit index</label><p className="text-sm text-muted-foreground">Building the index downloads and parses the full Discogs releases dump (~10GB compressed, ~100GB+ uncompressed): hours of parsing and a real disk-and-time commitment.</p></div>
          <input type="checkbox" id="constellation-constellationIndexEnabled" checked={draft.constellationIndexEnabled} onChange={event => edit('constellationIndexEnabled', event.target.checked)} className="mt-1 accent-current" />
        </div>
        <Input label="Index path" id="constellation-constellationIndexPath" value={draft.constellationIndexPath} onChange={event => edit('constellationIndexPath', event.target.value)} aria-invalid={invalid === 'constellationIndexPath'} className="font-mono" />
        {budgets.map(([key, label, help]) => <div key={key}>
          <Input label={label} id={`constellation-${key}`} type="number" min={1} step={1} value={draft[key]} onChange={event => edit(key, event.target.value)} aria-invalid={invalid === key} aria-describedby={`constellation-${key}-help`} className="font-mono" />
          <p id={`constellation-${key}-help`} className="mt-1 text-sm text-muted-foreground">{help}</p>
        </div>)}
        <Select label="Index refresh preference" id="constellation-indexRefresh" value={draft.indexRefresh} onChange={event => edit('indexRefresh', event.target.value as Settings['indexRefresh'])} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'off', label: 'Off' }]} aria-describedby="constellation-refresh-help" />
        <p id="constellation-refresh-help" className="text-sm text-muted-foreground">Automatic index refresh is unavailable; saving this preference does not start or stop an import.</p>
      </fieldset>}
      <div>
        {usage.data && !usage.error && <p>Today’s charged reservations: <span className="font-mono">{usage.data.used} / {usage.data.limit}</span> on <span className="font-mono">{usage.data.day}</span>. Resets at <span className="font-mono">00:00 UTC</span>.</p>}
        {usage.isPending && <p role="status">Loading constellation usage…</p>}
        {usage.error && <><p role="alert">{usage.error.message}</p><Button variant="outline" onClick={() => void usage.refetch()}>Retry loading constellation usage</Button></>}
      </div>
      <p role={error ? 'alert' : 'status'}>{error || (saving ? 'Saving constellation settings…' : dirty ? 'Unsaved constellation settings changes' : saved && !query.error ? 'Constellation settings saved' : baseline ? 'Constellation settings unchanged' : 'Constellation settings unavailable')}</p>
      <div className="flex justify-end"><Button onClick={() => void save()} disabled={!dirty || saving || !baseline}>Save constellation settings</Button></div>
    </CardContent>
  </Card>;
}
