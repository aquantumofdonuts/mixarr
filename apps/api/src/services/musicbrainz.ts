/**
 * MusicBrainz Service
 * 
 * Handles all interactions with the MusicBrainz API for artist lookups.
 */

import { rateLimit } from './rate-limiter.js';
import { fetchWithTimeout } from '../lib/fetch-with-timeout.js';
import { createLogger } from '../lib/logger.js';

const API_TIMEOUT = 10_000;

const logger = createLogger('MusicBrainz');

interface MusicBrainzArtist {
  id: string;
  name: string;
  'sort-name': string;
  country?: string;
  type?: string;
  score?: number;
  disambiguation?: string;
  aliases?: Array<{ name: string; locale?: string; primary?: boolean }>;
  'life-span'?: {
    begin?: string;
    end?: string;
    ended?: boolean;
  };
}

interface MusicBrainzLabel {
  id: string;
  name: string;
  'sort-name': string;
  country?: string;
  type?: string;
  score?: number;
  disambiguation?: string;
  'label-code'?: number;
}

interface MusicBrainzRelease {
  id: string;
  title: string;
  status?: string;
  date?: string;
  country?: string;
  'release-group'?: {
    id: string;
    'primary-type'?: string;
    'secondary-types'?: string[];
  };
  'artist-credit'?: Array<{
    artist: MusicBrainzArtist;
  }>;
}

interface MusicBrainzReleaseGroup {
  id: string;
  title: string;
  'primary-type'?: string;
  'secondary-types'?: string[];
  'first-release-date'?: string;
  'artist-credit'?: Array<{
    artist: MusicBrainzArtist;
  }>;
}

interface MusicBrainzRecording {
  id: string;
  title: string;
  length?: number;
  'artist-credit'?: Array<{
    artist: MusicBrainzArtist;
  }>;
}

interface MusicBrainzSearchResult {
  artists: MusicBrainzArtist[];
  count: number;
  offset: number;
}

interface MusicBrainzUrlLookup {
  id: string;
  resource: string;
  relations?: Array<{
    type?: string;
    direction?: string;
    artist?: MusicBrainzArtist;
  }>;
}

interface MusicBrainzArtistUrlRels {
  relations?: Array<{
    type?: string;
    url?: { resource?: string };
  }>;
}

interface MusicBrainzLabelSearchResult {
  labels: MusicBrainzLabel[];
  count: number;
  offset: number;
}

interface MusicBrainzReleaseSearchResult {
  releases: MusicBrainzRelease[];
  count: number;
  offset: number;
}

interface MusicBrainzReleaseGroupSearchResult {
  'release-groups': MusicBrainzReleaseGroup[];
  count: number;
  offset: number;
}

export class MusicBrainzService {
  private baseUrl = 'https://musicbrainz.org/ws/2';
  private userAgent = 'Mixarr/2.0.0 (https://github.com/aquantumofdonuts/mixarr)';

