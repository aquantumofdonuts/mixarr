/**
 * Frontend role-to-bit mapping for the roleMask API parameter. Values must
 * match ROLE_BITS in apps/api/src/services/constellation/RoleTaxonomy.ts.
 * The controls OR selected bits; GraphService uses the mask to filter edges.
 */

export type BaseRole = 'performer' | 'producer' | 'composer' | 'engineer' | 'artwork' | 'other';

/** Bit value per base role — MUST match RoleTaxonomy.ROLE_BITS on the backend. */
export const ROLE_BITS: Record<BaseRole, number> = Object.freeze({
  performer: 1 << 0, // 1
  producer: 1 << 1, // 2
  composer: 1 << 2, // 4
  engineer: 1 << 3, // 8
  artwork: 1 << 4, // 16
  other: 1 << 5, // 32
});

/**
 * The roles surfaced as checkboxes in the controls bar. `other` is
 * intentionally omitted from the UI — it is the catch-all bucket, not a role a
 * user would deliberately filter to — but its bit still exists in {@link ROLE_BITS}.
 */
export const ROLE_FILTER_OPTIONS: readonly BaseRole[] = Object.freeze([
  'performer',
  'producer',
  'composer',
  'engineer',
  'artwork',
]);

/** Human labels for the checkboxes. */
export const ROLE_LABELS: Record<BaseRole, string> = Object.freeze({
  performer: 'Performer',
  producer: 'Producer',
  composer: 'Composer',
  engineer: 'Engineer',
  artwork: 'Artwork',
  other: 'Other',
});

/**
 * Fold a set of selected roles into a `roleMask`.
 *
 * Semantics (documented): a mask of `undefined` means "no server-side filter"
 * (all roles / every edge kept). We return `undefined` when NONE are selected
 * OR when ALL of the {@link ROLE_FILTER_OPTIONS} are selected — both read as
 * "don't narrow the field". A proper subset returns the bitwise-OR of the
 * selected bits.
 */
export function rolesToMask(selected: Iterable<BaseRole>): number | undefined {
  const set = new Set(selected);
  if (set.size === 0) return undefined;
  if (set.size === ROLE_FILTER_OPTIONS.length) return undefined;
  let mask = 0;
  for (const role of set) mask |= ROLE_BITS[role];
  return mask;
}
