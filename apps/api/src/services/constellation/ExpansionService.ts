import prisma from '../../lib/db.js';
import type { BaseRole } from './RoleTaxonomy.js';
import { roleWeight, rolesToBitmask } from './RoleTaxonomy.js';
import type { ReleaseRef } from './MasterDedup.js';

/**
 * The injectable seam that decouples ExpansionService from any concrete data
 * backend. Task 7 provides a SQLite-index-backed implementation; a live adapter
 * wraps DiscogsService. ExpansionService must never reference either directly.
 */
export interface CreditSource {
  /** A person's releases as {releaseId, masterId, year, genres} refs. */
  getArtistReleases(
    artistId: number,
  ): Promise<Array<{ releaseId: number; masterId: number | null; year: number | null; genres: string[] }>>;
  /** The full credit list for one release (same shape as DiscogsCredit). */
  getReleaseCredits(
    releaseId: number,
  ): Promise<Array<{ artistId: number; name: string; roles: BaseRole[]; masterId: number | null }>>;
}

/**
 * Optional collaborators for ExpansionService. `isPersonFull` is the fullness
 * seam (see fullness note below); it defaults to "nobody is known-full yet".
 */
export interface ExpansionOptions {
  /** Returns true if `personId` has already been fully expanded elsewhere. */
  isPersonFull?: (personId: number) => Promise<boolean>;
}

// Discogs non-person entities that must never become nodes/edges.
const BLACKLIST_IDS = new Set<number>([194 /* Various */]);
const BLACKLIST_NAME = /^(various|unknown artist|no artist|\[.*\])$/i;

function isBlacklisted(artistId: number, name: string | undefined): boolean {
  if (BLACKLIST_IDS.has(artistId)) return true;
  if (name && BLACKLIST_NAME.test(name.trim())) return true;
  return false;
}

// Stable master key: releases with a masterId collapse onto it; null-master
// releases key on their own release id. (Mirrors MasterDedup.masterKey.)
const masterKey = (r: ReleaseRef) => (r.masterId != null ? `m${r.masterId}` : `r${r.releaseId}`);

const RECENCY_FLOOR = 0.3;
const RECENCY_PER_YEAR = 0.02;

/**
 * Deterministic, bounded recency multiplier in (0, 1].
 * - Unknown year -> 1.0 (no penalty).
 * - Current/future year -> 1.0.
 * - Linear decay of 0.02 per year elapsed, floored at 0.3 so it never hits 0.
 */
export function recencyDecay(year: number | null, nowYear: number): number {
  if (year == null) return 1.0;
  const yearsAgo = Math.max(0, nowYear - year);
  return Math.max(RECENCY_FLOOR, 1 - yearsAgo * RECENCY_PER_YEAR);
}

interface Collab {
  name: string;
  masterKeys: Set<string>;
  roles: Set<BaseRole>;
  mostRecentYear: number | null;
  sampleMasterId: number | null;
}

/**
 * Builds the collaboration graph around a single person ("live path").
 *
 * Fullness representation:
 *   Persisted via `ConstellationPerson.fullyExpanded`. Within expandPerson(P),
 *   P is full once all its releases are processed, so P's person row is upserted
 *   with `fullyExpanded: true`; collaborator (Q) rows stay default false until
 *   they are themselves expanded. An edge's `bothEndpointsFull` is true iff BOTH
 *   endpoints are full — here P is full, so it reduces to `isPersonFull(Q)`.
 *   `isPersonFull` remains an injectable seam (tests can supply a fake); its
 *   default reads the persisted `fullyExpanded` flag. Task 13's bridgeFill
 *   recomputes edges once Q is later expanded.
 */
export class ExpansionService {
  private readonly isPersonFull: (personId: number) => Promise<boolean>;

  constructor(private source: CreditSource, options: ExpansionOptions = {}) {
    this.isPersonFull =
      options.isPersonFull ??
      (async (id: number) =>
        (await prisma.constellationPerson.findUnique({ where: { personId: id } }))?.fullyExpanded ?? false);
  }

