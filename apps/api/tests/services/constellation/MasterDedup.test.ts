import { describe, it, expect } from 'vitest';
import { dedupToMasters, sharedMasterCount, masterKey } from '../../../src/services/constellation/MasterDedup.js';

describe('MasterDedup', () => {
  it('collapses many releases of the same master to one', () => {
    const releases = [
      { releaseId: 1, masterId: 100 }, { releaseId: 2, masterId: 100 },
      { releaseId: 3, masterId: 200 }, { releaseId: 4, masterId: null },
    ];
    // master 100 (x2 releases), master 200, and a null-master release kept as its own release-id key
    expect(dedupToMasters(releases).size).toBe(3);
  });
  it('counts shared masters between two credit lists, not shared releases', () => {
    const a = [{ releaseId: 1, masterId: 100 }, { releaseId: 2, masterId: 100 }];
    const b = [{ releaseId: 9, masterId: 100 }];
    expect(sharedMasterCount(a, b)).toBe(1); // same master via different pressings
  });
  it('returns an empty set for empty input', () => {
    expect(dedupToMasters([]).size).toBe(0);
  });
  it('counts zero shared masters for disjoint lists', () => {
    expect(sharedMasterCount([{ releaseId: 1, masterId: 100 }], [{ releaseId: 2, masterId: 200 }])).toBe(0);
  });
  it('exposes masterKey: master-keyed when masterId present, release-keyed when null', () => {
    expect(masterKey({ releaseId: 2, masterId: 100 })).toBe('m100');
    expect(masterKey({ releaseId: 7, masterId: null })).toBe('r7');
  });
  it('keeps two distinct null-master releases separate', () => {
    // Deliberate: null-master releases key on their own release id, so they never collapse together.
    expect(dedupToMasters([{ releaseId: 5, masterId: null }, { releaseId: 6, masterId: null }]).size).toBe(2);
  });
});
