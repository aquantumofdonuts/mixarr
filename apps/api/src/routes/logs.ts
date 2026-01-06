import { Router } from 'express';
import prisma from '../lib/db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('LogsRoute');

export const logsRouter = Router();

// Constants for pagination limits
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MIN_LIMIT = 1;

logsRouter.use(requireAuth);

// Get logs with pagination
logsRouter.get('/', async (req, res) => {
  try {
    // Parse and validate limit (security: enforce min/max bounds)
    const requestedLimit = parseInt(req.query.limit as string, 10) || DEFAULT_LIMIT;
    const limit = Math.min(Math.max(requestedLimit, MIN_LIMIT), MAX_LIMIT);
    
    // Parse offset for pagination
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);
    
    const level = req.query.level as string;
    const category = req.query.category as string;
    const search = req.query.search as string;

    const where: any = {};

    if (level) {
      where.level = level;
    }

    if (category) {
      where.category = category;
    }

    // Search in message field (MySQL default collation is case-insensitive)
    if (search) {
      where.message = { contains: search };
    }

    // Fetch logs and total count in parallel for pagination
    const [logs, total] = await Promise.all([
      prisma.logEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.logEntry.count({ where }),
    ]);

    res.json({ 
      logs, 
      total,
      limit,
      offset,
      hasMore: offset + logs.length < total,
    });
  } catch (error) {
    logger.error('Failed to fetch logs', { error });
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Clear logs (admin only)
logsRouter.delete('/', requireAdmin, async (req, res) => {
  try {
    const olderThan = req.query.olderThan as string;
    const level = req.query.level as string;

    const where: any = {};

    if (olderThan) {
      where.createdAt = { lt: new Date(olderThan) };
    }

    if (level) {
      where.level = level;
    }

    const result = await prisma.logEntry.deleteMany({ where });

    res.json({ success: true, deleted: result.count });
  } catch (error) {
    logger.error('Failed to clear logs', { error });
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// Helper to add log entries (exported for use by other services)
export async function addLogEntry(
  level: 'debug' | 'info' | 'warn' | 'error',
  category: string,
  message: string,
  metadata?: Record<string, any>
) {
  try {
    await prisma.logEntry.create({
      data: {
        level,
        category,
        message,
        metadata: metadata ?? undefined,
      },
    });
  } catch (error) {
    logger.error('Failed to add log entry', { error });
  }
}
