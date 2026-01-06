/**
 * MusicBrainz Service
 * 
 * Handles all interactions with the MusicBrainz API for artist lookups.
 */

import { rateLimit } from './rate-limiter.js';
import { createLogger } from '../lib/logger.js';

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

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
      },
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
