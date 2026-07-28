/**
 * Discogs Service
 * 
 * Handles all interactions with the Discogs API.
 * Discogs is a music database with extensive label and release information,
 * useful for discovery features.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { normalizeRole, type BaseRole } from './constellation/RoleTaxonomy.js';
import { createLogger } from '../lib/logger.js';

const API_TIMEOUT = 15_000;
const discogsLog = createLogger('Discogs');

interface DiscogsPagination {
  page: number;
  pages: number;
  per_page: number;
  items: number;
}

interface DiscogsLabel {
  id: number;
  title: string;
  resource_url: string;
  thumb?: string;
}

interface DiscogsRelease {
  id: number;
  title: string;
  artist: string;
  year?: number;
  format?: string;
  catno?: string;
  status?: string;
  thumb?: string;
  resource_url?: string;
}

interface DiscogsSearchResult {
  id: number;
  title: string;
  type: string;
  style?: string[];
  genre?: string[];
  year?: string;
  thumb?: string;
  resource_url?: string;
}

export interface ParsedDiscogsArtist {
  id: number;
  name: string;
  profile?: string;
  images: Array<{ type: string; uri: string; width?: number; height?: number }>;
  urls: string[];
  nameVariations: string[];
  members?: Array<{ id: number; name: string; active?: boolean }>;
}

interface DiscogsArtist {
  id: number;
  name: string;
  realname?: string;
  profile?: string;
  urls?: string[];
  images?: Array<{ type: string; uri: string; width?: number; height?: number }>;
  members?: Array<{ id: number; name: string; active?: boolean }>;
  namevariations?: string[];
  data_quality?: string;
}

interface RawDiscogsArtist {
  id: number;
  name: string;
  profile?: string;
  images?: Array<{ type: string; uri: string; width?: number; height?: number }>;
  urls?: string[];
  namevariations?: string[];
  members?: Array<{ id: number; name: string; active?: boolean }>;
}

interface DiscogsLabelSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsLabel[];
}

interface DiscogsLabelReleasesResponse {
  pagination: DiscogsPagination;
  releases: DiscogsRelease[];
}

interface DiscogsStyleSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsSearchResult[];
}

/**
 * Parse raw Discogs artist data into a structured format
 */
export function parseDiscogsArtist(raw: RawDiscogsArtist): ParsedDiscogsArtist {
  return {
    id: raw.id,
    name: raw.name,
    profile: raw.profile,
    images: raw.images || [],
    urls: raw.urls || [],
    nameVariations: raw.namevariations || [],
    members: raw.members,
  };
}

/**
 * Format Discogs image URL based on desired size
 */
export function formatDiscogsImageUrl(
  fullUrl: string,
  thumbnailUrl?: string,
  size?: 'small' | 'large'
): string {
  if (!size) return fullUrl;
  if (size === 'small' && thumbnailUrl) return thumbnailUrl;
  return fullUrl;
}

interface DiscogsLabelSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsLabel[];
}

interface DiscogsLabelReleasesResponse {
  pagination: DiscogsPagination;
  releases: DiscogsRelease[];
}

interface DiscogsStyleSearchResponse {
  pagination: DiscogsPagination;
  results: DiscogsSearchResult[];
}

/**
 * Raw Discogs credit entry as it appears in `extraartists` arrays.
 * Describes untrusted external data, so every field is treated as optional.
 */
interface RawDiscogsCredit {
  id: number;
  name?: string;
  role?: string;
}

interface DiscogsReleaseDetail {
  id: number;
  master_id?: number;
  extraartists?: RawDiscogsCredit[];
  tracklist?: Array<{ extraartists?: RawDiscogsCredit[] }>;
}

/**
 * A normalized personnel credit for a single release, merged across the
 * release-level and per-track `extraartists`, carrying the release master_id.
 */
export interface DiscogsCredit {
  artistId: number;
  name: string;
  roles: BaseRole[];
  masterId: number | null;
}

