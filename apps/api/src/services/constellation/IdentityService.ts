/**
 * IdentityService — Discogs → MusicBrainz identity resolution.
 *
 * The Collaboration Constellation graph lives in Discogs ID space, but Lidarr
 * adds artists by MBID and the "owned ring" checks library MBIDs. Resolving a
 * Discogs person to a MusicBrainz MBID is therefore the critical join for the
 * acquisition loop (Design §13). Resolution is bounded (only ever called for
 * visible nodes + the user's library set) and cached forever in
 * `ConstellationIdentity`.
 *
 * Resolution strategy, in order:
 *   1. Cache          — a stored ConstellationIdentity row wins, no network.
 *   2. Linked         — MB `/url` relationship (Discogs artist page → MB artist).
 *                       The clean, curated join key. confidence='linked'.
 *   3. Corroborated   — MB artist name search, then confirm by comparing the
 *                       candidate's MB discography titles against the Discogs
 *                       artist's release titles. Guards against fusing two
 *                       different people who happen to share a name.
 *                       confidence='corroborated'.
 *   4. Manual         — a name candidate exists but discography overlap is empty
 *                       (ambiguous), or nothing matched at all. Not cached; the
 *                       UI later offers a manual "link to MusicBrainz" picker.
 *
 * ## Design decisions
 * - **Corroboration threshold:** ≥ 1 NON-GENERIC normalized-title match between
 *   the MB candidate's release-group titles and the Discogs artist's release
 *   titles. A single shared *distinctive* record is strong evidence two credits
 *   are the same person given the name already matched; higher thresholds
 *   discard legitimate matches for artists with short or partially-catalogued
 *   discographies.
 * - **Generic-title stoplist:** titles like "Greatest Hits", "Live", "Untitled"
 *   recur across unrelated artists and must NOT count toward overlap, or two
 *   different same-named people get fused (and the wrong MBID cached forever,
 *   driving a wrong Lidarr add). See {@link GENERIC_TITLES}.
 * - **Uniqueness rule:** compute non-generic overlap for EVERY candidate. Accept
 *   (corroborated) only if EXACTLY ONE candidate has ≥1 non-generic overlap.
 *   Zero overlapping candidates → manual. Two or more overlapping candidates →
 *   ambiguous → manual (never arbitrarily pick the top-scored one).
 * - **Title normalization:** lowercase, strip punctuation/symbols to spaces,
 *   collapse whitespace, trim. (`normalizeTitle`.) This makes "Blue Album!" and
 *   "blue album" compare equal across the two catalogues.
 * - **Discogs discography seam:** injected as `getDiscogsReleaseTitles` so the
 *   corroboration step is testable without a live Discogs call and not coupled
 *   to a token-bearing DiscogsService. Defaults to a real implementation that
 *   fetches the public Discogs artist-releases endpoint behind
 *   `rateLimit('discogs')`.
 */

import { rateLimit } from '../rate-limiter.js';
import { fetchWithTimeout } from '../../lib/fetch-with-timeout.js';
import { MusicBrainzService } from '../musicbrainz.js';
import prisma from '../../lib/db.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('IdentityService');

const DISCOGS_API_TIMEOUT = 15_000;
const IDENTITY_SOURCE = 'mb';

export type IdentityConfidence = 'linked' | 'corroborated' | 'manual';

/**
 * Normalized release titles too generic to corroborate identity — they recur
 * across unrelated artists, so a shared occurrence proves nothing. Excluded from
 * the overlap comparison. (Values are already {@link normalizeTitle}-normalized.)
 */
const GENERIC_TITLES = new Set<string>([
  'greatest hits',
  'the best of',
  'best of',
  'live',
  'untitled',
  'demo',
  'demos',
  'compilation',
  'unreleased',
  'singles',
  'ep',
  's t', // "s/t"
  'self titled',
]);

export interface DiscogsToMbidResult {
  mbid: string | null;
  confidence: IdentityConfidence | null;
  needsManual: boolean;
}

/**
 * A user-library source that yields the artist MBIDs it holds. Injected seam so
 * {@link IdentityService.buildOwnedSet} stays testable with fakes; production
 * wiring (Task 15) supplies real adapters over the lidarr/plex/jellyfin
 * services — this service must NOT couple to them directly.
 */
export interface OwnedSourceProvider {
  source: 'lidarr' | 'plex' | 'jellyfin';
  getArtistMbids(): Promise<string[]>;
}

