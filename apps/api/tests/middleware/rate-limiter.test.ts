/**
 * Rate Limiter Middleware Tests
 * 
 * Tests for rate limiting middleware used to protect against abuse.
 */

import { describe, it, expect, vi } from 'vitest';
import { apiLimiter, loginLimiter, setupLimiter, createUserLimiter } from '../../src/middleware/rate-limiter.js';
import type { Request, Response, NextFunction } from 'express';

describe('Rate Limiters', () => {
  describe('apiLimiter', () => {
    it('should be a function (middleware)', () => {
      expect(typeof apiLimiter).toBe('function');
    });

    it('should have middleware signature (req, res, next)', () => {
      // Express middleware has arity of 3
      expect(apiLimiter.length).toBe(3);
    });

    it('should call next for normal requests within limit', async () => {
      const req = {
        ip: '127.0.0.1',
        path: '/api/test',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      // Call the middleware
      await new Promise<void>((resolve) => {
        apiLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
    });

    it('should skip rate limiting for health check path /api/health', async () => {
      const req = {
        ip: '127.0.0.1',
        path: '/api/health',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        apiLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      // Should call next without rate limit headers for skipped paths
      expect(next).toHaveBeenCalled();
    });

    it('should skip health checks when mounted at /api (req.path has prefix stripped)', async () => {
      // Express strips the mount prefix: app.use('/api', apiLimiter) sees
      // req.path === '/health' but req.originalUrl === '/api/health'.
      const req = {
        ip: '127.0.0.1',
        path: '/health',
        originalUrl: '/api/health',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        apiLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
      // skip() short-circuits before any rate-limit headers are set
      expect(res.setHeader).not.toHaveBeenCalled();
    });

    it('should skip rate limiting for health ready path /api/health/ready', async () => {
      const req = {
        ip: '127.0.0.1',
        path: '/api/health/ready',
        headers: {},
        socket: { remoteAddress: '127.0.0.1' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        apiLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
    });
  });

  describe('loginLimiter', () => {
    it('should be a function (middleware)', () => {
      expect(typeof loginLimiter).toBe('function');
    });

    it('should have middleware signature (req, res, next)', () => {
      expect(loginLimiter.length).toBe(3);
    });

    it('should call next for requests within limit', async () => {
      const req = {
        ip: '192.168.1.1',
        path: '/api/auth/login',
        headers: {},
        socket: { remoteAddress: '192.168.1.1' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        loginLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
    });
  });

  describe('setupLimiter', () => {
    it('should be a function (middleware)', () => {
      expect(typeof setupLimiter).toBe('function');
    });

    it('should have middleware signature (req, res, next)', () => {
      expect(setupLimiter.length).toBe(3);
    });

    it('should call next for requests within limit', async () => {
      const req = {
        ip: '192.168.1.2',
        path: '/api/auth/setup',
        headers: {},
        socket: { remoteAddress: '192.168.1.2' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        setupLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
    });
  });

  describe('createUserLimiter', () => {
    it('should be a function (middleware)', () => {
      expect(typeof createUserLimiter).toBe('function');
    });

    it('should have middleware signature (req, res, next)', () => {
      expect(createUserLimiter.length).toBe(3);
    });

    it('should call next for requests within limit', async () => {
      const req = {
        ip: '192.168.1.3',
        path: '/api/users',
        headers: {},
        socket: { remoteAddress: '192.168.1.3' },
      } as unknown as Request;
      const res = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;
      const next = vi.fn() as NextFunction;

      await new Promise<void>((resolve) => {
        createUserLimiter(req, res, (...args: unknown[]) => {
          next(...args);
          resolve();
        });
      });

      expect(next).toHaveBeenCalled();
    });
  });
});
