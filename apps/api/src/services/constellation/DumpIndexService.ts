import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase, Statement } from 'better-sqlite3';
import type { CreditSource } from './ExpansionService.js';
import { normalizeRole, type BaseRole } from './RoleTaxonomy.js';

/**
 * A compact local index built from the Discogs data dump (Task 8 fills it),
 * read by the OrbitCrawler/ExpansionService with zero network access. It is the
 * "Setting-ON" data source and is interchangeable with the live Discogs adapter
 * because it satisfies the same {@link CreditSource} contract.
 *
 * Storage decisions:
 * - **Genres** are stored as a JSON array string in `release_meta.genres`
 *   (e.g. `["Rock","Jazz"]`) and parsed back to `string[]` on read.
 * - **Roles** are stored RAW (the original Discogs role strings, one row per
 *   raw role) in `release_credit.role`. They are run through {@link normalizeRole}
 *   at read time in `getReleaseCredits`. Storing raw keeps the index faithful to
 *   the source so the taxonomy can evolve without re-importing the dump.
 *
 * better-sqlite3 is a synchronous native module. The reader methods satisfy the
 * async {@link CreditSource} interface by wrapping the synchronous queries in
 * `async` methods (they return already-resolved Promises). This is fine because
 * the index is consumed inside background workers.
 *
 * Lifecycle: the CONSUMER owns the database handle. Whoever constructs a
 * DumpIndexService must call {@link close} when done — in a `finally` block so
 * the handle is released even on error (the Task 8 import worker and the Task 9
 * crawler both do this).
 */
export class DumpIndexService implements CreditSource {
  private readonly db: BetterSqliteDatabase;

  // Prepared statements — created once, reused for every call (fast path).
  private readonly stmtUpsertArtist: Statement;
  private readonly stmtAddCredit: Statement;
  private readonly stmtLinkArtistRelease: Statement;
  private readonly stmtSetReleaseMeta: Statement;
  private readonly stmtSetMeta: Statement;
  private readonly stmtGetMeta: Statement;
  private readonly stmtGetArtistReleases: Statement;
  private readonly stmtGetReleaseCredits: Statement;

