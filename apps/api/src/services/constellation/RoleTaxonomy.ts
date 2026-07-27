export type BaseRole = 'performer' | 'producer' | 'composer' | 'engineer' | 'artwork' | 'other';

export const ROLE_BITS: Record<BaseRole, number> = Object.freeze({
  performer: 1 << 0, producer: 1 << 1, composer: 1 << 2,
  engineer: 1 << 3, artwork: 1 << 4, other: 1 << 5,
});

const WEIGHTS: Record<BaseRole, number> = Object.freeze({
  performer: 1.0, producer: 1.0, composer: 0.6, engineer: 0.3, artwork: 0.02, other: 0.05,
});
export const roleWeight = (r: BaseRole) => WEIGHTS[r];

// Base token (lowercased, bracket-stripped) -> BaseRole. Extend over time.
const MAP: Record<string, BaseRole> = {
  bass: 'performer', guitar: 'performer', drums: 'performer', vocals: 'performer',
  performer: 'performer', piano: 'performer', keyboards: 'performer', saxophone: 'performer',
  producer: 'producer', 'produced by': 'producer',
  'written-by': 'composer', 'written by': 'composer', composer: 'composer', lyricist: 'composer',
  'mixed by': 'engineer', 'recorded by': 'engineer', 'mastered by': 'engineer', engineer: 'engineer',
  artwork: 'artwork', 'design': 'artwork', photography: 'artwork', 'liner notes': 'artwork',
};

export function normalizeRole(raw: string): BaseRole[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const roles = new Set<BaseRole>();
  for (const part of parts) {
    const base = part.replace(/\[[^\]]*\]/g, '').trim().toLowerCase();
    roles.add(MAP[base] ?? (/(bass|guitar|drum|vocal|violin|cello|flute|horn|synth)/.test(base) ? 'performer' : 'other'));
  }
  return [...roles];
}

export function rolesToBitmask(roles: BaseRole[]): number {
  return roles.reduce((m, r) => m | ROLE_BITS[r], 0);
}