export interface IdentityServiceDeps {
  mb?: MusicBrainzService;
  /**
   * Returns the Discogs artist's release/discography titles. Injected seam so
   * corroboration is testable; defaults to {@link fetchDiscogsReleaseTitles}.
   */
  getDiscogsReleaseTitles?: (discogsArtistId: number) => Promise<string[]>;
}

/**
 * Normalize a release title for cross-catalogue comparison: lowercase, replace
 * any non-alphanumeric run with a single space, collapse and trim.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Default, real implementation of the Discogs discography seam. Fetches the
 * public artist-releases endpoint and returns each release's title. Failures
 * degrade to an empty list (corroboration then simply can't confirm).
 */
export async function fetchDiscogsReleaseTitles(discogsArtistId: number): Promise<string[]> {
  await rateLimit('discogs');
  try {
    const response = await fetchWithTimeout(
      `https://api.discogs.com/artists/${discogsArtistId}/releases?per_page=100`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mixarr/2.0.0 (https://github.com/aquantumofdonuts/mixarr)',
        },
        timeout: DISCOGS_API_TIMEOUT,
      }
    );
    if (!response.ok) return [];
    const data = (await response.json()) as { releases?: Array<{ title?: string }> };
    return (data.releases ?? []).map(r => r.title ?? '').filter(t => t.length > 0);
  } catch (error) {
    logger.debug(`Discogs discography fetch failed for artist ${discogsArtistId}: ${error}`);
    return [];
  }
}

export class IdentityService {
  private mb: MusicBrainzService;
  private getDiscogsReleaseTitles: (discogsArtistId: number) => Promise<string[]>;

  constructor(deps: IdentityServiceDeps = {}) {
    this.mb = deps.mb ?? new MusicBrainzService();
    this.getDiscogsReleaseTitles = deps.getDiscogsReleaseTitles ?? fetchDiscogsReleaseTitles;
  }

  /**
   * Resolve a Discogs artist id to a MusicBrainz MBID. See class docs for the
   * cache → linked → corroborated → manual strategy.
   */
  async discogsToMbid(discogsArtistId: number, name?: string): Promise<DiscogsToMbidResult> {
    // 1. Cache first — a stored identity wins with no network.
    const cached = await prisma.constellationIdentity.findUnique({
      where: { personId_source: { personId: discogsArtistId, source: IDENTITY_SOURCE } },
    });
    if (cached) {
      return {
        mbid: cached.externalId,
        confidence: cached.confidence as IdentityConfidence,
        needsManual: false,
      };
    }

    // 2. Linked — MB URL relationship from the Discogs artist page.
    const resource = `https://www.discogs.com/artist/${discogsArtistId}`;
    const linkedMbid = await this.mb.lookupArtistMbidByUrl(resource);
    if (linkedMbid) {
      await this.cache(discogsArtistId, linkedMbid, 'linked');
      return { mbid: linkedMbid, confidence: 'linked', needsManual: false };
    }

    // 3. Corroborated — name search confirmed by a UNIQUE non-generic
    //    discography overlap. MB calls here degrade to manual on failure
    //    (matching the linked path) rather than throwing to the caller.
    if (name) {
      try {
        const candidates = await this.mb.searchArtist(name, 5);
        if (candidates.length === 0) {
          // No name candidate at all — manual (the user can search).
          return { mbid: null, confidence: null, needsManual: true };
        }

        const discogsTitles = new Set(
          (await this.getDiscogsReleaseTitles(discogsArtistId))
            .map(normalizeTitle)
            .filter(t => t.length > 0 && !GENERIC_TITLES.has(t))
        );

        if (discogsTitles.size > 0) {
          // Compute non-generic overlap for EVERY candidate; only a unique
          // overlapping candidate is safe to accept.
          const overlapping: string[] = [];
          for (const candidate of candidates) {
            const { releaseGroups } = await this.mb.getArtistReleases(candidate.id);
            const hasOverlap = releaseGroups.some(rg => {
              const t = normalizeTitle(rg.title);
              return t.length > 0 && !GENERIC_TITLES.has(t) && discogsTitles.has(t);
            });
            if (hasOverlap) overlapping.push(candidate.id);
          }

          if (overlapping.length === 1) {
            await this.cache(discogsArtistId, overlapping[0], 'corroborated');
            return { mbid: overlapping[0], confidence: 'corroborated', needsManual: false };
          }
          // Zero → no corroboration; ≥2 → ambiguous. Either way, manual.
        }

        // Name matched but nothing uniquely corroborated — do NOT cache.
        return { mbid: null, confidence: null, needsManual: true };
      } catch (error) {
        // MusicBrainz outage mid-corroboration — degrade to manual.
        logger.debug(`Corroboration failed for discogs artist ${discogsArtistId}: ${error}`);
        return { mbid: null, confidence: null, needsManual: true };
      }
    }

    // 4. Nothing matched at all — manual (the user can search).
    return { mbid: null, confidence: null, needsManual: true };
  }

