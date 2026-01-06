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
 * Creates Express middleware that validates request body against a Zod schema.
 *
 * On validation failure, responds with 400 status and structured error details.
 * On success, replaces req.body with the parsed/transformed data.
 *
 * @param schema - The Zod schema to validate the request body against
 * @returns Express middleware function that validates and transforms req.body
 *
 * @example
 * ```typescript
 * const createUserSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.string().email()
 * });
 * router.post('/users', validateBody(createUserSchema), createUserHandler);
 * ```
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
 * Creates Express middleware that validates query parameters against a Zod schema.
 *
 * On validation failure, responds with 400 status and structured error details.
 * On success, replaces req.query with the parsed/transformed data.
 *
 * @param schema - The Zod schema to validate query parameters against
 * @returns Express middleware function that validates and transforms req.query
 *
 * @example
 * ```typescript
 * const paginationSchema = z.object({
 *   page: z.coerce.number().min(1).default(1),
 *   limit: z.coerce.number().min(1).max(100).default(20)
 * });
 * router.get('/items', validateQuery(paginationSchema), listItemsHandler);
 * ```
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
 * Creates Express middleware that validates route parameters against a Zod schema.
 *
 * On validation failure, responds with 400 status and structured error details.
 * On success, replaces req.params with the parsed/transformed data.
 *
 * @param schema - The Zod schema to validate route parameters against
 * @returns Express middleware function that validates and transforms req.params
 *
 * @example
 * ```typescript
 * const idParamSchema = z.object({
 *   id: z.string().uuid()
 * });
 * router.get('/users/:id', validateParams(idParamSchema), getUserHandler);
 * ```
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
