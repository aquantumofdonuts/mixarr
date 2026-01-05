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

export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use existing header or generate new UUID
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  
  req.correlationId = correlationId;
  res.setHeader('x-correlation-id', correlationId);
  
  next();
}