/**
 * One item from the Discogs `/artists/{id}/releases` listing. The listing mixes
 * `type: 'release'` (a concrete release, `id` is the release id) and
 * `type: 'master'` (`id` is the master id, `main_release` is its representative
 * release id). Every field is optional because it is untrusted external data.
 */
export interface DiscogsArtistReleaseItem {
  id: number;
  type: 'release' | 'master';
  title?: string;
  year?: number;
  role?: string;
  /** Present on `type: 'master'` items — the representative release id. */
  main_release?: number;
  /** Occasionally present on `type: 'release'` items. */
  master_id?: number;
}

interface DiscogsArtistReleasesResponse {
  pagination: DiscogsPagination;
  releases: DiscogsArtistReleaseItem[];
}

/** Default page cap for {@link DiscogsService.getArtistReleases} (100/page). */
const DEFAULT_ARTIST_RELEASES_MAX_PAGES = 5;

export class DiscogsService {
  private token: string | undefined;
  private baseUrl = 'https://api.discogs.com';

  /**
   * @param token - Discogs personal-access token. OPTIONAL: the Discogs public
   *   database API works unauthenticated (rate-limited), so the constellation
   *   live source can build a tokenless service. When present the token is sent
   *   as an `Authorization` header; when absent only the (mandatory) `User-Agent`
   *   is sent — Discogs rejects requests without a User-Agent with 403.
   */
  constructor(token?: string) {
    this.token = token;
  }

  private getHeaders(): Record<string, string> {
    // Discogs REQUIRES a User-Agent on every request (unauthenticated requests
    // without one get 403); the Authorization header is added only when a token
    // is configured, so a tokenless service still hits the public API.
    const headers: Record<string, string> = {
      'User-Agent': 'MixarrMusicDiscovery/1.0',
    };
    if (this.token) {
      headers['Authorization'] = `Discogs token=${this.token}`;
    }
    return headers;
  }

