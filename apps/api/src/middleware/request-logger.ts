/**
 * Request Logging Middleware
 * 
 * Logs incoming requests with timing and correlation IDs.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      correlationId: req.correlationId
    };
    
    // Skip health check logging to reduce noise
    if (req.path === '/health') {
      return;
    }
    
    if (res.statusCode >= 500) {
      logger.error('Request completed with error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });
  
  next();
}
