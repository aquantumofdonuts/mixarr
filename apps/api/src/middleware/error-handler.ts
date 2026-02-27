import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../lib/logger.js';

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

interface ErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
    details?: Array<{ path: string; message: string }>;
    stack?: string;
  };
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError | ZodError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  const correlationId = req.correlationId || 'unknown';

  // Log error with correlation ID for tracing
  logger.error('Request error', {
    correlationId,
    message: err.message,
    stack: err.stack,
  });

  // Guard against sending a response when headers have already been sent
  // (e.g., session save errors after the response was flushed)
  if (res.headersSent) {
    return;
  }

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    const response: ErrorResponse = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        correlationId,
        details: err.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
        })),
      },
    };
    res.status(400).json(response);
    return;
  }

  // Handle application errors
  const appError = err as AppError;
  const statusCode = appError.statusCode || 500;
  const code = appError.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  
  // Sanitize message for 5xx errors in production
  let message: string;
  if (statusCode >= 500 && process.env.NODE_ENV === 'production') {
    message = 'Internal server error';
  } else {
    message = appError.message || 'Internal server error';
  }

  const response: ErrorResponse = {
    error: {
      code,
      message,
      correlationId,
      ...(process.env.NODE_ENV === 'development' && { stack: appError.stack }),
    },
  };

  res.status(statusCode).json(response);
};
