/**
 * Correlation ID Middleware
 * 
 * Adds a unique correlation ID to each request for tracing.
 */

import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

// Extend Express Request type to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
    }
  }
}

/**
 * Express middleware that adds a unique correlation ID to each request.
 *
 * The correlation ID is either taken from the incoming 'x-correlation-id' header
 * (useful for distributed tracing across services) or generated as a new UUID.
 * It's attached to `req.correlationId` for use in logging and set as the
 * 'x-correlation-id' response header for client-side correlation.
 *
 * @param req - Express request object (will have correlationId property added)
 * @param res - Express response object (will have x-correlation-id header set)
 * @param next - Express next function to continue middleware chain
 *
 * @example
 * ```typescript
 * // Apply globally to all routes
 * app.use(correlationMiddleware);
 *
 * // Access in route handlers
 * app.get('/api/data', (req, res) => {
 *   logger.info('Request received', { correlationId: req.correlationId });
 * });
 * ```
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use existing header or generate new UUID
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}
