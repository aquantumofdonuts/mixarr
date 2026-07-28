import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('returns an empty array for an unknown artist or release', async () => {
    const idx = seed();
    expect(await idx.getArtistReleases(999)).toEqual([]);
    expect(await idx.getReleaseCredits(999)).toEqual([]);
    idx.close();
  });

  it('getArtistReleases returns a release that has a credit but NO release_meta (LEFT JOIN)', async () => {
    const idx = new DumpIndexService(':memory:');
    idx.upsertArtist(1, 'Alice');
    // Credit exists, but setReleaseMeta was never called for release 500.
    idx.addCredit({ releaseId: 500, artistId: 1, role: 'Bass', masterId: null });
    const releases = await idx.getArtistReleases(1);
    // An INNER JOIN regression would drop this row entirely.
    expect(releases).toEqual([{ releaseId: 500, masterId: null, year: null, genres: [] }]);
    idx.close();
  });

  it('deduplicates identical credit and artist_release rows via INSERT OR IGNORE', async () => {
    const idx = new DumpIndexService(':memory:');
    idx.upsertArtist(1, 'Alice');
    idx.setReleaseMeta({ releaseId: 100, masterId: 900, year: 2000, genres: [] });
    // The dump can emit the exact same line twice.
    idx.addCredit({ releaseId: 100, artistId: 1, role: 'Bass', masterId: 900 });
    idx.addCredit({ releaseId: 100, artistId: 1, role: 'Bass', masterId: 900 });
    // One link row per pair (not duplicated).
    expect(await idx.getArtistReleases(1)).toEqual([
      { releaseId: 100, masterId: 900, year: 2000, genres: [] },
    ]);
    const credits = await idx.getReleaseCredits(100);
    expect(credits).toHaveLength(1);
    expect(credits[0].roles).toEqual(['performer']);
    idx.close();
  });

  describe('file-based persistence + real idempotency', () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('persists to a real file and re-opening re-runs initSchema without error', async () => {
      dir = mkdtempSync(join(tmpdir(), 'dumpindex-'));
      const dbPath = join(dir, 'index.db');

      // First session: write and close.
      const first = new DumpIndexService(dbPath);
      first.upsertArtist(1, 'Alice');
      first.setReleaseMeta({ releaseId: 100, masterId: 900, year: 1999, genres: ['Rock'] });
      first.addCredit({ releaseId: 100, artistId: 1, role: 'Producer', masterId: 900 });
      first.setIndexVersion(3);
      first.close();

      expect(existsSync(dbPath)).toBe(true);

      // Second session on the SAME file: initSchema runs over a populated
      // schema (the real idempotency check) and must not throw.
      const second = new DumpIndexService(dbPath);
      try {
        expect(second.getIndexVersion()).toBe(3);
        expect(await second.getArtistReleases(1)).toEqual([
          { releaseId: 100, masterId: 900, year: 1999, genres: ['Rock'] },
        ]);
        const credits = await second.getReleaseCredits(100);
        expect(credits).toEqual([{ artistId: 1, name: 'Alice', roles: ['producer'], masterId: 900 }]);
      } finally {
        second.close();
      }
    });
  });

  describe('parent-directory creation', () => {
    let dir: string;

    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('creates a missing parent directory for a file path and opens the DB', async () => {
      // Root temp dir exists; the NESTED parent of the db file does NOT yet.
      dir = mkdtempSync(join(tmpdir(), 'constellation-'));
      const dbPath = join(dir, 'nested', 'index.db');
      expect(existsSync(join(dir, 'nested'))).toBe(false);

      // Constructor must mkdir -p the parent and open without an
      // "unable to open database file" error.
      const idx = new DumpIndexService(dbPath);
      try {
        expect(existsSync(dbPath)).toBe(true);
        idx.upsertArtist(1, 'Alice');
        idx.setReleaseMeta({ releaseId: 100, masterId: null, year: 2000, genres: [] });
        idx.addCredit({ releaseId: 100, artistId: 1, role: 'Bass', masterId: null });
        expect(await idx.getArtistReleases(1)).toEqual([
          { releaseId: 100, masterId: null, year: 2000, genres: [] },
        ]);
      } finally {
        idx.close();
      }
    });

    it(':memory: opens without touching the filesystem (no mkdir)', () => {
      // A ':memory:' DB must not create a directory named ':memory:' anywhere.
      const idx = new DumpIndexService(':memory:');
      try {
        expect(existsSync(':memory:')).toBe(false);
        expect(idx.getIndexVersion()).toBeNull();
      } finally {
        idx.close();
      }
    });
  });

  describe('transaction()', () => {
    it('commits all writes made inside one transaction', async () => {
      const idx = new DumpIndexService(':memory:');
      idx.setReleaseMeta({ releaseId: 100, masterId: 900, year: 2000, genres: [] });
      idx.transaction((db) => {
        db.upsertArtist(1, 'Alice');
        db.upsertArtist(2, 'Bob');
        db.addCredit({ releaseId: 100, artistId: 1, role: 'Bass', masterId: 900 });
        db.addCredit({ releaseId: 100, artistId: 2, role: 'Guitar', masterId: 900 });
      });
      const credits = await idx.getReleaseCredits(100);
      expect(credits.map((c) => c.artistId).sort()).toEqual([1, 2]);
      idx.close();
    });

    it('rolls back every write when the transaction body throws', async () => {
      const idx = new DumpIndexService(':memory:');
      idx.setReleaseMeta({ releaseId: 100, masterId: 900, year: 2000, genres: [] });
      expect(() =>
        idx.transaction((db) => {
          db.upsertArtist(1, 'Alice');
          db.addCredit({ releaseId: 100, artistId: 1, role: 'Bass', masterId: 900 });
          throw new Error('boom');
        }),
      ).toThrow('boom');
      // No partial rows survived the rollback.
      expect(await idx.getArtistReleases(1)).toEqual([]);
      expect(await idx.getReleaseCredits(100)).toEqual([]);
      idx.close();
    });
  });
});
