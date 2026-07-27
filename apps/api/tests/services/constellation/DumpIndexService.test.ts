import { describe, it, expect } from 'vitest';
import { DumpIndexService } from '../../../src/services/constellation/DumpIndexService.js';

/**
 * DumpIndexService is exercised entirely against an in-memory SQLite database
 * (`:memory:`) so the tests are hermetic and need no filesystem or network.
 */
function seed(): DumpIndexService {
  const idx = new DumpIndexService(':memory:');

  // Artists.
  idx.upsertArtist(1, 'Alice');
  idx.upsertArtist(2, 'Bob');
  idx.upsertArtist(3, 'Carol');

  // Release meta (release 100 belongs to master 900; release 101 has no master).
  idx.setReleaseMeta({ releaseId: 100, masterId: 900, year: 1999, genres: ['Rock', 'Jazz'] });
  idx.setReleaseMeta({ releaseId: 101, masterId: null, year: 2005, genres: [] });

  // Alice (1) appears on both releases.
  idx.addCredit({ releaseId: 100, artistId: 1, role: 'Bass [Fretless]', masterId: 900 });
  idx.addCredit({ releaseId: 101, artistId: 1, role: 'Producer', masterId: null });

  // On release 100: Bob has two separate raw-role rows that must merge/union.
  idx.addCredit({ releaseId: 100, artistId: 2, role: 'Guitar', masterId: 900 });
  idx.addCredit({ releaseId: 100, artistId: 2, role: 'Producer', masterId: 900 });
  // Carol on release 100 with a role that normalizes to two base roles.
  idx.addCredit({ releaseId: 100, artistId: 3, role: 'Producer, Mixed By', masterId: 900 });

  idx.setIndexVersion(7);
  return idx;
}

describe('DumpIndexService', () => {
  it('getArtistReleases returns release refs with parsed genres and year', async () => {
    const idx = seed();
    const releases = await idx.getArtistReleases(1);
    releases.sort((a, b) => a.releaseId - b.releaseId);
    expect(releases).toEqual([
      { releaseId: 100, masterId: 900, year: 1999, genres: ['Rock', 'Jazz'] },
      { releaseId: 101, masterId: null, year: 2005, genres: [] },
    ]);
    idx.close();
  });

  it('getReleaseCredits joins names and normalizes roles to BaseRole[]', async () => {
    const idx = seed();
    const credits = await idx.getReleaseCredits(100);
    credits.sort((a, b) => a.artistId - b.artistId);

    expect(credits).toHaveLength(3);

    const alice = credits.find((c) => c.artistId === 1)!;
    expect(alice.name).toBe('Alice');
    expect(alice.masterId).toBe(900);
    expect(alice.roles.sort()).toEqual(['performer']);

    idx.close();
  });

  it('merges/unions multiple role rows for the same artist on a release', async () => {
    const idx = seed();
    const credits = await idx.getReleaseCredits(100);
    const bob = credits.find((c) => c.artistId === 2)!;
    expect(bob.name).toBe('Bob');
    // Guitar -> performer, Producer -> producer; unioned into one entry.
    expect(bob.roles.sort()).toEqual(['performer', 'producer']);

    const carol = credits.find((c) => c.artistId === 3)!;
    // "Producer, Mixed By" -> producer + engineer.
    expect(carol.roles.sort()).toEqual(['engineer', 'producer']);
    idx.close();
  });

  it('getIndexVersion round-trips', async () => {
    const idx = seed();
    expect(idx.getIndexVersion()).toBe(7);
    idx.setIndexVersion(42);
    expect(idx.getIndexVersion()).toBe(42);
    idx.close();
  });

  it('creates schema idempotently (opening/initializing twice does not error)', () => {
    const first = new DumpIndexService(':memory:');
    first.upsertArtist(1, 'Alice');
    first.close();
    // A brand-new in-memory instance re-creates the schema without error.
    expect(() => {
      const second = new DumpIndexService(':memory:');
      second.close();
    }).not.toThrow();
  });

  it('returns an empty array for an unknown artist or release', async () => {
    const idx = seed();
    expect(await idx.getArtistReleases(999)).toEqual([]);
    expect(await idx.getReleaseCredits(999)).toEqual([]);
    idx.close();
  });
});
