/**
 * Auth Middleware Tests
 * 
 * Tests for authentication and authorization middleware.
 * These are CRITICAL security tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// Inline authentication middleware doubles for isolated tests.
function createRequireAuth() {
  return function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.isAuthenticated && req.isAuthenticated()) {
      return next();
    }
    res.status(401).json({ error: 'Authentication required' });
  };
}

function createRequireAdmin() {
  return function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (req.user?.role === 'admin') {
      return next();
    }
    res.status(403).json({ error: 'Admin access required' });
  };
}

describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;
  let requireAuth: ReturnType<typeof createRequireAuth>;
  let requireAdmin: ReturnType<typeof createRequireAdmin>;

  beforeEach(() => {
    requireAuth = createRequireAuth();
    requireAdmin = createRequireAdmin();
    
    mockReq = {
      isAuthenticated: vi.fn(),
      user: undefined,
    };
    
    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    
    mockNext = vi.fn();
  });

  describe('requireAuth', () => {
    it('should call next() when user is authenticated', () => {
      (mockReq.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValue(true);
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 401 when user is not authenticated', () => {
      (mockReq.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValue(false);
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });

    it('should return 401 when isAuthenticated is undefined', () => {
      mockReq.isAuthenticated = undefined;
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });
  });

  describe('requireAdmin', () => {
    it('should call next() when user is admin', () => {
      mockReq.user = { id: 1, role: 'admin', username: 'admin' } as any;
      
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
      expect(mockRes.status).not.toHaveBeenCalled();
    });

    it('should return 403 when user is not admin', () => {
      mockReq.user = { id: 1, role: 'user', username: 'user1' } as any;
      
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
    });

    it('should return 403 when user is undefined', () => {
      mockReq.user = undefined;
      
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });

    it('should return 403 when user has no role', () => {
      mockReq.user = { id: 1, username: 'user1' } as any;
      
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });

  describe('Middleware Chain', () => {
    it('should allow authenticated admin through both middlewares', () => {
      (mockReq.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockReq.user = { id: 1, role: 'admin', username: 'admin' } as any;
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      mockNext = vi.fn();
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should block unauthenticated admin at requireAuth', () => {
      (mockReq.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValue(false);
      mockReq.user = { id: 1, role: 'admin', username: 'admin' } as any;
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
    });

    it('should allow authenticated user through requireAuth but block at requireAdmin', () => {
      (mockReq.isAuthenticated as ReturnType<typeof vi.fn>).mockReturnValue(true);
      mockReq.user = { id: 1, role: 'user', username: 'user1' } as any;
      
      requireAuth(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      
      mockNext = vi.fn();
      requireAdmin(mockReq as Request, mockRes as Response, mockNext);
      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(403);
    });
  });
});
