'use client';

import type { MbidCandidate } from '../hooks/useSearch';

/** Explicit canonical choices shared by every artist add action. */
export function MbidSelection({ candidates, selected, onSelect, disabled }: {
  candidates: MbidCandidate[]; selected: string; onSelect: (mbid: string) => void; disabled: boolean;
}) {
  return <fieldset><legend className="mb-2 text-sm font-semibold">Choose MusicBrainz artist</legend>
    {candidates.map(candidate => <label key={candidate.id} className="flex min-h-11 items-start gap-2 border-b py-2 text-sm">
      <input type="radio" name="identity" value={candidate.id} checked={selected === candidate.id} disabled={disabled} onChange={() => onSelect(candidate.id)} className="mt-1" />
      <span>{candidate.name}{candidate.disambiguation && ` · ${candidate.disambiguation}`}{candidate.country && ` · ${candidate.country}`}<span className="block break-all font-mono text-xs text-muted-foreground">{candidate.id}</span></span>
    </label>)}
  </fieldset>;
}
