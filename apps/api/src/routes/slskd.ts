/**
 * slskd API Routes
 * 
 * Provides endpoints for:
 * - Search: Start searches, poll results, delete searches
 * - Downloads: Queue files, track download status
 * 
 * All routes require authentication and use the SlskdService internally.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import prisma from '../lib/db.js';
import { serializeForJson } from '../utils/serialize.js';
import { Prisma } from '@prisma/client';
import { SlskdService } from '../services/slskd.js';
import { SlskdOrganizerService } from '../services/slskd-organizer.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  slskdSearchSchema,
  slskdSearchIdParamsSchema,
  slskdDownloadSchema,
  slskdDownloadsQuerySchema,
  slskdDownloadIdParamsSchema,
  slskdDeleteDownloadQuerySchema,
  slskdWebhookSchema,
} from '../schemas/slskd.js';
import { createLogger } from '../lib/logger.js';
import { enqueueSlskdDownload, SLSKD_QUEUE_NAME } from '../jobs/slskd-operations-queue.js';
import { isSlskdRateLimitingEnabled } from '../lib/settings.js';
import { QueueEvents } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';

const log = createLogger('SlskdRoutes');

/**
 * slskd reports remote filenames/directories as the peer's full path using
 * whatever separator the peer's OS uses — almost always Windows `\`, since
 * most Soulseek peers are Windows clients (confirmed live 2026-07-21).
 * Extracts just the final path segment regardless of separator, so the
 * result can be validated as a plain path component below.
 */
export function slskdBasename(remotePath: string): string {
  const segments = remotePath.split(/[\\/]+/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : remotePath;
}

/**
 * Validate path component to prevent directory traversal attacks
 * Rejects: .., /, \, null bytes, absolute paths
 */
function isPathComponentSafe(component: string): boolean {
  if (!component || typeof component !== 'string') return false;
  
  // Reject path traversal patterns
  if (component.includes('..')) return false;
  
  // Reject path separators (absolute or relative paths)
  if (component.includes('/') || component.includes('\\')) return false;
  
  // Reject null bytes
  if (component.includes('\0')) return false;
  
  // Reject if it starts with path separator (absolute path)
  if (component.startsWith('/') || component.startsWith('\\')) return false;
  
  return true;
}

const router = Router();

// QueueEvents for waiting on job completion
const queueEvents = new QueueEvents(SLSKD_QUEUE_NAME, {
  connection: createRedisConnection(),
});

// All routes require authentication
router.use(requireAuth);

// Rate limiter for authenticated API routes
// Prevents abuse by limiting to 60 requests per minute per user session
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(apiLimiter);

/**
 * Helper to get slskd connection and service
 * Returns null if no enabled slskd connection exists
 */
async function getSlskdService(): Promise<{ service: SlskdService; connectionId: number } | null> {
  const connection = await prisma.connection.findFirst({
    where: { type: 'slskd', isActive: true },
  });

  if (!connection) {
    return null;
  }

  const config = connection.config as { url: string; apiKey: string };
  return {
    service: new SlskdService({ url: config.url, apiKey: config.apiKey }),
    connectionId: connection.id,
  };
}

// ============================================================================
// SEARCH ENDPOINTS
// ============================================================================

/**
 * POST /api/slskd/search - Start a new search
 * 
 * Body:
 *   - query: string (required) - Search text
 *   - options: object (optional) - Search options (filterResponses, minimumPeerUploadSpeed, etc.)
 * 
 * Returns: SlskdSearch object with id, searchText, state
 */
router.post('/search', validateBody(slskdSearchSchema), async (req: Request, res: Response) => {
  try {
    const { query, options } = req.body;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No Soulseek connection configured. Add one in Settings → Connections.' });
      return;
    }

    const result = await slskd.service.search(query, options);
    res.json(result);
  } catch (error) {
    log.error('slskd search failed', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Search failed' });
  }
});

/**
 * GET /api/slskd/search/:id - Get search results
 * 
 * Params:
 *   - id: string - Search ID from POST /search
 * 
 * Returns: SlskdSearch object with responses
 */
router.get('/search/:id', validateParams(slskdSearchIdParamsSchema), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No Soulseek connection configured. Add one in Settings → Connections.' });
      return;
    }

    const result = await slskd.service.getSearchResults(id);
    res.json(result);
  } catch (error) {
    log.error('Failed to get search results', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to get search results' });
  }
});

