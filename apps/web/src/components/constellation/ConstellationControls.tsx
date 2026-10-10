'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ROLE_FILTER_OPTIONS,
  ROLE_LABELS,
  rolesToMask,
  type BaseRole,
} from './roleBits';
import { GENRE_LEGEND } from './encoding';

/**
 * The constellation controls bar (Design §5 / §8).
 *
 * Three honest controls over the field:
 *  - **Role filter** — which credit roles create edges. Server-side: the selected
 *    roles fold into a `roleMask` (bitwise OR of {@link ROLE_BITS}) that the seed
 *    re-fetch passes to `GraphService.subgraph`, so the backend actually re-filters
 *    the edges. Semantics: ALL checked or NONE checked = `undefined` (no filter);
 *    a proper subset = the mask (see {@link rolesToMask}).
 *  - **Hide hotness** — collapse the prominence size channel to a uniform radius
 *    (client-side node paint only).
 *  - **Genre highlight** — trace one genre across the field by dimming every
 *    non-matching node (client-side; no re-fetch). A small legend shows the
 *    palette so the highlighted hue is recognisable.
 */
export interface ConstellationControlsProps {
  creditSource?: 'index' | 'live' | null;
  /** Selected role bitmask, or `undefined` for "all roles / no filter". */
  onRoleMaskChange: (mask: number | undefined) => void;
  /** Whether the prominence (size) channel is hidden (uniform node size). */
  onHideHotnessChange: (hide: boolean) => void;
  /** The genre to highlight (dim non-matching nodes), or `null` for "all". */
  onGenreHighlightChange: (genre: string | null) => void;
}

/** Sentinel select value for "no genre highlight" (all genres shown normally). */
const ALL_GENRES = '__all__';

export function ConstellationControls({
  creditSource,
  onRoleMaskChange,
  onHideHotnessChange,
  onGenreHighlightChange,
}: ConstellationControlsProps) {
  // All roles start checked === no filter (undefined). Unchecking narrows the
  // field to a proper subset; checking all again (or none) clears the filter.
  const [selectedRoles, setSelectedRoles] = useState<Set<BaseRole>>(
    () => new Set(ROLE_FILTER_OPTIONS),
  );
  const [hideHotness, setHideHotness] = useState(false);
  const [genre, setGenre] = useState<string>(ALL_GENRES);

  const toggleRole = useCallback(
    (role: BaseRole) => {
      setSelectedRoles((prev) => {
        const next = new Set(prev);
        if (next.has(role)) next.delete(role);
        else next.add(role);
        onRoleMaskChange(rolesToMask(next));
        return next;
      });
    },
    [onRoleMaskChange],
  );

  const onHideHotness = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHideHotness(e.target.checked);
      onHideHotnessChange(e.target.checked);
    },
    [onHideHotnessChange],
  );

  const onGenre = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      setGenre(value);
      onGenreHighlightChange(value === ALL_GENRES ? null : value);
    },
    [onGenreHighlightChange],
  );

  useEffect(() => {
    if (creditSource === 'live') { setGenre(ALL_GENRES); onGenreHighlightChange(null); }
  }, [creditSource, onGenreHighlightChange]);

  const legend = useMemo(() => GENRE_LEGEND, []);

  return (
    <div
      data-testid="constellation-controls"
      className="flex flex-col gap-3 rounded-container bg-background p-3 text-xs text-foreground"
    >
      <p className="text-muted-foreground">Color: genre · node size: prominence · ring: in library · red ring: seed · line width: collaboration strength · warm line: confident bridge score. Shared releases and roles appear in person details when recorded.</p>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 font-medium text-muted-foreground">Roles</legend>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {ROLE_FILTER_OPTIONS.map((role) => (
            <label key={role} className="flex min-h-11 items-center gap-1">
              <input
                type="checkbox"
                checked={selectedRoles.has(role)}
                onChange={() => toggleRole(role)}
              />
              {ROLE_LABELS[role]}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" checked={hideHotness} onChange={onHideHotness} />
        Hide hotness
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-2" htmlFor="genre-highlight">
          Highlight genre
          <select
            id="genre-highlight"
            disabled={creditSource === 'live'}
            aria-describedby={creditSource === 'live' ? 'live-genre-reason' : undefined}
            value={genre}
            onChange={onGenre}
            className="rounded border border-border bg-background px-2 py-1"
          >
            <option value={ALL_GENRES}>All</option>
            {legend.map((entry) => (
              <option key={entry.genre} value={entry.genre}>
                {entry.genre}
              </option>
            ))}
          </select>
        </label>

        {creditSource === 'live' && <p id="live-genre-reason">Genre colour unavailable on the live Discogs source</p>}
        <ul
          hidden={creditSource === 'live'}
          data-testid="genre-legend"
          className="flex flex-wrap gap-x-2 gap-y-1 text-muted-foreground"
        >
          {legend.map((entry) => (
            <li key={entry.genre} className="flex min-h-11 items-center gap-1">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.genre}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default ConstellationControls;
