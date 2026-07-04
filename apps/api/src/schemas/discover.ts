import { z } from 'zod';

/**
 * Query schema for GET /api/discover/library
 * All query params come as strings from Express
 */
export const discoverLibraryQuerySchema = z.object({
  page: z.string().regex(/^\d+$/, 'Must be a numeric string').optional(),
  limit: z.string().regex(/^\d+$/, 'Must be a numeric string').optional(),
  search: z.string().max(500, 'Search term too long').optional(),
  refresh: z.enum(['true', 'false']).optional(),
});

/**
 * Body schema for POST /api/discover/similar
 */
export const discoverSimilarSchema = z.object({
  artistNames: z.array(z.string().min(1, 'Artist name cannot be empty').max(500)).min(1, 'At least one artist name required').max(500),
  limit: z.number().int().positive().max(500).optional(),
});

/**
 * Body schema for POST /api/discover/add
 * qualityProfileId, metadataProfileId, and rootFolderPath are optional
 * because the route falls back to connection config defaults
 */
export const addArtistSchema = z.object({
  artistName: z.string().min(1, 'Artist name is required').max(500),
  mbid: z.string().uuid('Must be a valid UUID').optional(),
  qualityProfileId: z.number().int().positive().optional(),
  metadataProfileId: z.number().int().positive().optional(),
  rootFolderPath: z.string().min(1).max(1000).optional(),
});

/**
 * Query schema for GET /api/discover/deezer/chart
 * and GET /api/discover/deezer/genre/:genreId/artists
 */
export const deezerLimitQuerySchema = z.object({
  limit: z.string().regex(/^\d+$/, 'Must be a numeric string').optional(),
});

/**
 * Params schema for GET /api/discover/deezer/genre/:genreId/artists
 */
export const deezerGenreParamsSchema = z.object({
  genreId: z.string().regex(/^\d+$/, 'Must be a numeric string'),
});