  /**
   * Reverse of {@link discogsToMbid}: resolve a MusicBrainz MBID (from the user's
   * library) to a Discogs person id (graph key). Cache-first, then the MB discogs
   * url-rel; the resolved link is cached forever with confidence='linked'.
   *
   * Cache lookup is by (source='mb', externalId=mbid). The stored PK is
   * (personId, source), so the reverse key needs a `findFirst` on those columns,
   * backed by @@index([source, externalId]). Returns null (never throws) when the
   * MBID has no discogs link or MB is unavailable.
   */
  async mbidToDiscogs(mbid: string): Promise<number | null> {
    // 1. Cache first — a stored reverse identity wins with no network.
    const cached = await prisma.constellationIdentity.findFirst({
      where: { source: IDENTITY_SOURCE, externalId: mbid },
    });
    if (cached) return cached.personId;

    // 2. MB discogs url-rel. lookupArtistDiscogsId already degrades to null on
    //    error; the extra guard keeps buildOwnedSet skip-not-throw regardless.
    let discogsId: number | null;
    try {
      discogsId = await this.mb.lookupArtistDiscogsId(mbid);
    } catch (error) {
      logger.debug(`Reverse identity lookup failed for mbid ${mbid}: ${error}`);
      return null;
    }
    if (discogsId === null) return null;

    await this.cache(discogsId, mbid, 'linked');
    return discogsId;
  }

  /**
   * Build the user's owned set: for each library source, resolve every artist
   * MBID to its Discogs person id (via {@link mbidToDiscogs}) and record a
   * per-user {@link ConstellationOwned} row. MBIDs that don't resolve to a
   * Discogs node are SKIPPED (counted, never thrown). Task 13/15 then flags a
   * visible node's `owned` by a simple membership check against these rows.
   *
   * Per-source resilient: a source whose fetch throws (e.g. Lidarr down) is
   * logged and skipped so the OTHER sources still build; `sourcesFailed` counts
   * them and `{owned, skipped}` reflect only what succeeded. `owned` counts
   * DISTINCT (source, personId) rows — a duplicate MBID (or two MBIDs resolving
   * to the same person) within one source does not double-count.
   */
  async buildOwnedSet(
    userId: number,
    sources: OwnedSourceProvider[]
  ): Promise<{ owned: number; skipped: number; sourcesFailed: number }> {
    let owned = 0;
    let skipped = 0;
    let sourcesFailed = 0;
    // Dedup written rows by (source, personId) so a repeated MBID within a
    // source's list can't inflate the owned count or re-upsert.
    const written = new Set<string>();

    for (const provider of sources) {
      let mbids: string[];
      try {
        mbids = await provider.getArtistMbids();
      } catch (error) {
        // One dead library must not abort the whole build.
        logger.warn(`Owned-set source '${provider.source}' failed, skipping: ${error}`);
        sourcesFailed++;
        continue;
      }

      for (const mbid of new Set(mbids)) {
        const personId = await this.mbidToDiscogs(mbid);
        if (personId === null) {
          skipped++;
          continue;
        }
        const key = `${provider.source}:${personId}`;
        if (written.has(key)) continue;
        written.add(key);
        await prisma.constellationOwned.upsert({
          where: {
            userId_personId_source: { userId, personId, source: provider.source },
          },
          create: { userId, personId, source: provider.source },
          update: {},
        });
        owned++;
      }
    }

    return { owned, skipped, sourcesFailed };
  }

  private async cache(
    personId: number,
    mbid: string,
    confidence: IdentityConfidence
  ): Promise<void> {
    await prisma.constellationIdentity.upsert({
      where: { personId_source: { personId, source: IDENTITY_SOURCE } },
      create: { personId, source: IDENTITY_SOURCE, externalId: mbid, confidence },
      update: { externalId: mbid, confidence },
    });
  }
}