  private async request<T>(endpoint: string): Promise<T> {
    await rateLimit('musicbrainz');

    const response = await fetchWithTimeout(`${this.baseUrl}${endpoint}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
      timeout: API_TIMEOUT,
    });

    if (!response.ok) {
      throw new Error(`MusicBrainz API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  // Escape special characters for MusicBrainz Lucene query syntax
  private escapeLuceneQuery(query: string): string {
    // Characters that need escaping: + - && || ! ( ) { } [ ] ^ " ~ * ? : \ /
    return query.replace(/([+\-&|!(){}[\]^"~*?:\\/])/g, '\\$1');
  }

  async searchArtist(name: string, limit: number = 10): Promise<MusicBrainzArtist[]> {
    const escapedName = this.escapeLuceneQuery(name);
    const query = encodeURIComponent(escapedName);
    const result = await this.request<MusicBrainzSearchResult>(
      `/artist?query=${query}&limit=${limit}&fmt=json`
    );
    return result.artists || [];
  }

  /**
   * Resolve an external resource URL to a MusicBrainz artist MBID via the
   * MB `/url` lookup with `inc=artist-rels`. Used to map a Discogs artist page
   * (`https://www.discogs.com/artist/{id}`) to its MB artist through the
   * curated URL relationship — the clean, unambiguous join key.
   *
   * Returns the MBID of the single related artist, or null if the URL is not
   * known to MusicBrainz, carries no artist relationship, or resolves to TWO OR
   * MORE distinct artists (ambiguous — the caller falls through to a
   * corroborated/manual path rather than picking one arbitrarily).
   */
  async lookupArtistMbidByUrl(resourceUrl: string): Promise<string | null> {
    const encoded = encodeURIComponent(resourceUrl);
    try {
      const result = await this.request<MusicBrainzUrlLookup>(
        `/url?resource=${encoded}&inc=artist-rels&fmt=json`
      );
      const distinctIds = new Set(
        (result.relations ?? [])
          .map(r => r.artist?.id)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      );
      // Exactly one distinct artist is an unambiguous join key; anything else
      // (none, or several) is not linkable.
      return distinctIds.size === 1 ? [...distinctIds][0] : null;
    } catch {
      return null;
    }
  }

  /**
   * Reverse of {@link lookupArtistMbidByUrl}: given a MusicBrainz artist MBID,
   * return the numeric Discogs artist id from the artist's discogs url
   * relationship (`GET /artist/{mbid}?inc=url-rels`). The discogs relation's
   * `url.resource` is either `https://www.discogs.com/artist/12345` or the
   * slugged `.../artist/12345-Artist-Name`; both forms yield 12345.
   *
   * Returns null if the artist has no discogs url-rel, and degrades to null
   * (rather than throwing) on any MB API error.
   */
  async lookupArtistDiscogsId(mbid: string): Promise<number | null> {
    try {
      const result = await this.request<MusicBrainzArtistUrlRels>(
        `/artist/${encodeURIComponent(mbid)}?inc=url-rels&fmt=json`
      );
      for (const relation of result.relations ?? []) {
        const resource = relation.url?.resource;
        if (!resource) continue;
        // Anchor on the real discogs host + /artist/ path so a suffix look-alike
        // host (fakediscogs.com) or a /label/ url can't false-positive.
        const match = resource.match(/\/\/(?:www\.)?discogs\.com\/artist\/(\d+)/);
        if (match) return Number(match[1]);
      }
      return null;
    } catch {
      return null;
    }
  }

  async getArtist(mbid: string): Promise<MusicBrainzArtist | null> {
    try {
      const result = await this.request<MusicBrainzArtist>(`/artist/${mbid}?fmt=json`);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get recording details by MBID (includes artist credits)
   */
  async getRecording(mbid: string): Promise<MusicBrainzRecording | null> {
    try {
      const result = await this.request<MusicBrainzRecording>(`/recording/${mbid}?inc=artist-credits&fmt=json`);
      return result;
    } catch {
      return null;
    }
  }

  async findBestMatch(name: string): Promise<MusicBrainzArtist | null> {
    const artists = await this.searchArtist(name, 10);
    
    if (artists.length === 0) {
      return null;
    }

    const normalizedName = name.toLowerCase().trim();

    // Priority 1: Exact name match (case-insensitive)
    const exactMatch = artists.find(
      a => a.name.toLowerCase().trim() === normalizedName
    );
    if (exactMatch) {
      return exactMatch;
    }

    // Priority 2: Check for alias match
    const aliasMatch = artists.find(a => 
      a.aliases?.some(alias => alias.name.toLowerCase().trim() === normalizedName)
    );
    if (aliasMatch) {
      return aliasMatch;
    }

    // Helper: Get significant words from a name (filter out short words like "the", "a", "of")
    const getSignificantWords = (text: string): Set<string> => {
      const stopWords = new Set(['the', 'a', 'an', 'of', 'and', '&']);
      return new Set(
        text.toLowerCase().split(/\s+/)
          .filter(word => word.length > 1 && !stopWords.has(word))
      );
    };

    // Helper: Check if search words have sufficient overlap with artist name
    const hasWordOverlap = (artistName: string, searchName: string): boolean => {
      const artistWords = getSignificantWords(artistName);
      const searchWords = getSignificantWords(searchName);
      
      if (searchWords.size === 0 || artistWords.size === 0) {
        return false;
      }
      
      // Count how many search words appear in the artist name
      let matchCount = 0;
      for (const word of searchWords) {
        if (artistWords.has(word)) {
          matchCount++;
        }
      }
      
      // For multi-word names: require ALL words to match (strict matching)
      // "neil amsterdam" searching → "Neil Amsterdam" must match, not "Neil Young"
      // For single-word names: require that word to match
      if (searchWords.size > 1) {
        // Multi-word: all words must match
        return matchCount === searchWords.size;
      } else {
        // Single word: must match
        return matchCount >= 1;
      }
    };

    // Priority 3: High score match (>= 95) BUT require word overlap to avoid wrong artists
    const sorted = artists.sort((a, b) => (b.score || 0) - (a.score || 0));
    if (sorted[0].score && sorted[0].score >= 95) {
      // Only accept high-score match if there's sufficient word overlap
      if (hasWordOverlap(sorted[0].name, name)) {
        return sorted[0];
      }
      // Log when we reject a high-score match due to name mismatch
      logger.debug(`Rejected high-score match "${sorted[0].name}" (score ${sorted[0].score}) for query "${name}" - insufficient word overlap`);
    }

    // Priority 4: Name contains the full search term (for "Artist Name" matching "Artist Name feat. X")
    const containsMatch = sorted.find(a => 
      a.name.toLowerCase().includes(normalizedName) || 
      normalizedName.includes(a.name.toLowerCase())
    );
    // Only accept contains match if the names are similar length (avoid "MAKI" matching "Maki Yuoma")
    if (containsMatch) {
      const lengthRatio = Math.min(containsMatch.name.length, name.length) / 
                          Math.max(containsMatch.name.length, name.length);
      if (lengthRatio >= 0.7) {
        return containsMatch;
      }
    }

    // No confident match found - return null rather than a wrong artist
    logger.debug(`No confident match for "${name}". Top result was "${sorted[0].name}" with score ${sorted[0].score}`);
    return null;
  }

  /**
   * Lenient fallback: returns the top MusicBrainz result when strict matching fails,
   * provided the score is >= 95. Skips word-overlap requirement — useful for
   * single-token stage names, transliterations, and romanised names that have
   * no lexical overlap with the canonical MusicBrainz spelling.
   *
   * Only call this AFTER findBestMatch() returns null.
   */
  async findBestMatchLenient(name: string): Promise<MusicBrainzArtist | null> {
    const artists = await this.searchArtist(name, 5);
    if (artists.length === 0) return null;

    const top = artists.sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (top.score && top.score >= 95) {
      logger.debug(`Lenient fallback accepted "${top.name}" (score ${top.score}) for query "${name}"`);
      return top;
    }

    logger.debug(`Lenient fallback rejected "${top.name}" (score ${top.score ?? 'n/a'}) for query "${name}" — score below 95`);
    return null;
  }

  /**
   * Look up artist MBID from Spotify artist
   * Uses artist name to find the MusicBrainz ID needed for Lidarr
   */
  async getMbidFromSpotifyArtist(artistName: string): Promise<string | null> {
    const match = await this.findBestMatch(artistName);
    return match?.id || null;
  }

  /**
   * Search for labels by name
   */
  async searchByLabel(query: string, limit: number = 25, offset: number = 0): Promise<{
    labels: MusicBrainzLabel[];
    count: number;
  }> {
    const encodedQuery = encodeURIComponent(query);
    const result = await this.request<MusicBrainzLabelSearchResult>(
      `/label?query=${encodedQuery}&limit=${limit}&offset=${offset}&fmt=json`
    );
    return {
      labels: result.labels || [],
      count: result.count || 0
    };
  }

  /**
   * Search for albums/releases by title
   */
  async searchByAlbum(query: string, limit: number = 25, offset: number = 0): Promise<{
    releases: MusicBrainzRelease[];
    count: number;
  }> {
    const encodedQuery = encodeURIComponent(query);
    const result = await this.request<MusicBrainzReleaseSearchResult>(
      `/release?query=${encodedQuery}&limit=${limit}&offset=${offset}&fmt=json`
    );
    return {
      releases: result.releases || [],
      count: result.count || 0
    };
  }

  /**
   * Search for releases by year (first release date)
   */
  async searchByYear(year: number, limit: number = 25, offset: number = 0): Promise<{
    releaseGroups: MusicBrainzReleaseGroup[];
    count: number;
  }> {
    // Search for release groups from a specific year
    const result = await this.request<MusicBrainzReleaseGroupSearchResult>(
      `/release-group?query=firstreleasedate:${year}&limit=${limit}&offset=${offset}&fmt=json`
    );
    return {
      releaseGroups: result['release-groups'] || [],
      count: result.count || 0
    };
  }

  /**
   * Get all releases for an artist
   */
  async getArtistReleases(mbid: string, limit: number = 100, offset: number = 0): Promise<{
    releaseGroups: MusicBrainzReleaseGroup[];
    count: number;
  }> {
    const result = await this.request<MusicBrainzReleaseGroupSearchResult & { 'release-group-count'?: number }>(
      `/release-group?artist=${mbid}&limit=${limit}&offset=${offset}&fmt=json`
    );
    return {
      releaseGroups: result['release-groups'] || [],
      count: result['release-group-count'] || result.count || 0
    };
  }

  /**
   * Get artists signed to a label
   */
  async getLabelArtists(labelMbid: string, limit: number = 100, offset: number = 0): Promise<{
    releases: MusicBrainzRelease[];
    count: number;
  }> {
    // Use query parameter with label: prefix instead of label=
    const result = await this.request<MusicBrainzReleaseSearchResult>(
      `/release?query=laid:${labelMbid}&limit=${limit}&offset=${offset}&fmt=json`
    );
    return {
      releases: result.releases || [],
      count: result.count || 0
    };
  }
}