/**
 * DELETE /api/slskd/search/:id - Cancel/delete a search
 * 
 * Params:
 *   - id: string - Search ID to delete
 * 
 * Returns: { success: true }
 */
router.delete('/search/:id', validateParams(slskdSearchIdParamsSchema), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No Soulseek connection configured. Add one in Settings → Connections.' });
      return;
    }

    await slskd.service.deleteSearch(id);
    res.json({ success: true });
  } catch (error) {
    log.error('Failed to delete search', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to delete search' });
  }
});

// ============================================================================
// DOWNLOAD ENDPOINTS
// ============================================================================

/**
 * POST /api/slskd/download - Queue files for download
 * 
 * Body:
 *   - username: string (required) - Soulseek username to download from
 *   - files: array (required) - Array of { filename, size } objects
 *   - artistName: string (optional) - Artist name for tracking
 *   - albumName: string (optional) - Album name for tracking
 *   - albumYear: number (optional) - Album year for tracking
 * 
 * Returns: { success: true, downloads: SlskdDownload[] }
 */
router.post('/download', validateBody(slskdDownloadSchema), async (req: Request, res: Response) => {
  try {
    const { username, files, artistName, albumName, albumYear } = req.body;

    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No Soulseek connection configured. Add one in Settings → Connections.' });
      return;
    }

    // Check if rate limiting is enabled
    const useQueue = await isSlskdRateLimitingEnabled();

    // Queue the download in slskd
    try {
      if (useQueue) {
        // Rate-limited path: enqueue each file individually
        for (const file of files) {
          const job = await enqueueSlskdDownload({
            username,
            filename: file.filename,
            connectionId: slskd.connectionId,
          });
          await job.waitUntilFinished(queueEvents, 10000);
        }
      } else {
        // Legacy path: direct slskd call
        await slskd.service.queueDownload(username, files);
      }
    } catch (error) {
      // Handle queue full errors
      if (error instanceof Error && error.message.includes('queue is full')) {
        res.status(429).json({ error: 'Download queue is full. Please try again later.' });
        return;
      }
      throw error;
    }

    // Track each file in our database
    const downloads = await Promise.all(
      files.map((file: { filename: string; size: number }) =>
        prisma.slskdDownload.create({
          data: {
            connectionId: slskd.connectionId,
            username,
            artistName: artistName || 'Unknown Artist',
            albumName: albumName || '',
            albumYear,
            filename: file.filename,
            fileSize: file.size,
            status: 'pending',
          },
        })
      )
    );

    res.json(serializeForJson({ success: true, downloads }));
  } catch (error) {
    log.error('Failed to queue download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to queue download' });
  }
});

/**
 * GET /api/slskd/downloads - Get tracked downloads
 * 
 * Query params:
 *   - status: string (optional) - Filter by status (comma-separated for multiple)
 *   - limit: number (optional) - Max results (default 100)
 * 
 * Returns: Array of SlskdDownload objects, most recent first
 */
router.get('/downloads', validateQuery(slskdDownloadsQuerySchema), async (req: Request, res: Response) => {
  try {
    const { status, limit } = req.query as { status?: string; limit?: number };
    
    // Build where clause with proper Prisma types
    const where: Prisma.SlskdDownloadWhereInput = {};
    
    if (status && typeof status === 'string') {
      const statuses = status.split(',').map(s => s.trim());
      if (statuses.length === 1) {
        where.status = statuses[0];
      } else {
        where.status = { in: statuses };
      }
    }
    
    const downloads = await prisma.slskdDownload.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit || 100,
    });
    res.json(serializeForJson(downloads));
  } catch (error) {
    log.error('Failed to get downloads', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to get downloads' });
  }
});

