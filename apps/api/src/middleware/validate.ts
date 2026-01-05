import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { z } from 'zod';

/**
 * Structured validation error response
 */
export interface ValidationError {
  error: string;
  code: 'VALIDATION_ERROR';
  details: Record<string, string[]>;
}

/**
 * Creates a validation error response
 */
function createValidationError(fieldErrors: Record<string, string[] | undefined>): ValidationError {
  const details: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0) {
      details[key] = value;
    }
  }
  return {
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details,
  };
}

/**
 * Middleware to validate request body against a Zod schema
 */
export function validateBody<T extends z.ZodSchema>(
  schema: T
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    
    if (!result.success) {
      const validationError = createValidationError(result.error.flatten().fieldErrors);
      res.status(400).json(validationError);
      return;
    }
    
    // Replace body with parsed/transformed data
    req.body = result.data;
    next();
  };
}

/**
 * Middleware to validate query parameters against a Zod schema
 */
export function validateQuery<T extends z.ZodSchema>(
  schema: T
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    
    if (!result.success) {
      const validationError = createValidationError(result.error.flatten().fieldErrors);
      res.status(400).json(validationError);
      return;
    }
    
    // Replace query with parsed/transformed data
    req.query = result.data;
    next();
  };
}

/**
 * Middleware to validate route parameters against a Zod schema
 */
export function validateParams<T extends z.ZodSchema>(
  schema: T
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    
    if (!result.success) {
      const validationError = createValidationError(result.error.flatten().fieldErrors);
      res.status(400).json(validationError);
      return;
    }
    
    // Replace params with parsed/transformed data
    req.params = result.data;
    next();
  };
}
