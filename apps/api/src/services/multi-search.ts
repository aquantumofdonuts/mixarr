/**
 * Multi-Source Search Service
 * 
 * Aggregates artist search results from multiple streaming services,
 * merges by artist name similarity, and applies priority ordering.
 * 
 * Priority: Spotify > Deezer > Tidal > Bandcamp
 */

import prisma from '../lib/db.js';
import { SpotifyService } from './spotify.js';
import { searchDeezerArtists } from './deezer.js';
import { TidalService } from './tidal.js';
import { BandcampService } from './bandcamp.js';
import { MusicBrainzService } from './musicbrainz.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('MultiSearch');
export type SearchSource = 'spotify' | 'deezer' | 'tidal' | 'bandcamp';

export interface UnifiedArtistResult {
  name: string;
  imageUrl: string | null;
  sources: SearchSource[];
  // Primary source data
  spotifyId?: string;
  deezerId?: number;
  tidalId?: string;
  bandcampId?: number;
  // Enrichment data
  popularity?: number;
  genres?: string[];
  followers?: number;
  fans?: number;
  // For adding to Lidarr
  mbid?: string;
  inLibrary?: boolean;
}

export interface SourceResult {
  name: string;
  imageUrl: string | null;
  source: SearchSource;
  sourceId: string | number;
  popularity?: number;
  genres?: string[];
  followers?: number;
  fans?: number;
}

// Priority order for sources (lower index = higher priority)
const SOURCE_PRIORITY: SearchSource[] = ['spotify', 'deezer', 'tidal', 'bandcamp'];

/**
 * Normalize artist name for comparison
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Check if two artist names are similar enough to be the same artist
 */
function namesMatch(a: string, b: string): boolean {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  
  // Exact match after normalization
  if (normA === normB) return true;
  
  // One contains the other (for "Artist" vs "The Artist")
  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = normA.length < normB.length ? normA : normB;
    const longer = normA.length >= normB.length ? normA : normB;
    // Only match if the shorter is at least 80% of the longer
    if (shorter.length / longer.length >= 0.8) return true;
  }
  
  return false;
}

/**
 * Merge search results from multiple sources
 */
export function mergeSearchResults(
  resultsBySource: SourceResult[][],
  sourceOrder: SearchSource[]
): UnifiedArtistResult[] {
  const merged = new Map<string, UnifiedArtistResult>();
  
  // Process results in priority order
  for (let i = 0; i < sourceOrder.length; i++) {
    const source = sourceOrder[i];
    const results = resultsBySource[i] || [];
    
    for (const result of results) {
      // Check if we already have this artist
      let existingKey: string | null = null;
      for (const [key, existing] of merged) {
        if (namesMatch(result.name, existing.name)) {
          existingKey = key;
          break;
        }
      }
      
      if (existingKey) {
        // Add source to existing result
        const existing = merged.get(existingKey)!;
        existing.sources.push(source);
        
        // Add source-specific ID
        switch (source) {
          case 'spotify': existing.spotifyId = String(result.sourceId); break;
          case 'deezer': existing.deezerId = Number(result.sourceId); break;
          case 'tidal': existing.tidalId = String(result.sourceId); break;
          case 'bandcamp': existing.bandcampId = Number(result.sourceId); break;
        }
        
        // Enrich with additional data (don't overwrite primary)
        if (!existing.genres?.length && result.genres?.length) {
          existing.genres = result.genres;
        }
        if (!existing.fans && result.fans) {
          existing.fans = result.fans;
        }
      } else {
        // New artist - use as primary
        const normName = normalizeName(result.name);
        const unified: UnifiedArtistResult = {
          name: result.name,
          imageUrl: result.imageUrl,
          sources: [source],
          popularity: result.popularity,
          genres: result.genres,
          followers: result.followers,
          fans: result.fans,
        };
        
        // Add source-specific ID
        switch (source) {
          case 'spotify': unified.spotifyId = String(result.sourceId); break;
          case 'deezer': unified.deezerId = Number(result.sourceId); break;
          case 'tidal': unified.tidalId = String(result.sourceId); break;
          case 'bandcamp': unified.bandcampId = Number(result.sourceId); break;
        }
        
        merged.set(normName, unified);
      }
    }
  }
  
  // Sort by number of sources (more sources = more confident), then by popularity
  return Array.from(merged.values()).sort((a, b) => {
    if (b.sources.length !== a.sources.length) {
      return b.sources.length - a.sources.length;
    }
    return (b.popularity || 0) - (a.popularity || 0);
  });
}

