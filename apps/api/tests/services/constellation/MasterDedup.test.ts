import { describe, it, expect } from 'vitest';
import { dedupToMasters, sharedMasterCount } from '../../../src/services/constellation/MasterDedup.js';

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
});