  /**
   * @param path Filesystem path to the SQLite database, or `:memory:` for an
   *   ephemeral in-memory DB (used by tests). No production path is hardcoded;
   *   the settings layer (Task 16) is responsible for supplying one.
   */
  constructor(path: string) {
    this.db = new Database(path);
    // WAL improves concurrent read/write throughput for on-disk databases.
    // (No-op / harmless for :memory:.)
    this.db.pragma('journal_mode = WAL');
    this.initSchema();

    this.stmtUpsertArtist = this.db.prepare(
      'INSERT INTO artist (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
    );
    this.stmtAddCredit = this.db.prepare(
      'INSERT OR IGNORE INTO release_credit (release_id, artist_id, role, master_id) VALUES (?, ?, ?, ?)',
    );
    this.stmtLinkArtistRelease = this.db.prepare(
      'INSERT OR IGNORE INTO artist_release (artist_id, release_id) VALUES (?, ?)',
    );
    this.stmtSetReleaseMeta = this.db.prepare(
      `INSERT INTO release_meta (release_id, master_id, year, genres) VALUES (@releaseId, @masterId, @year, @genres)
       ON CONFLICT(release_id) DO UPDATE SET master_id = excluded.master_id, year = excluded.year, genres = excluded.genres`,
    );
    this.stmtSetMeta = this.db.prepare(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.stmtGetMeta = this.db.prepare('SELECT value FROM meta WHERE key = ?');
    this.stmtGetArtistReleases = this.db.prepare(
      `SELECT ar.release_id AS releaseId, rm.master_id AS masterId, rm.year AS year, rm.genres AS genres
       FROM artist_release ar
       LEFT JOIN release_meta rm ON rm.release_id = ar.release_id
       WHERE ar.artist_id = ?`,
    );
    this.stmtGetReleaseCredits = this.db.prepare(
      `SELECT rc.artist_id AS artistId, a.name AS name, rc.role AS role, rc.master_id AS masterId
       FROM release_credit rc
       LEFT JOIN artist a ON a.id = rc.artist_id
       WHERE rc.release_id = ?`,
    );
  }

  private initSchema(): void {
    // `IF NOT EXISTS` everywhere makes construction idempotent — opening an
    // existing database (or opening twice) never errors.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artist (
        id INTEGER PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE IF NOT EXISTS artist_release (
        artist_id INTEGER,
        release_id INTEGER,
        UNIQUE(artist_id, release_id)
      );
      CREATE INDEX IF NOT EXISTS idx_artist_release_artist_id ON artist_release (artist_id);
      CREATE TABLE IF NOT EXISTS release_credit (
        release_id INTEGER,
        artist_id INTEGER,
        role TEXT,
        master_id INTEGER,
        UNIQUE(release_id, artist_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_release_credit_release_id ON release_credit (release_id);
      CREATE TABLE IF NOT EXISTS release_meta (
        release_id INTEGER PRIMARY KEY,
        master_id INTEGER,
        year INTEGER,
        genres TEXT
      );
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  // ---------------------------------------------------------------------------
  // Writer methods (used by Task 8's dump-import worker).
  // ---------------------------------------------------------------------------

  /** Insert or update a person's display name. */
  upsertArtist(id: number, name: string): void {
    this.stmtUpsertArtist.run(id, name);
  }

  /**
   * Record one credit row (one raw role). Also records the artist↔release link
   * in `artist_release` so `getArtistReleases` can find it. Roles are stored raw;
   * an artist appearing under several raw roles on the same release produces
   * several rows here (unioned at read time).
   */
  addCredit(credit: { releaseId: number; artistId: number; role: string; masterId: number | null }): void {
    this.stmtAddCredit.run(credit.releaseId, credit.artistId, credit.role, credit.masterId);
    this.stmtLinkArtistRelease.run(credit.artistId, credit.releaseId);
  }

  /** Insert or replace the metadata (master/year/genres) for a release. */
  setReleaseMeta(meta: { releaseId: number; masterId: number | null; year: number | null; genres: string[] }): void {
    this.stmtSetReleaseMeta.run({
      releaseId: meta.releaseId,
      masterId: meta.masterId,
      year: meta.year,
      genres: JSON.stringify(meta.genres ?? []),
    });
  }

  /** Persist the index schema/content version under `meta.index_version`. */
  setIndexVersion(n: number): void {
    this.stmtSetMeta.run('index_version', String(n));
  }

  /**
   * Run a batch of writes inside a single transaction for speed. The callback
   * receives `this` so the import worker can call the writer methods normally.
   */
  transaction<T>(fn: (idx: this) => T): T {
    return this.db.transaction(() => fn(this))();
  }

  /** Close the underlying database handle. */
  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------------------
  // Reader methods (CreditSource contract — async wrappers over sync queries).
  // ---------------------------------------------------------------------------

  async getArtistReleases(
    artistId: number,
  ): Promise<Array<{ releaseId: number; masterId: number | null; year: number | null; genres: string[] }>> {
    const rows = this.stmtGetArtistReleases.all(artistId) as Array<{
      releaseId: number;
      masterId: number | null;
      year: number | null;
      genres: string | null;
    }>;
    return rows.map((r) => ({
      releaseId: r.releaseId,
      masterId: r.masterId ?? null,
      year: r.year ?? null,
      genres: parseGenres(r.genres),
    }));
  }

  async getReleaseCredits(
    releaseId: number,
  ): Promise<Array<{ artistId: number; name: string; roles: BaseRole[]; masterId: number | null }>> {
    const rows = this.stmtGetReleaseCredits.all(releaseId) as Array<{
      artistId: number;
      name: string | null;
      role: string | null;
      masterId: number | null;
    }>;

    // Merge by artistId, unioning the normalized roles across every raw-role row
    // (mirrors the live Discogs adapter's merge behavior).
    const byArtist = new Map<number, { name: string; roles: Set<BaseRole>; masterId: number | null }>();
    for (const row of rows) {
      let entry = byArtist.get(row.artistId);
      if (!entry) {
        entry = { name: row.name ?? '', roles: new Set<BaseRole>(), masterId: row.masterId ?? null };
        byArtist.set(row.artistId, entry);
      }
      for (const role of normalizeRole(row.role ?? '')) {
        entry.roles.add(role);
      }
    }

    return [...byArtist.entries()].map(([artistId, { name, roles, masterId }]) => ({
      artistId,
      name,
      roles: [...roles],
      masterId,
    }));
  }

  /** Read back the persisted `index_version` (null if never set). */
  getIndexVersion(): number | null {
    const row = this.stmtGetMeta.get('index_version') as { value: string } | undefined;
    return row ? Number(row.value) : null;
  }
}

/** Parse the stored JSON-array genres string back into `string[]`. */
function parseGenres(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
