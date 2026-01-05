/**
 * Correlation ID Middleware Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { correlationMiddleware } from '../../src/middleware/correlation.js';
import type { Request, Response, NextFunction } from 'express';

describe('correlationMiddleware', () => {
  it('generates a correlation ID when none provided', () => {
    const req = { headers: {} } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    correlationMiddleware(req, res, next);

    expect(req.correlationId).toBeDefined();
    expect(req.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', req.correlationId);
    expect(next).toHaveBeenCalled();
  });

  it('uses existing x-correlation-id header if provided', () => {
    const existingId = 'my-custom-correlation-id';
    const req = { headers: { 'x-correlation-id': existingId } } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    correlationMiddleware(req, res, next);

    expect(req.correlationId).toBe(existingId);
    expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', existingId);
    expect(next).toHaveBeenCalled();
  });

  it('always calls next()', () => {
    const req = { headers: {} } as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next = vi.fn() as NextFunction;

    correlationMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
