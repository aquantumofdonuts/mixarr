/**
 * Error Handler Middleware Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError, z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

import { errorHandler } from '../../src/middleware/error-handler.js';

// Mock the logger to prevent console output during tests
vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Helper to create mock request/response
function createMocks() {
  const req = {
    correlationId: 'test-correlation-id',
  } as Request;

  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;

  const next = vi.fn() as NextFunction;

  return { req, res, next };
}

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generic errors', () => {
    it('returns 500 for generic errors', () => {
      const { req, res, next } = createMocks();
      const error = new Error('Something went wrong');

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
    });

    it('includes correlation ID in error response', () => {
      const { req, res, next } = createMocks();
      const error = new Error('Test error');

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.correlationId).toBe('test-correlation-id');
    });

    it('returns error code INTERNAL_ERROR for unknown errors', () => {
      const { req, res, next } = createMocks();
      const error = new Error('Unknown error');

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.code).toBe('INTERNAL_ERROR');
    });

    it('uses "unknown" correlation ID when not set on request', () => {
      const { res, next } = createMocks();
      const req = {} as Request; // No correlationId
      const error = new Error('Test error');

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.correlationId).toBe('unknown');
    });
  });

  describe('ZodError handling', () => {
    it('handles ZodError with 400 status', () => {
      const { req, res, next } = createMocks();

      // Create a real ZodError
      const schema = z.object({ name: z.string() });
      let zodError: ZodError;
      try {
        schema.parse({ name: 123 });
      } catch (e) {
        zodError = e as ZodError;
      }

      errorHandler(zodError!, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.code).toBe('VALIDATION_ERROR');
    });

    it('includes validation details for ZodError', () => {
      const { req, res, next } = createMocks();

      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(0),
      });
      let zodError: ZodError;
      try {
        schema.parse({ email: 'invalid', age: -5 });
      } catch (e) {
        zodError = e as ZodError;
      }

      errorHandler(zodError!, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.details).toBeInstanceOf(Array);
      expect(response.error.details.length).toBeGreaterThan(0);
    });

    it('formats validation details with path and message', () => {
      const { req, res, next } = createMocks();

      const schema = z.object({
        user: z.object({
          name: z.string(),
        }),
      });
      let zodError: ZodError;
      try {
        schema.parse({ user: { name: 123 } });
      } catch (e) {
        zodError = e as ZodError;
      }

      errorHandler(zodError!, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.details[0]).toHaveProperty('path');
      expect(response.error.details[0]).toHaveProperty('message');
      expect(response.error.details[0].path).toBe('user.name');
    });

    it('returns message "Invalid request data" for ZodError', () => {
      const { req, res, next } = createMocks();

      const schema = z.object({ name: z.string() });
      let zodError: ZodError;
      try {
        schema.parse({});
      } catch (e) {
        zodError = e as ZodError;
      }

      errorHandler(zodError!, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Invalid request data');
    });
  });

  describe('AppError handling', () => {
    it('uses custom statusCode from error', () => {
      const { req, res, next } = createMocks();
      const error: AppError = new Error('Not found');
      error.statusCode = 404;

      errorHandler(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('uses custom error code from error', () => {
      const { req, res, next } = createMocks();
      const error: AppError = new Error('Resource not found');
      error.statusCode = 404;
      error.code = 'NOT_FOUND';

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.code).toBe('NOT_FOUND');
    });

    it('uses REQUEST_ERROR code for 4xx errors without custom code', () => {
      const { req, res, next } = createMocks();
      const error: AppError = new Error('Bad request');
      error.statusCode = 400;

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.code).toBe('REQUEST_ERROR');
    });

    it('uses error message in response', () => {
      const { req, res, next } = createMocks();
      const error: AppError = new Error('Custom error message');
      error.statusCode = 422;

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Custom error message');
    });

    it('defaults to "Internal server error" when no message', () => {
      const { req, res, next } = createMocks();
      const error: AppError = new Error();
      error.message = '';

      errorHandler(error, req, res, next);

      const response = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(response.error.message).toBe('Internal server error');
    });
  });
});
