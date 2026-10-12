import { describe, it, expect } from 'vitest';
import { resolveCreditSource } from '../../../src/services/constellation/resolveCreditSource.js';
import { DumpIndexService } from '../../../src/services/constellation/DumpIndexService.js';
import { LiveDiscogsCreditSource, type DiscogsCreditBackend } from '../../../src/services/constellation/LiveDiscogsCreditSource.js';
import type { CreditSource } from '../../../src/services/constellation/ExpansionService.js';

const fakeDiscogs: DiscogsCreditBackend = {
  getArtistReleases: async () => [],
  getReleaseCredits: async () => [],
};

describe('resolveCreditSource', () => {
  it('returns a DumpIndexService when the index is enabled', () => {
    const source = resolveCreditSource({
      constellationIndexEnabled: true,
      constellationIndexPath: ':memory:',
    });
    try {
      expect(source).toBeInstanceOf(DumpIndexService);
    } finally {
      (source as DumpIndexService).close();
    }
  });

  it('passes the configured index path to the (injected) index factory when enabled', () => {
    let seenPath: string | undefined;
    const sentinel = {} as CreditSource;
    const source = resolveCreditSource(
      { constellationIndexEnabled: true, constellationIndexPath: '/data/idx.db' },
      {
        makeIndexSource: (path) => {
          seenPath = path;
          return sentinel;
        },
      },
    );
    expect(seenPath).toBe('/data/idx.db');
    expect(source).toBe(sentinel);
  });

  it('returns a LiveDiscogsCreditSource when the index is disabled and a Discogs backend is provided', () => {
    const source = resolveCreditSource(
      { constellationIndexEnabled: false, constellationIndexPath: ':memory:' },
      { discogs: fakeDiscogs },
    );
    expect(source).toBeInstanceOf(LiveDiscogsCreditSource);
  });

  it('uses the injected live factory when the index is disabled (selection with fakes)', () => {
    const sentinel = {} as CreditSource;
    const source = resolveCreditSource(
      { constellationIndexEnabled: false, constellationIndexPath: ':memory:' },
      { makeLiveSource: () => sentinel },
    );
    expect(source).toBe(sentinel);
  });

  it('throws a clear error when disabled with no Discogs backend available', () => {
    expect(() =>
      resolveCreditSource({ constellationIndexEnabled: false, constellationIndexPath: ':memory:' }),
    ).toThrow(/Discogs connection/i);
  });
});
