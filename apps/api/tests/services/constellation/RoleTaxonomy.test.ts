import { describe, it, expect } from 'vitest';
import { normalizeRole, roleWeight, ROLE_BITS, rolesToBitmask } from '../../../src/services/constellation/RoleTaxonomy.js';

describe('RoleTaxonomy', () => {
  it('strips bracket detail and maps to a base role', () => {
    expect(normalizeRole('Bass [Fretless]')).toEqual(['performer']);
    expect(normalizeRole('Engineer [Assistant]')).toEqual(['engineer']);
  });
  it('splits multi-role join strings', () => {
    expect(normalizeRole('Producer, Mixed By, Written-By').sort())
      .toEqual(['composer', 'engineer', 'producer']);
  });
  it('ignores uncredited/non-person noise but keeps the role', () => {
    expect(normalizeRole('Performer [Uncredited]')).toEqual(['performer']);
  });
  it('maps unknown roles to "other" with near-zero weight', () => {
    expect(normalizeRole('Artwork')).toEqual(['artwork']);
    expect(roleWeight('artwork')).toBeLessThan(roleWeight('performer'));
  });
  it('builds a bitmask from roles', () => {
    const mask = ROLE_BITS.performer | ROLE_BITS.producer;
    expect(mask & ROLE_BITS.performer).toBeTruthy();
    expect(mask & ROLE_BITS.engineer).toBeFalsy();
  });
  it('rolesToBitmask sets the given role bits and no others', () => {
    const mask = rolesToBitmask(['performer', 'producer']);
    expect(mask & ROLE_BITS.performer).toBeTruthy();
    expect(mask & ROLE_BITS.producer).toBeTruthy();
    expect(mask & ROLE_BITS.engineer).toBeFalsy();
  });
  it('maps unmapped instruments to performer via the regex fallback', () => {
    expect(normalizeRole('Violin')).toEqual(['performer']);
  });
  it('maps unrecognized roles to "other"', () => {
    expect(normalizeRole('Tape Op')).toEqual(['other']);
  });
  it('returns an empty array for empty input', () => {
    expect(normalizeRole('')).toEqual([]);
  });
  it('returns an empty array for null/undefined input', () => {
    expect(normalizeRole(undefined as unknown as string)).toEqual([]);
    expect(normalizeRole(null as unknown as string)).toEqual([]);
  });
});