  async expandPerson(personId: number): Promise<void> {
    // Never expand a blacklisted seed (id-based; we have no name for the seed here).
    if (isBlacklisted(personId, undefined)) return;

    const nowYear = new Date().getUTCFullYear();
    const releases = await this.source.getArtistReleases(personId);

    const collaborators = new Map<number, Collab>();
    const genreCounts = new Map<string, number>();
    let seedName: string | undefined;

    for (const release of releases) {
      const key = masterKey(release);

      for (const genre of release.genres) {
        genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      }

      const credits = await this.source.getReleaseCredits(release.releaseId);
      for (const credit of credits) {
        if (credit.artistId === personId) {
          seedName = seedName ?? credit.name;
          continue;
        }
        if (isBlacklisted(credit.artistId, credit.name)) continue;

        let collab = collaborators.get(credit.artistId);
        if (!collab) {
          collab = {
            name: credit.name,
            masterKeys: new Set<string>(),
            roles: new Set<BaseRole>(),
            mostRecentYear: null,
            sampleMasterId: null,
          };
          collaborators.set(credit.artistId, collab);
        }
        collab.masterKeys.add(key);
        for (const role of credit.roles) collab.roles.add(role);
        if (release.year != null && (collab.mostRecentYear == null || release.year > collab.mostRecentYear)) {
          collab.mostRecentYear = release.year;
        }
        if (collab.sampleMasterId == null && release.masterId != null) {
          collab.sampleMasterId = release.masterId;
        }
      }
    }

    const fetchedAt = new Date();

    // Seed person node — P is fully expanded once we reach here (set on create+update).
    await this.upsertSeedPerson(personId, seedName ?? `Artist ${personId}`);

    // Seed genres, weighted by release count.
    for (const [genre, weight] of genreCounts) {
      await prisma.constellationGenre.upsert({
        where: { personId_genre: { personId, genre } },
        create: { personId, genre, weight },
        update: { weight },
      });
    }

    for (const [qId, collab] of collaborators) {
      const unionRoles = [...collab.roles];
      // Skip zero-weight collaborators: empty/unparseable roles must not become edges.
      if (unionRoles.length === 0) continue;

      const maxRoleWeight = Math.max(...unionRoles.map(roleWeight));
      const sharedMasterCount = collab.masterKeys.size;
      const decay = recencyDecay(collab.mostRecentYear, nowYear);
      const weight = sharedMasterCount * maxRoleWeight * decay;
      if (weight <= 0) continue;

      const roleBitmask = rolesToBitmask(unionRoles);
      const bothEndpointsFull = await this.isPersonFull(qId);

      await this.upsertCollaboratorPerson(qId, collab.name);

      await this.upsertEdge(personId, qId, {
        weight,
        roleBitmask,
        sharedMasterCount,
        sampleMasterId: collab.sampleMasterId,
        bothEndpointsFull,
        fetchedAt,
      });
      await this.upsertEdge(qId, personId, {
        weight,
        roleBitmask,
        sharedMasterCount,
        sampleMasterId: collab.sampleMasterId,
        bothEndpointsFull,
        fetchedAt,
      });
    }
  }

  /** The seed P: fully expanded once this method finishes — set on create AND update. */
  private async upsertSeedPerson(personId: number, displayName: string): Promise<void> {
    await prisma.constellationPerson.upsert({
      where: { personId },
      create: { personId, displayName, fullyExpanded: true },
      update: { displayName, fullyExpanded: true },
    });
  }

  /**
   * A collaborator Q: default false on create only. The update branch never
   * touches `fullyExpanded`, so a Q that was already fully expanded by its own
   * prior expansion is not clobbered back to false.
   */
  private async upsertCollaboratorPerson(personId: number, displayName: string): Promise<void> {
    await prisma.constellationPerson.upsert({
      where: { personId },
      create: { personId, displayName, fullyExpanded: false },
      update: { displayName },
    });
  }

  private async upsertEdge(
    sourcePersonId: number,
    targetPersonId: number,
    data: {
      weight: number;
      roleBitmask: number;
      sharedMasterCount: number;
      sampleMasterId: number | null;
      bothEndpointsFull: boolean;
      fetchedAt: Date;
    },
  ): Promise<void> {
    await prisma.constellationEdge.upsert({
      where: { sourcePersonId_targetPersonId: { sourcePersonId, targetPersonId } },
      create: { sourcePersonId, targetPersonId, ...data },
      update: { ...data },
    });
  }
}
