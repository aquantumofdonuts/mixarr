/**
 * Validation Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../../src/middleware/validate.js';
import type { Request, Response, NextFunction } from 'express';

// Helper to create mock request/response
function createMocks(options: { body?: any; query?: any; params?: any } = {}) {
  const req = {
    body: options.body ?? {},
    query: options.query ?? {},
    params: options.params ?? {}
  } as Request;
  
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn()
  } as unknown as Response;
  
  const next = vi.fn() as NextFunction;
  
  return { req, res, next };
}

describe('validateBody', () => {
  const schema = z.object({
    name: z.string().min(1),
    email: z.string().email()
  });

  it('calls next() when body is valid', () => {
    const { req, res, next } = createMocks({
      body: { name: 'Test', email: 'test@example.com' }
    });
    
    validateBody(schema)(req, res, next);
    
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 when body is invalid', () => {
    const { req, res, next } = createMocks({
      body: { name: '', email: 'not-an-email' }
    });
    
    validateBody(schema)(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('includes validation details in error response', () => {
    const { req, res, next } = createMocks({
      body: { name: '', email: 'invalid' }
    });
    
    validateBody(schema)(req, res, next);
    
    const response = (res.json as any).mock.calls[0][0];
    expect(response.code).toBe('VALIDATION_ERROR');
    expect(response.details).toBeDefined();
    expect(Object.keys(response.details).length).toBeGreaterThan(0);
  });
});

describe('validateQuery', () => {
  const schema = z.object({
    page: z.string().regex(/^\d+$/),
    limit: z.string().regex(/^\d+$/).optional()
  });

  it('calls next() when query is valid', () => {
    const { req, res, next } = createMocks({
      query: { page: '1', limit: '10' }
    });
    
    validateQuery(schema)(req, res, next);
    
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when query is invalid', () => {
    const { req, res, next } = createMocks({
      query: { page: 'abc' }
    });
    
    validateQuery(schema)(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateParams', () => {
  const schema = z.object({
    id: z.string().uuid()
  });

  it('calls next() when params are valid', () => {
    const { req, res, next } = createMocks({
      params: { id: '550e8400-e29b-41d4-a716-446655440000' }
    });
    
    validateParams(schema)(req, res, next);
    
    expect(next).toHaveBeenCalled();
  });

  it('returns 400 when params are invalid', () => {
    const { req, res, next } = createMocks({
      params: { id: 'not-a-uuid' }
    });
    
    validateParams(schema)(req, res, next);
    
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
