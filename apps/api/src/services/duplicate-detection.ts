/**
 * Duplicate Artist Detection Service
 * 
 * Scans library for potential duplicate artists using fuzzy matching.
 */

export enum MatchType {
  EXACT_NORMALIZED = 'exact_normalized',     // Same after normalization
  FUZZY_HIGH = 'fuzzy_high',                 // >90% similar
  FUZZY_MEDIUM = 'fuzzy_medium',             // 80-90% similar
  PREFIX_MATCH = 'prefix_match',             // "The X" vs "X"
}

export interface DuplicateCandidate {
  artist1: ArtistInfo;
  artist2: ArtistInfo;
  similarity: number;      // 0-1 score
  matchType: MatchType;
  confidence: 'high' | 'medium' | 'low';
}

export interface ArtistInfo {
  id: number;
  artistName: string;
  foreignArtistId: string;
  albumCount?: number;
  trackCount?: number;
  sizeOnDisk?: number;
}

export interface DuplicateScanResult {
  totalArtists: number;
  duplicatesFound: number;
  candidates: DuplicateCandidate[];
  scannedAt: Date;
}

/**
 * Normalize an artist name for comparison
 * - Removes "The " prefix
 * - Removes punctuation
 * - Normalizes unicode/diacritics
 * - Lowercases
 */
export function normalizeName(name: string): string {
  if (!name) return '';
  
  let result = name
    .toLowerCase()
    .normalize('NFD')                   // Decompose unicode
    .replace(/[\u0300-\u036f]/g, '')   // Remove diacritics
    .replace(/[^\w\s]/g, '')           // Remove punctuation (keep alphanumeric and spaces)
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();
  
  // Remove leading "The " or standalone "The" after normalization
  result = result.replace(/^the(\s+|$)/i, '').trim();
  
  return result;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;
  
  // Create distance matrix
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  
  // Initialize first column and row
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  
  // Fill in the rest
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,      // deletion
        dp[i][j - 1] + 1,      // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  
  return dp[m][n];
}

/**
 * Check if one name contains the other (prefix/suffix pattern)
 */
function checkContainment(norm1: string, norm2: string): number {
  if (!norm1 || !norm2) return 0;
  
  // Check if one contains the other
  if (norm1.includes(norm2) || norm2.includes(norm1)) {
    // Score based on how much of the longer string is matched
    const shorter = norm1.length < norm2.length ? norm1 : norm2;
    const longer = norm1.length < norm2.length ? norm2 : norm1;
    return shorter.length / longer.length;
  }
  
  return 0;
}

/**
 * Calculate similarity between two artist names
 * Returns a score between 0 and 1
 */
export function calculateSimilarity(name1: string, name2: string): number {
  const norm1 = normalizeName(name1);
  const norm2 = normalizeName(name2);
  
  // Handle empty strings
  if (!norm1 && !norm2) return 1.0;
  if (!norm1 || !norm2) return 0;
  
  // Exact match after normalization
  if (norm1 === norm2) return 1.0;
  
  // Levenshtein distance as percentage
  const maxLen = Math.max(norm1.length, norm2.length);
  const dist = levenshteinDistance(norm1, norm2);
  const levenshteinScore = 1 - (dist / maxLen);
  
  // Check for containment patterns
  const containmentScore = checkContainment(norm1, norm2);
  
  return Math.max(levenshteinScore, containmentScore);
}

/**
 * Determine match type from similarity score
 */
function getMatchType(similarity: number, norm1: string, norm2: string): MatchType {
  if (norm1 === norm2) {
    return MatchType.EXACT_NORMALIZED;
  }
  if (similarity >= 0.9) {
    return MatchType.FUZZY_HIGH;
  }
  if (similarity >= 0.8) {
    return MatchType.FUZZY_MEDIUM;
  }
  return MatchType.PREFIX_MATCH;
}

/**
 * Determine confidence level from match type
 */
