/**
 * Rate Limiting Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

describe('Rate Limiting', () => {
  describe('authRateLimit behavior', () => {
    let app: express.Express;
    
    beforeEach(() => {
      // Create a fresh app with a test rate limiter
      app = express();
      
      // Use a test rate limiter with low limits
      const testRateLimit = rateLimit({
        windowMs: 1000, // 1 second window
        max: 2, // 2 requests max
        message: {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests'
          }
        },
        standardHeaders: true,
        legacyHeaders: false
      });
      
      app.post('/test-login', testRateLimit, (req, res) => {
        res.json({ success: true });
      });
    });

    it('allows requests under the limit', async () => {
      const res1 = await request(app).post('/test-login');
      const res2 = await request(app).post('/test-login');
      
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it('blocks requests over the limit', async () => {
      await request(app).post('/test-login');
      await request(app).post('/test-login');
      const res3 = await request(app).post('/test-login');
      
      expect(res3.status).toBe(429);
      expect(res3.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('includes rate limit headers', async () => {
      const res = await request(app).post('/test-login');
      
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(res.headers['ratelimit-remaining']).toBeDefined();
    });
  });

  describe('actual rate limit middleware exports', () => {
    it('exports loginLimiter middleware', async () => {
      const { loginLimiter } = await import('../../src/middleware/rate-limiter.js');
      expect(loginLimiter).toBeDefined();
      expect(typeof loginLimiter).toBe('function');
    });

    it('exports setupLimiter middleware', async () => {
      const { setupLimiter } = await import('../../src/middleware/rate-limiter.js');
      expect(setupLimiter).toBeDefined();
      expect(typeof setupLimiter).toBe('function');
    });

    it('exports createUserLimiter middleware', async () => {
      const { createUserLimiter } = await import('../../src/middleware/rate-limiter.js');
      expect(createUserLimiter).toBeDefined();
      expect(typeof createUserLimiter).toBe('function');
    });
  });
});
