import { describe, it, expect } from 'vitest';
import { bridgeScore } from '../../../src/services/constellation/BridgeScore.js';

describe('BridgeScore', () => {
  it('is high when collaborator sets barely overlap (a real bridge)', () => {
    const r = bridgeScore(new Set([1,2,3]), new Set([4,5,6]), true, true);
    expect(r.confident).toBe(true);
    expect(r.score).toBeGreaterThan(0.9);
  });
  it('is low when they share most collaborators (same scene)', () => {
    const r = bridgeScore(new Set([1,2,3,4]), new Set([1,2,3,5]), true, true);
    expect(r.score).toBeLessThan(0.5);
  });
  it('is NOT confident unless both endpoints are fully materialized', () => {
    const r = bridgeScore(new Set([1]), new Set([2]), true, false);
    expect(r.confident).toBe(false);
    expect(r.score).toBeNull();
  });
  it('returns score 0 (not NaN) for two empty sets when both are full', () => {
    const r = bridgeScore(new Set<number>(), new Set<number>(), true, true);
    expect(r.confident).toBe(true);
    expect(r.score).toBe(0);
  });
});