function getConfidence(matchType: MatchType): 'high' | 'medium' | 'low' {
  switch (matchType) {
    case MatchType.EXACT_NORMALIZED:
      return 'high';
    case MatchType.FUZZY_HIGH:
      return 'medium';
    case MatchType.FUZZY_MEDIUM:
    case MatchType.PREFIX_MATCH:
      return 'low';
  }
}

/**
 * Detect duplicate artists from a list
 * Uses blocking by first letter for performance optimization
 */
export function detectDuplicates(artists: ArtistInfo[]): DuplicateCandidate[] {
  if (artists.length < 2) return [];
  
  const candidates: DuplicateCandidate[] = [];
  const SIMILARITY_THRESHOLD = 0.8;
  
  // Create blocks by first letter of normalized name for O(n) optimization
  const blocks = new Map<string, ArtistInfo[]>();
  const normalizedNames = new Map<number, string>();
  
  for (const artist of artists) {
    const normalized = normalizeName(artist.artistName);
    normalizedNames.set(artist.id, normalized);
    
    const key = normalized[0] || 'other';
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(artist);
  }
  
  // Compare within blocks
  for (const [, block] of blocks) {
    for (let i = 0; i < block.length; i++) {
      for (let j = i + 1; j < block.length; j++) {
        const artist1 = block[i];
        const artist2 = block[j];
        
        const norm1 = normalizedNames.get(artist1.id)!;
        const norm2 = normalizedNames.get(artist2.id)!;
        
        const similarity = calculateSimilarity(artist1.artistName, artist2.artistName);
        
        if (similarity >= SIMILARITY_THRESHOLD) {
          const matchType = getMatchType(similarity, norm1, norm2);
          candidates.push({
            artist1,
            artist2,
            similarity,
            matchType,
            confidence: getConfidence(matchType),
          });
        }
      }
    }
  }
  
  // Also check across adjacent letter blocks for common variations
  // (e.g., "Bjork" vs "Björk" might normalize to different first letters)
  const blockKeys = Array.from(blocks.keys()).sort();
  for (let k = 0; k < blockKeys.length; k++) {
    const block1 = blocks.get(blockKeys[k])!;
    
    // Compare with next block only (to catch adjacent variations)
    if (k + 1 < blockKeys.length) {
      const block2 = blocks.get(blockKeys[k + 1])!;
      
      for (const artist1 of block1) {
        for (const artist2 of block2) {
          const similarity = calculateSimilarity(artist1.artistName, artist2.artistName);
          
          if (similarity >= SIMILARITY_THRESHOLD) {
            const norm1 = normalizedNames.get(artist1.id)!;
            const norm2 = normalizedNames.get(artist2.id)!;
            const matchType = getMatchType(similarity, norm1, norm2);
            
            candidates.push({
              artist1,
              artist2,
              similarity,
              matchType,
              confidence: getConfidence(matchType),
            });
          }
        }
      }
    }
  }
  
  // Sort by similarity descending
  return candidates.sort((a, b) => b.similarity - a.similarity);
}

/**
 * Full duplicate detection service for use with Lidarr
 */
export class DuplicateDetectionService {
  constructor(private lidarrService: any) {}
  
  async scan(): Promise<DuplicateScanResult> {
    const artists = await this.lidarrService.getArtists();
    
    // Map Lidarr artists to our format
    const artistInfos: ArtistInfo[] = artists.map((a: any) => ({
      id: a.id,
      artistName: a.artistName,
      foreignArtistId: a.foreignArtistId,
      albumCount: a.statistics?.albumCount,
      trackCount: a.statistics?.trackCount,
      sizeOnDisk: a.statistics?.sizeOnDisk,
    }));
    
    const candidates = detectDuplicates(artistInfos);
    
    return {
      totalArtists: artistInfos.length,
      duplicatesFound: candidates.length,
      candidates: candidates.slice(0, 100), // Limit results
      scannedAt: new Date(),
    };
  }
}
