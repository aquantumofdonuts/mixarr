/**
 * OrbitSeedCollector — collects, tiers, resolves, and de-duplicates the seed
 * artists that warm a single user's taste orbit into the constellation cache.
 *
 * WHY TIERS: the crawl (Task 9's {@link OrbitCrawler}) is breadth-first under a
 * hard edge budget, so the ORDER seeds are handed to it decides which slice of a
 * user's taste gets materialized when the budget runs out. We seed by RECENCY:
 * what you played today (`hist1d`) is nearer than this week (`hist7d`), this
 * month (`hist30d`), your library favourites (`libtop`), then the rest of your
 * library (`lib`). The crawler fills nearest tiers first. (`frontier` exists in
 * the schema for later expansion rings but is not a seed tier.)
 *
 * PURE OVER AN INJECTED SEAM: this class references no Prisma and no concrete
 * listening-history/library service — only the {@link SeedSource} seam (which
 * yields artist identifiers) and a `resolveMbid` function (= IdentityService's
 * `mbidToDiscogs`). That keeps collection unit-testable with fakes; production
 * wiring of which service feeds which tier lives in the worker (Task 10 part C).
 */

/** The recency/library tiers a seed can belong to, NEAREST first. */
export type OrbitTier = 'hist1d' | 'hist7d' | 'hist30d' | 'libtop' | 'lib';

/**
 * Canonical nearest-first tier ordering. Output is sorted by this, and dedupe
 * keeps a person in the earliest (nearest) tier it appears in. Sources may be
 * passed in any order; this array — not call order — defines precedence.
 */
export const ORBIT_TIER_ORDER: readonly OrbitTier[] = [
  'hist1d',
  'hist7d',
  'hist30d',
  'libtop',
  'lib',
];

/**
 * One tier's supply of seed artists. `getArtists` returns loosely-typed identity
 * refs: a Discogs person id is used directly; an MBID is resolved via the
 * injected resolver; a name-only ref is out of scope for this task and skipped.
 */
export interface SeedSource {
  tier: OrbitTier;
  getArtists(): Promise<Array<{ mbid?: string; discogsId?: number; name?: string }>>;
}

import { createLogger } from '../../lib/logger.js';

const logger = createLogger('OrbitSeedCollector');

export class OrbitSeedCollector {
  /**
   * @param resolveMbid Resolve an MBID to a Discogs person id (null if it can't
   *   be resolved). In production this is `IdentityService.mbidToDiscogs`.
   */
  constructor(private resolveMbid: (mbid: string) => Promise<number | null>) {}

  /**
   * Collect every source, resolve each ref to a Discogs person id, and return a
   * tiered, de-duplicated seed list ordered NEAREST tier first.
   *
   * Guarantees:
   *  - tier ORDER: output follows {@link ORBIT_TIER_ORDER}, not source call order;
   *  - resolution: `discogsId` wins; else `mbid` is resolved; else the ref is
   *    skipped (name-only resolution is out of scope for this task);
   *  - unresolvable refs are skipped, never thrown;
   *  - DEDUPE: a person appearing in several tiers is kept only in its NEAREST
   *    tier (and duplicates within a tier collapse to one);
   *  - resilience: a source whose `getArtists` throws is logged and skipped so
   *    the remaining sources still contribute.
   */
  async collect(sources: SeedSource[]): Promise<Array<{ tier: OrbitTier; personId: number }>> {
    // Bucket resolved person ids per tier, preserving first-seen order within a
    // tier. A Set per tier collapses intra-tier duplicates.
    const perTier = new Map<OrbitTier, number[]>();
    const seenInTier = new Map<OrbitTier, Set<number>>();
    for (const tier of ORBIT_TIER_ORDER) {
      perTier.set(tier, []);
      seenInTier.set(tier, new Set<number>());
    }

    for (const src of sources) {
      let refs: Awaited<ReturnType<SeedSource['getArtists']>>;
      try {
        refs = await src.getArtists();
      } catch (err) {
        // One dead source (e.g. Last.fm down) must not abort the whole collect.
        logger.warn(
          `Seed source for tier '${src.tier}' failed, skipping: ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      const bucket = perTier.get(src.tier);
      const seen = seenInTier.get(src.tier);
      // Unknown tier (should not happen given the SeedSource type) — skip safely.
      if (!bucket || !seen) continue;

      for (const ref of refs) {
        const personId = await this.resolve(ref);
        if (personId === null) continue;
        if (seen.has(personId)) continue;
        seen.add(personId);
        bucket.push(personId);
      }
    }

    // Flatten in nearest-first tier order, dropping any person already emitted in
    // a nearer tier so it is kept only in its NEAREST tier.
    const emitted = new Set<number>();
    const result: Array<{ tier: OrbitTier; personId: number }> = [];
    for (const tier of ORBIT_TIER_ORDER) {
      for (const personId of perTier.get(tier) ?? []) {
        if (emitted.has(personId)) continue;
        emitted.add(personId);
        result.push({ tier, personId });
      }
    }
    return result;
  }

  /** Resolve one ref to a Discogs person id, or null if it can't be resolved. */
  private async resolve(ref: { mbid?: string; discogsId?: number; name?: string }): Promise<number | null> {
    if (ref.discogsId != null) return ref.discogsId;
    if (ref.mbid) {
      try {
        return await this.resolveMbid(ref.mbid);
      } catch (err) {
        // resolveMbid is documented as never-throwing, but stay defensive: a
        // resolver failure skips this one ref, it never aborts collection.
        logger.debug(`Mbid resolution failed for '${ref.mbid}': ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }
    // Name-only refs: name -> discogs resolution is out of scope for this task.
    return null;
  }
}