  private async request<T>(path: string): Promise<T> {
    await rateLimit('discogs');

    const response = await fetchWithTimeout(`${this.baseUrl}${path}`, {
      headers: this.getHeaders(),
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`Discogs API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test connection to Discogs API
   */
  async testConnection(): Promise<{ success: boolean; error?: string }> {
    try {
      await this.searchLabels('test', 1);
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  /**
   * Search for labels by name
   * @param query - Search query string
   * @param page - Page number (default: 1)
   * @returns Paginated list of labels
   */
  async searchLabels(query: string, page: number = 1): Promise<DiscogsLabelSearchResponse> {
    const encodedQuery = encodeURIComponent(query);
    return this.request<DiscogsLabelSearchResponse>(
      `/database/search?type=label&q=${encodedQuery}&page=${page}&per_page=25`
    );
  }

  /**
   * Get releases from a specific label
   * @param labelId - Discogs label ID
   * @param page - Page number (default: 1)
   * @returns Paginated list of releases
   */
  async getLabelReleases(labelId: number, page: number = 1): Promise<DiscogsLabelReleasesResponse> {
    return this.request<DiscogsLabelReleasesResponse>(
      `/labels/${labelId}/releases?page=${page}&per_page=50`
    );
  }

  /**
   * Search for releases by style/genre
   * @param style - Style/genre to search for (e.g., "Ambient", "Progressive Rock")
   * @param page - Page number (default: 1)
   * @returns Paginated list of releases matching the style
   */
  async searchByStyle(style: string, page: number = 1): Promise<DiscogsStyleSearchResponse> {
    const encodedStyle = encodeURIComponent(style);
    return this.request<DiscogsStyleSearchResponse>(
      `/database/search?type=release&style=${encodedStyle}&page=${page}&per_page=50`
    );
  }

  /**
   * Get artist details by ID
   * @param artistId - Discogs artist ID
   * @returns Artist details including profile, images, and members
   */
  async getArtist(artistId: number): Promise<DiscogsArtist> {
    return this.request<DiscogsArtist>(`/artists/${artistId}`);
  }

  /**
   * List an artist's releases from `/artists/{id}/releases`, following pagination
   * up to `maxPages` (default {@link DEFAULT_ARTIST_RELEASES_MAX_PAGES}) at 100
   * items/page. The page cap bounds the live-Discogs API cost per artist (a prolific
   * artist can otherwise span dozens of pages); it is the live analog of the
   * data-dump index and is governed at a higher level by the `dailyApiBudget` setting.
   *
   * Returns the raw listing items; {@link LiveDiscogsCreditSource} maps them onto
   * the {@link CreditSource} shape.
   *
   * @param artistId - Discogs artist id
   * @param opts.maxPages - hard cap on pages fetched (default 5)
   */
  async getArtistReleases(
    artistId: number,
    opts: { maxPages?: number } = {},
  ): Promise<DiscogsArtistReleaseItem[]> {
    const maxPages = opts.maxPages ?? DEFAULT_ARTIST_RELEASES_MAX_PAGES;
    const all: DiscogsArtistReleaseItem[] = [];

    for (let page = 1; page <= maxPages; page++) {
      const response = await this.request<DiscogsArtistReleasesResponse>(
        `/artists/${artistId}/releases?page=${page}&per_page=100`,
      );
      all.push(...(response.releases ?? []));
      const totalPages = response.pagination?.pages ?? 1;
      if (page >= totalPages) break;
      if (page >= maxPages && totalPages > maxPages) {
        // Prolific artist: releases beyond the page cap are dropped. Log for
        // observability (the cap bounds live-Discogs API cost per artist).
        discogsLog.debug(
          `Artist ${artistId} releases truncated at page cap ${maxPages}/${totalPages} ` +
            `(${response.pagination?.items ?? 'unknown'} total items); dropping remaining pages`,
        );
      }
    }

    return all;
  }

  /**
   * Get the full personnel credits for a release.
   *
   * Combines the release-level `extraartists` with every track's
   * `extraartists`, normalizes each raw role via {@link normalizeRole},
   * drops free-text credits (Discogs uses `id: 0` for non-traversable
   * name credits), and merges duplicate artists into a single entry with
   * the union of their roles. The release `master_id` (when present) is
   * carried onto every credit.
   *
   * @param releaseId - Discogs release ID
   * @returns One credit per distinct artist, with unioned normalized roles
   */
  async getReleaseCredits(releaseId: number): Promise<DiscogsCredit[]> {
    const release = await this.request<DiscogsReleaseDetail>(`/releases/${releaseId}`);

    const masterId = release.master_id ?? null;

    // Gather raw credits from the release level and every track.
    const rawCredits: RawDiscogsCredit[] = [...(release.extraartists ?? [])];
    for (const track of release.tracklist ?? []) {
      rawCredits.push(...(track.extraartists ?? []));
    }

    // Merge by artistId, unioning normalized roles.
    const byArtist = new Map<number, { name: string; roles: Set<BaseRole> }>();
    for (const raw of rawCredits) {
      // Drop free-text (non-traversable) credits and any type-drift garbage.
      // Discogs uses id 0 for free-text name credits; a non-numeric or missing
      // id must never leak an undefined-keyed entry into the output.
      if (typeof raw.id !== 'number' || raw.id === 0) continue;

      let entry = byArtist.get(raw.id);
      if (!entry) {
        entry = { name: raw.name ?? '', roles: new Set<BaseRole>() };
        byArtist.set(raw.id, entry);
      }
      for (const role of normalizeRole(raw.role ?? '')) {
        entry.roles.add(role);
      }
    }

    return [...byArtist.entries()].map(([artistId, { name, roles }]) => ({
      artistId,
      name,
      roles: [...roles],
      masterId,
    }));
  }
}
