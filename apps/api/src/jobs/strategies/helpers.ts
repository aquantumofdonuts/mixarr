/**
 * Shared helpers for subscription strategies.
 *
 * Functions that are used by two or more strategy files live here
 * to avoid duplication.
 */

import type { ArtistToAdd } from './types.js';

/**
 * Extract unique artists from an array of tracks where each track has an
 * `artists` array (common pattern for Spotify and TIDAL APIs).
 */
export function extractArtistsFromTracks(
  tracks: Array<{ artists: Array<{ name: string }> }>,
  source: string,
): ArtistToAdd[] {
  const artistMap = new Map<string, ArtistToAdd>();
  for (const track of tracks) {
    for (const artist of track.artists) {
      if (!artistMap.has(artist.name)) {
        artistMap.set(artist.name, { name: artist.name, source });
      }
    }
  }
  return Array.from(artistMap.values());
}
