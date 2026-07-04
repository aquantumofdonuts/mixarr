/**
 * Authentication Rate Limiter
 * 
 * Protects auth endpoints against brute force attacks.
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response } from 'express';

// Rate limiter for login attempts
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use IP address for rate limiting
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ 
      error: 'Too many login attempts, please try again after 15 minutes' 
    });
  },
});

// Rate limiter for setup endpoint (stricter - one-time setup)
export const setupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 attempts per hour
  message: { error: 'Too many setup attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ 
      error: 'Too many setup attempts, please try again later' 
    });
  },
});

// Rate limiter for user creation (admin only, but still protect)
export const createUserLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // 20 users per hour
  message: { error: 'Too many user creation attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ 
      error: 'Too many user creation attempts, please try again later' 
    });
  },
});

/**
 * General API rate limiter for authenticated routes
 * 100 requests per minute per IP - balanced for normal usage
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: { error: 'Too many requests, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ 
      error: 'Too many requests, please slow down' 
    });
  },
  skip: (req: Request) => {
    // Skip rate limiting for health checks. The limiter is mounted at /api,
    // which strips that prefix from req.path, so compare against the full
    // original URL (falling back to req.path for direct invocation).
    const fullPath = (req.originalUrl || req.path).split('?')[0];
    return fullPath === '/api/health' || fullPath.startsWith('/api/health/');
  },
});
