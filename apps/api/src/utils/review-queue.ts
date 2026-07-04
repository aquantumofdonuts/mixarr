/**
 * Review Queue Utilities
 * 
 * Provides deduplication when adding items to the review queue.
 * Matches by: MBID > SpotifyId > Normalized artist name
 */

import prisma from '../lib/db.js';
import { normalizeArtistName } from './deduplication.js';

export interface ReviewItemInput {
  userId: number;
  artistName: string;
  mbid?: string;
  spotifyId?: string;
  albumName?: string;
  albumMbid?: string;
  releaseYear?: number;
  releaseDate?: string;
  releaseType?: string;
  source: string;
  itemType?: 'artist' | 'album';
  /**
   * Dedup strategy for name-based collision resolution.
   * - 'default' (or omitted): match by MBID > SpotifyId > normalized name
   * - 'relaxed': match by MBID > SpotifyId only; skips normalized-name collapse
   *   for ambiguous artist names that share a common token (e.g. "The" prefixed names).
   */
  dedupStrategy?: 'default' | 'relaxed';
}

/**
 * Find existing review item or create new one
 * Matches by: MBID > SpotifyId > Normalized artist name
 * If found: appends source to existing item's sources
 * If not found: creates new item
 */
export async function findOrCreateReviewItem(input: ReviewItemInput): Promise<{ id: number; created: boolean }> {
  const { userId, artistName, mbid, spotifyId, source, albumName, albumMbid, releaseYear, releaseDate, releaseType, itemType = 'artist', dedupStrategy = 'default' } = input;
  
  // Try to find existing by MBID first (most reliable)
  if (mbid) {
    const existing = await prisma.reviewItem.findFirst({
      where: { userId, mbid, status: 'pending' },
    });
    if (existing) {
      // Update sources if not already included
      if (!existing.source.includes(source)) {
        await prisma.reviewItem.update({
          where: { id: existing.id },
          data: { source: `${existing.source}, ${source}` },
        });
      }
      return { id: existing.id, created: false };
    }
  }
  
  // Try SpotifyId
  if (spotifyId) {
    const existing = await prisma.reviewItem.findFirst({
      where: { userId, spotifyId, status: 'pending' },
    });
    if (existing) {
      if (!existing.source.includes(source)) {
        await prisma.reviewItem.update({
          where: { id: existing.id },
          data: { 
            source: `${existing.source}, ${source}`,
            mbid: existing.mbid || mbid, // Fill in MBID if we have it now
          },
        });
      }
      return { id: existing.id, created: false };
    }
  }
  
  // Try normalized name match (skipped in relaxed mode to prevent
  // collapsing distinct artists that share a normalized token)
  if (dedupStrategy !== 'relaxed') {
    const normalizedName = normalizeArtistName(artistName);
    const pending = await prisma.reviewItem.findMany({
      where: { userId, status: 'pending' },
    });
    
    for (const item of pending) {
      if (normalizeArtistName(item.artistName) === normalizedName) {
        if (!item.source.includes(source)) {
          await prisma.reviewItem.update({
            where: { id: item.id },
            data: { 
              source: `${item.source}, ${source}`,
              mbid: item.mbid || mbid,
              spotifyId: item.spotifyId || spotifyId,
            },
          });
        }
        return { id: item.id, created: false };
      }
    }
  }
  
  // No match - create new
  const created = await prisma.reviewItem.create({
    data: {
      userId,
      itemType,
      artistName,
      mbid,
      spotifyId,
      albumName,
      albumMbid,
      releaseYear,
      releaseDate,
      releaseType,
      source,
      status: 'pending',
    },
  });
  
  return { id: created.id, created: true };
}
