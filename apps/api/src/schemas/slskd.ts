import { z } from 'zod';

// ============================================================================
// SEARCH SCHEMAS
// ============================================================================

/** POST /api/slskd/search — start a new search */
export const slskdSearchSchema = z.object({
  query: z.string().min(1, 'Query is required').max(500),
  options: z.object({
    searchTimeout: z.number().int().positive().max(120).optional().describe('Search timeout in seconds'),
    maximumPeerQueueLength: z.number().int().nonnegative().optional(),
    minimumPeerUploadSpeed: z.number().int().nonnegative().optional(),
    filterResponses: z.boolean().optional(),
  }).optional(),
});

/** Params for GET/DELETE /api/slskd/search/:id */
export const slskdSearchIdParamsSchema = z.object({
  id: z.string().min(1),
});

// ============================================================================
// DOWNLOAD SCHEMAS
// ============================================================================

/** POST /api/slskd/download — queue files for download */
export const slskdDownloadSchema = z.object({
  username: z.string().min(1, 'Username is required').max(200),
  files: z.array(z.object({
    filename: z.string().min(1),
    size: z.number().int().nonnegative(),
  })).min(1, 'At least one file is required').max(100),
  artistName: z.string().max(500).optional(),
  albumName: z.string().max(500).optional(),
  albumYear: z.number().int().optional(),
});

/** Query params for GET /api/slskd/downloads */
export const slskdDownloadsQuerySchema = z.object({
  status: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Params for routes with numeric :id (retry, delete) */
export const slskdDownloadIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Query params for DELETE /api/slskd/downloads/:id */
export const slskdDeleteDownloadQuerySchema = z.object({
  remove: z.enum(['true', 'false']).optional(),
});

// ============================================================================
// WEBHOOK SCHEMAS
// ============================================================================

/** POST /api/slskd/webhook — receive slskd completion events */
export const slskdWebhookSchema = z.object({
  event: z.string().min(1),
  username: z.string().optional(),
  filename: z.string().optional(),
  directory: z.string().optional(),
});

// ============================================================================
// INFERRED TYPES
// ============================================================================

export type SlskdSearchInput = z.infer<typeof slskdSearchSchema>;
export type SlskdSearchIdParams = z.infer<typeof slskdSearchIdParamsSchema>;
export type SlskdDownloadInput = z.infer<typeof slskdDownloadSchema>;
export type SlskdDownloadsQuery = z.infer<typeof slskdDownloadsQuerySchema>;
export type SlskdDownloadIdParams = z.infer<typeof slskdDownloadIdParamsSchema>;
export type SlskdDeleteDownloadQuery = z.infer<typeof slskdDeleteDownloadQuerySchema>;
export type SlskdWebhookInput = z.infer<typeof slskdWebhookSchema>;
