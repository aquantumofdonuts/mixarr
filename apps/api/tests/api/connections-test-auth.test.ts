/**
 * Connection Test Endpoint Auth Tests
 * 
 * Verifies SSRF protection: POST /api/connections/test requires
 * authentication after setup (users exist), open during setup (no users).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';

const mockUserCount = vi.fn();
const mockIsAuthenticated = vi.fn();

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    user: { count: mockUserCount },
    connection: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    globalSetting: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

// Mock auth middleware (no-op — we test inline checks)
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock validate middleware (passthrough)
vi.mock('../../src/middleware/validate.js', () => ({
  validateBody: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateParams: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  validateQuery: () => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// Mock logger
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock services
vi.mock('../../src/services/lidarr.js', () => ({ LidarrService: vi.fn() }));
vi.mock('../../src/services/slskd.js', () => ({ SlskdService: vi.fn() }));
vi.mock('../../src/services/lastfm.js', () => ({ LastfmService: vi.fn() }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: vi.fn() }));
vi.mock('../../src/lib/settings.js', () => ({ getBaseUrl: vi.fn() }));

describe('POST /api/connections/test — SSRF protection', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    // Simulate unauthenticated request
    app.use((req: any, _res, next) => {
      req.isAuthenticated = mockIsAuthenticated;
      req.user = undefined;
      next();
    });
    const { connectionsRouter } = await import('../../src/routes/connections.js');
    app.use('/api/connections', connectionsRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should reject unauthenticated requests after setup', async () => {
    mockUserCount.mockResolvedValue(1); // Users exist = setup complete
    mockIsAuthenticated.mockReturnValue(false);

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'lidarr', url: 'http://169.254.169.254/latest/meta-data', apiKey: 'test' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, error: 'Authentication required' });
  });

  it('should allow authenticated non-admin requests after setup', async () => {
    mockUserCount.mockResolvedValue(1);
    mockIsAuthenticated.mockReturnValue(true);
    // Rebuild app with authenticated user
    app = express();
    app.use(express.json());
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => true;
      req.user = { id: 1, role: 'user' };
      next();
    });
    const { connectionsRouter } = await import('../../src/routes/connections.js');
    app.use('/api/connections', connectionsRouter);

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'spotify', clientId: 'abcdefghijklmnop', clientSecret: 'abcdefghijklmnop' });

    // Regular users can test connections — should not get 401/403
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it('should allow unauthenticated requests during setup (no users)', async () => {
    mockUserCount.mockResolvedValue(0); // No users = setup in progress

    const res = await request(app)
      .post('/api/connections/test')
      .send({ type: 'spotify', clientId: 'abcdefghijklmnop', clientSecret: 'abcdefghijklmnop' });

    // Should reach the handler (may succeed or fail based on mocks, but not 401/403)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