/**
 * Get Spotify service for a user
 */
async function getSpotifyService(userId: number): Promise<SpotifyService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'spotify', isActive: true },
        { userId: null, type: 'spotify', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  
  const config = connection.config as Record<string, unknown>;
  return new SpotifyService({
    clientId: config.clientId as string,
    clientSecret: config.clientSecret as string,
    accessToken: config.accessToken as string,
    refreshToken: config.refreshToken as string,
    expiresAt: (config.expiresAt || config.tokenExpiresAt) as number,
  });
}

/**
 * Get Tidal service for a user
 */
async function getTidalService(userId: number): Promise<TidalService | null> {
  const connection = await prisma.connection.findFirst({
    where: {
      OR: [
        { userId, type: 'tidal', isActive: true },
        { userId: null, type: 'tidal', isActive: true },
      ],
    },
    orderBy: { userId: 'desc' },
  });
  if (!connection) return null;
  
  const config = connection.config as Record<string, unknown>;
  return new TidalService({
    clientId: config.clientId as string,
    clientSecret: config.clientSecret as string,
    accessToken: config.accessToken as string,
    refreshToken: config.refreshToken as string,
    expiresAt: config.expiresAt ? String(config.expiresAt) : undefined,
  });
}

/**
 * Search across multiple sources
 */
export async function multiSourceSearch(
  query: string,
  userId: number,
  enabledSources: SearchSource[],
  limit: number = 25
): Promise<UnifiedArtistResult[]> {
  const searchPromises: Promise<SourceResult[]>[] = [];
  const sourceOrder: SearchSource[] = [];
  
  // Query each enabled source in parallel
  for (const source of SOURCE_PRIORITY) {
    if (!enabledSources.includes(source)) continue;
    
    sourceOrder.push(source);
    
    switch (source) {
      case 'spotify':
        searchPromises.push(
          (async () => {
            const spotify = await getSpotifyService(userId);
            if (!spotify) return [];
            try {
              const results = await spotify.searchArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: r.imageUrl,
                source: 'spotify' as SearchSource,
                sourceId: r.id,
                popularity: r.popularity,
                genres: r.genres,
                followers: r.followers,
              }));
            } catch (err) {
              logger.warn('Spotify artist search failed', { query, error: err instanceof Error ? err.message : String(err) });
              return [];
            }
          })()
        );
        break;
        
      case 'deezer':
        searchPromises.push(
          (async () => {
            try {
              const results = await searchDeezerArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: r.picture_medium || r.picture || null,
                source: 'deezer' as SearchSource,
                sourceId: r.id,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
        
      case 'tidal':
        searchPromises.push(
          (async () => {
            const tidal = await getTidalService(userId);
            if (!tidal) return [];
            try {
              const results = await tidal.searchArtists(query, limit);
              return results.map(r => ({
                name: r.name,
                imageUrl: null, // Tidal doesn't return images in basic search
                source: 'tidal' as SearchSource,
                sourceId: r.id,
                popularity: r.popularity,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
        
      case 'bandcamp':
        searchPromises.push(
          (async () => {
            try {
              const service = new BandcampService();
              const response = await service.searchArtists(query);
              return response.artists.map(r => ({
                name: r.name,
                imageUrl: r.imageUrl,
                source: 'bandcamp' as SearchSource,
                sourceId: r.id,
                genres: r.genre ? [r.genre] : undefined,
              }));
            } catch {
              return [];
            }
          })()
        );
        break;
    }
  }
  
  const resultsBySource = await Promise.all(searchPromises);
  return mergeSearchResults(resultsBySource, sourceOrder);
}

/**
 * Resolve MusicBrainz ID for an artist
 */
export async function resolveMbid(artistName: string): Promise<{
  mbid: string | null;
  candidates?: Array<{ id: string; name: string; disambiguation?: string; country?: string }>;
}> {
  const mb = new MusicBrainzService();
  const match = await mb.findBestMatch(artistName);
  
  if (match) {
    return { mbid: match.id };
  }
  
  // No confident match - return candidates for manual selection
  const candidates = await mb.searchArtist(artistName, 10);
  return {
    mbid: null,
    candidates: candidates.map(c => ({
      id: c.id,
      name: c.name,
      disambiguation: c.disambiguation,
      country: c.country,
    })),
  };
}
