import type { CreditSource } from './ExpansionService.js';
import type { BaseRole } from './RoleTaxonomy.js';
import type { DiscogsArtistReleaseItem, DiscogsCredit } from '../discogs.js';

/**
 * The subset of {@link DiscogsService} this adapter depends on. Declaring it as an
 * interface keeps the adapter unit-testable with a fake backend (no live fetch)
 * and documents exactly what the live CreditSource needs.
 */
export interface DiscogsCreditBackend {
  getArtistReleases(artistId: number, opts?: { maxPages?: number }): Promise<DiscogsArtistReleaseItem[]>;
  getReleaseCredits(releaseId: number): Promise<DiscogsCredit[]>;
}

/**
 * Live Discogs {@link CreditSource} — the "Setting-OFF" data backend that wraps a
 * {@link DiscogsService} so {@link ExpansionService} can expand a person straight
 * off the Discogs API. It is interchangeable with the SQLite-index-backed
 * {@link DumpIndexService} because it satisfies the same contract.
 *
 * ## Mapping / approximation notes
 * - **genres**: ALWAYS returned as `[]`. The `/artists/{id}/releases` listing does
 *   not carry per-release genre/style; obtaining them would require an extra
 *   `/releases/{id}` detail fetch PER release, doubling the live API cost. Genre
 *   affinity ({@link ExpansionService} `ConstellationGenre` weights) is therefore
 *   NOT populated on the live path — collaboration EDGES, the primary output, are
 *   unaffected because they come from {@link getReleaseCredits}, which fetches the
 *   release detail per release regardless. On the "Setting-ON" (dump index) path
 *   genres are present, so genre affinity is a Setting-ON enrichment.
 * - **masterId**: for a `type: 'master'` item the listing exposes both the master
 *   id (`id`) and its representative release (`main_release`), so we map
 *   `releaseId = main_release` and `masterId = id`. For a `type: 'release'` item
 *   the listing rarely carries `master_id`; when absent `masterId` is null (the
 *   authoritative master_id is still carried onto each credit by
 *   {@link getReleaseCredits}). This only affects reissue de-duplication keys,
 *   which degrade gracefully (a release with no master is keyed by its own id).
 */
export class LiveDiscogsCreditSource implements CreditSource {
  constructor(private readonly discogs: DiscogsCreditBackend) {}

  async getArtistReleases(
    artistId: number,
  ): Promise<Array<{ releaseId: number; masterId: number | null; year: number | null; genres: string[] }>> {
    const items = await this.discogs.getArtistReleases(artistId);

    const out: Array<{ releaseId: number; masterId: number | null; year: number | null; genres: string[] }> = [];
    for (const item of items) {
      const isMaster = item.type === 'master';
      // For masters, prefer the representative release id; fall back to the master
      // id itself so the release is still traversable for credits.
      const releaseId = isMaster ? (item.main_release ?? item.id) : item.id;
      if (typeof releaseId !== 'number' || releaseId <= 0) continue;

      const masterId = isMaster
        ? (typeof item.id === 'number' && item.id > 0 ? item.id : null)
        : (typeof item.master_id === 'number' && item.master_id > 0 ? item.master_id : null);

      const year = typeof item.year === 'number' && item.year > 0 ? item.year : null;

      out.push({ releaseId, masterId, year, genres: [] });
    }
    return out;
  }

  async getReleaseCredits(
    releaseId: number,
  ): Promise<Array<{ artistId: number; name: string; roles: BaseRole[]; masterId: number | null }>> {
    return this.discogs.getReleaseCredits(releaseId);
  }
}