/**
 * POST /api/slskd/downloads/:id/retry - Retry a failed download
 * 
 * Params:
 *   - id: number - Download ID
 * 
 * Returns: { success: true, download: SlskdDownload }
 */
router.post('/downloads/:id/retry', validateParams(slskdDownloadIdParamsSchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    
    const download = await prisma.slskdDownload.findUnique({ where: { id } });
    
    if (!download) {
      res.status(404).json({ error: 'Download not found' });
      return;
    }
    
    if (download.status !== 'failed') {
      res.status(400).json({ error: 'Only failed downloads can be retried' });
      return;
    }
    
    const slskd = await getSlskdService();
    if (!slskd) {
      res.status(400).json({ error: 'No Soulseek connection configured. Add one in Settings → Connections.' });
      return;
    }
    
    // Check if rate limiting is enabled
    const useQueue = await isSlskdRateLimitingEnabled();
    
    // Queue download again
    try {
      if (useQueue) {
        // Rate-limited path: enqueue download
        const job = await enqueueSlskdDownload({
          username: download.username,
          filename: download.filename,
          connectionId: slskd.connectionId,
        });
        await job.waitUntilFinished(queueEvents, 10000);
      } else {
        // Legacy path: direct slskd call
        await slskd.service.queueDownload(download.username, [{
          filename: download.filename,
          size: Number(download.fileSize),
        }]);
      }
    } catch (error) {
      // Handle queue full errors
      if (error instanceof Error && error.message.includes('queue is full')) {
        res.status(429).json({ error: 'Download queue is full. Please try again later.' });
        return;
      }
      throw error;
    }
    
    // Update status
    const updated = await prisma.slskdDownload.update({
      where: { id },
      data: { status: 'pending', error: null },
    });
    
    res.json(serializeForJson({ success: true, download: updated }));
  } catch (error) {
    log.error('Failed to retry download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to retry download' });
  }
});

/**
 * DELETE /api/slskd/downloads/:id - Cancel or remove a download
 * 
 * Params:
 *   - id: number - Download ID
 * 
 * Query params:
 *   - remove: boolean (optional) - If true, delete record; otherwise cancel
 * 
 * Returns: { success: true }
 */
router.delete('/downloads/:id', validateParams(slskdDownloadIdParamsSchema), validateQuery(slskdDeleteDownloadQuerySchema), async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    const remove = req.query.remove === 'true';
    
    const download = await prisma.slskdDownload.findUnique({ where: { id } });
    
    if (!download) {
      res.status(404).json({ error: 'Download not found' });
      return;
    }
    
    if (remove) {
      // Delete the record entirely
      await prisma.slskdDownload.delete({ where: { id } });
      res.json({ success: true, removed: true });
    } else {
      // Cancel the download (set status to cancelled)
      await prisma.slskdDownload.update({
        where: { id },
        data: { status: 'cancelled' },
      });
      res.json({ success: true, cancelled: true });
    }
  } catch (error) {
    log.error('Failed to cancel/remove download', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Failed to cancel/remove download' });
  }
});

// ============================================================================
// WEBHOOK ENDPOINTS
// ============================================================================

/**
 * Rate limiter for webhook endpoint
 * Prevents abuse by limiting to 100 requests per minute per IP
 */
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many webhook requests, please try again later' },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

/**
 * POST /api/slskd/webhook - Receive slskd completion events
 * 
 * Body:
 *   - event: string - Event type (DownloadComplete, etc.)
 *   - username: string - Soulseek username
 *   - filename: string - Downloaded file path
 *   - directory: string - Directory name
 * 
 * Returns: { success: true, organized: boolean }
 * 
 * Auth: Protected by router-level requireAuth middleware.
 */
