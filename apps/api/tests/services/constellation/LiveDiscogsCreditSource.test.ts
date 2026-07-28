import { describe, it, expect, vi } from 'vitest';
import {
  LiveDiscogsCreditSource,
  type DiscogsCreditBackend,
} from '../../../src/services/constellation/LiveDiscogsCreditSource.js';
import type { DiscogsArtistReleaseItem, DiscogsCredit } from '../../../src/services/discogs.js';

function backend(overrides: Partial<DiscogsCreditBackend> = {}): DiscogsCreditBackend {
  return {
    getArtistReleases: overrides.getArtistReleases ?? (async () => []),
    getReleaseCredits: overrides.getReleaseCredits ?? (async () => []),
  };
}

describe('LiveDiscogsCreditSource.getReleaseCredits', () => {
  it('delegates to the backing DiscogsService', async () => {
    const credits: DiscogsCredit[] = [
      { artistId: 10, name: 'Jane', roles: ['producer'], masterId: 5 },
    ];
    const getReleaseCredits = vi.fn(async () => credits);
    const src = new LiveDiscogsCreditSource(backend({ getReleaseCredits }));

    const result = await src.getReleaseCredits(789);

    expect(getReleaseCredits).toHaveBeenCalledWith(789);
    expect(result).toEqual(credits);
  });
});

describe('LiveDiscogsCreditSource.getArtistReleases', () => {
  it("maps a 'release' item to releaseId=id with masterId from master_id when present", async () => {
    const items: DiscogsArtistReleaseItem[] = [
      { id: 111, type: 'release', title: 'A', year: 1999, master_id: 900 },
    ];
    const src = new LiveDiscogsCreditSource(backend({ getArtistReleases: async () => items }));

    const result = await src.getArtistReleases(42);

    expect(result).toEqual([{ releaseId: 111, masterId: 900, year: 1999, genres: [] }]);
  });

  it("maps a 'master' item to its main_release (releaseId) and id (masterId)", async () => {
    const items: DiscogsArtistReleaseItem[] = [
      { id: 222, type: 'master', title: 'B', year: 2001, main_release: 223 },
    ];
    const src = new LiveDiscogsCreditSource(backend({ getArtistReleases: async () => items }));

    const result = await src.getArtistReleases(42);

    expect(result).toEqual([{ releaseId: 223, masterId: 222, year: 2001, genres: [] }]);
  });

  it('falls back to the master id as releaseId when a master has no main_release', async () => {
    const items: DiscogsArtistReleaseItem[] = [{ id: 500, type: 'master', title: 'C' }];
    const src = new LiveDiscogsCreditSource(backend({ getArtistReleases: async () => items }));

    const result = await src.getArtistReleases(42);

    expect(result).toEqual([{ releaseId: 500, masterId: 500, year: null, genres: [] }]);
  });

  it('drops items without a usable numeric release id and normalizes missing/zero year to null', async () => {
    const items = [
      { type: 'release', title: 'no id' },
      { id: 0, type: 'release', title: 'zero id' },
      { id: 7, type: 'release', title: 'ok', year: 0 },
    ] as unknown as DiscogsArtistReleaseItem[];
    const src = new LiveDiscogsCreditSource(backend({ getArtistReleases: async () => items }));

    const result = await src.getArtistReleases(42);

    expect(result).toEqual([{ releaseId: 7, masterId: null, year: null, genres: [] }]);
  });

  it('always returns empty genres (documented live-path approximation)', async () => {
    const items: DiscogsArtistReleaseItem[] = [{ id: 1, type: 'release', year: 2010 }];
    const src = new LiveDiscogsCreditSource(backend({ getArtistReleases: async () => items }));

    const [row] = await src.getArtistReleases(42);
    expect(row.genres).toEqual([]);
  });
});
