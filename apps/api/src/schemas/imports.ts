import { z } from 'zod';

// ============================================================================
// Shared field schemas
// ============================================================================

/**
 * Cron expression regex — standard 5-field cron (minute hour dom month dow)
 * Supports: numbers, ranges (1-5), lists (1,3,5), steps, wildcards
 */
const cronRegex = /^(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)\s+(\*(?:\/[0-9]+)?|[0-9,\-\/]+)$/;

/**
 * Schedule field — valid 5-field cron expression, empty string, or null
 */
export const scheduleField = z.union([
  z.literal(''),
  z.literal(null),
  z.string().regex(cronRegex, 'Invalid cron expression'),
]).nullable().optional();

/**
 * Result handling options for import sources
 */
export const importResultHandling = z.enum(['preview', 'queue', 'auto']);

/**
 * Valid import source types
 */
export const importSourceType = z.enum([
  'liked_songs',
  'saved_albums',
  'followed_artists',
  'playlist',
]);

/**
 * Param schema for routes with :id
 */
export const importIdParamSchema = z.object({
  id: z.coerce.number().int().positive('ID must be a positive integer'),
});

/**
 * Param schema for routes with :connectionId
 */
export const connectionIdParamSchema = z.object({
  connectionId: z.coerce.number().int().positive('Connection ID must be a positive integer'),
});

// ============================================================================
// Import source CRUD schemas
// ============================================================================

/**
 * Schema for creating an import source (POST /)
 */
export const createImportSchema = z.object({
  type: importSourceType,
  name: z.string().min(1, 'Name is required').max(255),
  externalId: z.string().max(255).optional().nullable(),
  schedule: scheduleField,
  resultHandling: importResultHandling.optional().default('preview'),
  isActive: z.boolean().optional().default(true),
});

/**
 * Schema for updating an import source (PUT /:id)
 * All fields optional for partial updates
 */
export const updateImportSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  externalId: z.string().max(255).optional().nullable(),
  schedule: scheduleField,
  resultHandling: importResultHandling.optional(),
  isActive: z.boolean().optional(),
});

// ============================================================================
// Review queue schemas
// ============================================================================

/**
 * Valid review statuses
 */
export const reviewStatusEnum = z.enum(['pending', 'approved', 'rejected']);

/**
 * Query params for GET /review/queue
 */
export const reviewQueueQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional().default(50),
  status: reviewStatusEnum.optional().default('pending'),
  itemType: z.enum(['artist', 'album']).optional(),
});

/**
 * Body for PUT /review/:id — single review item status update
 */
export const updateReviewItemSchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

/**
 * Body for POST /review/bulk — bulk review
 */
export const bulkReviewSchema = z.object({
  ids: z.array(z.number().int().positive().safe()).min(1, 'At least one ID is required').max(100),
  status: z.enum(['approved', 'rejected']),
});

// ============================================================================
// Preview / import schemas
// ============================================================================

/**
 * Query params for GET /preview/spotify/:connectionId and GET /preview/lastfm/:connectionId
 */
export const previewQuerySchema = z.object({
  ai: z.enum(['true', 'false']).optional(),
  similar: z.enum(['true', 'false']).optional(),
});

/**
 * Body for POST /preview/import
 */
export const previewImportSchema = z.object({
  artistNames: z.array(z.string().min(1)).min(1, 'At least one artist name is required'),
  mode: z.enum(['preview', 'queue', 'auto']).optional().default('auto'),
});

// ============================================================================
// Public playlist schemas
// ============================================================================

/**
 * Body for POST /public-playlist/preview
 */
export const publicPlaylistPreviewSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  includeAllArtists: z.boolean().optional(),
});

/**
 * Body for POST /public-playlist/import
 */
export const publicPlaylistImportSchema = z.object({
  url: z.string().url('Must be a valid URL'),
  selectedArtists: z.array(z.string().min(1)).optional(),
  includeAllArtists: z.boolean().optional(),
});

// ============================================================================
// Inferred types
// ============================================================================

export type CreateImportInput = z.infer<typeof createImportSchema>;
export type UpdateImportInput = z.infer<typeof updateImportSchema>;
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;
export type UpdateReviewItemInput = z.infer<typeof updateReviewItemSchema>;
export type BulkReviewInput = z.infer<typeof bulkReviewSchema>;
export type PreviewImportInput = z.infer<typeof previewImportSchema>;
export type PublicPlaylistPreviewInput = z.infer<typeof publicPlaylistPreviewSchema>;
export type PublicPlaylistImportInput = z.infer<typeof publicPlaylistImportSchema>;
