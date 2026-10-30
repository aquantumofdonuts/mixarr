import { describe, it, expect } from 'vitest';
import { ROLE_BITS, ROLE_FILTER_OPTIONS, rolesToMask } from '../roleBits';

describe('roleBits — backend contract', () => {
  // These are the documented values of RoleTaxonomy.ROLE_BITS on the backend
  // (apps/api/src/services/constellation/RoleTaxonomy.ts). If the backend bits
  // change, THIS test must fail so the frontend copy is updated in lockstep.
  it('matches the documented backend ROLE_BITS values', () => {
    expect(ROLE_BITS).toEqual({
      performer: 1,
      producer: 2,
      composer: 4,
      engineer: 8,
      artwork: 16,
      other: 32,
    });
  });

  it('exposes the five user-facing roles (omits "other")', () => {
    expect(ROLE_FILTER_OPTIONS).toEqual(['performer', 'producer', 'composer', 'engineer', 'artwork']);
  });
});

describe('rolesToMask', () => {
  it('returns undefined when none are selected (no filter)', () => {
    expect(rolesToMask([])).toBeUndefined();
  });

  it('returns undefined when ALL filter options are selected (no filter)', () => {
    expect(rolesToMask(ROLE_FILTER_OPTIONS)).toBeUndefined();
  });

  it('ORs a proper subset into a bitmask', () => {
    // performer(1) | composer(4) = 5
    expect(rolesToMask(['performer', 'composer'])).toBe(5);
    // producer(2) | engineer(8) = 10
    expect(rolesToMask(['producer', 'engineer'])).toBe(10);
    // a single role
    expect(rolesToMask(['artwork'])).toBe(16);
  });
});