router.post('/webhook', webhookLimiter, validateBody(slskdWebhookSchema), async (req: Request, res: Response) => {
  try {
    const { event, username, filename, directory } = req.body;

    // Only handle download completion events
    if (event !== 'DownloadComplete') {
      res.json({ success: true, ignored: true });
      return;
    }

    log.info('slskd webhook received', { event, username, filename });

    // directory/filename are the peer's full remote path (backslash-delimited
    // for Windows peers) — reduce to the leaf segment before validating as a
    // plain path component, same as the poll job does for the same payload shape.
    const safeDirectory = slskdBasename(directory);
    const safeFilename = slskdBasename(filename);

    if (!isPathComponentSafe(username)) {
      log.warn('Path traversal attempt in username', { username });
      res.status(400).json({ error: 'Invalid path in username' });
      return;
    }

    if (!isPathComponentSafe(safeDirectory)) {
      log.warn('Path traversal attempt in directory', { directory });
      res.status(400).json({ error: 'Invalid path in directory' });
      return;
    }

    if (!isPathComponentSafe(safeFilename)) {
      log.warn('Path traversal attempt in filename', { filename });
      res.status(400).json({ error: 'Invalid path in filename' });
      return;
    }

    // Get connection config
    const connection = await prisma.connection.findFirst({
      where: { type: 'slskd', isActive: true },
    });

    if (!connection) {
      res.status(400).json({ error: 'No slskd connection configured' });
      return;
    }

    const config = connection.config as {
      url: string;
      apiKey: string;
      downloadDir?: string;
      musicLibraryDir?: string;
    };

    // Find matching download record
    const download = await prisma.slskdDownload.findFirst({
      where: {
        username,
        filename: { contains: safeFilename },
        status: { in: ['pending', 'downloading'] },
      },
    });

    if (!download) {
      log.warn('Webhook for unknown download', { username, filename });
      res.json({ success: true, matched: false });
      return;
    }

    const downloadDir = config.downloadDir || '/data/slskd/downloads';
    const musicLibraryDir = config.musicLibraryDir || '/data/plex/music';

    // Build download path with validated components. slskd never
    // namespaces completed downloads by username and flattens the
    // remote directory to just its leaf name — confirmed live 2026-07-21
    // against real files on disk (see slskd-poll.ts for the same fix).
    const downloadPath = `${downloadDir}/${safeDirectory}/${safeFilename}`;

    // Atomic status update - only update if still in expected state
    // This prevents race conditions where both webhook and poll job try to organize
    // Concurrency model: Both webhook and poll job can detect completion, but only one
    // succeeds in transitioning to 'organizing'. Include 'organizing' to retry stuck downloads.
    const updated = await prisma.slskdDownload.updateMany({
      where: {
        id: download.id,
        status: { in: ['pending', 'downloading', 'organizing'] },
      },
      data: {
        downloadPath,
        status: 'organizing',
      },
    });

    // Check if we won the race
    if (updated.count === 0) {
      // Another process already started organizing this download
      log.debug('Download already being organized by another process', { downloadId: download.id });
      res.json({ success: true, organized: false });
      return;
    }

    // We won the race - proceed with organization
    const organizer = new SlskdOrganizerService({ downloadDir, musicLibraryDir });

    try {
      const finalPath = await organizer.organizeFile(download.id);
      log.info('Webhook triggered file organization', { downloadId: download.id, finalPath });
      res.json({ success: true, organized: true, finalPath });
    } catch (orgError) {
      log.error('Webhook organization failed', { downloadId: download.id, error: orgError });
      await prisma.slskdDownload.update({
        where: { id: download.id },
        data: { status: 'failed', error: String(orgError) },
      });
      res.status(500).json({ error: 'Organization failed' });
    }
  } catch (error) {
    log.error('Webhook processing failed', { error: error instanceof Error ? error.message : error });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});
/**
 * Cleanup function for graceful shutdown
 * Call this when the application is shutting down
 */
export async function cleanupQueueEvents(): Promise<void> {
  await queueEvents.close();
}
export default router;
