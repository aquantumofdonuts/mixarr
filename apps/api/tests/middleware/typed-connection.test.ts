/**
 * withTypedConnection Middleware Tests
 *
 * Validates the reusable middleware that extracts the repeated
 * "fetch connection → check access → validate type → extract config"
 * boilerplate from connection sub-routes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Connection } from '@prisma/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../src/utils/params.js', () => ({
  parseIntParam: vi.fn(),
}));

// Must import AFTER vi.mock so the mocks are in place
import prisma from '../../src/lib/db.js';
import { parseIntParam } from '../../src/utils/params.js';
import {
  withTypedConnection,
  canAccessConnection,
  canModifyConnection,
} from '../../src/middleware/typed-connection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedParseIntParam = vi.mocked(parseIntParam);
const mockedFindUnique = vi.mocked(prisma.connection.findUnique);

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 1,
    name: 'Test Connection',
    type: 'spotify',
    config: { clientId: 'abc', clientSecret: 'xyz' },
    userId: 10,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Connection;
}

function makeMocks(userOverrides: Record<string, any> = {}) {
  const req: Partial<Request> = {
    params: { id: '1' },
    user: { id: 10, role: 'user', username: 'testuser', ...userOverrides } as any,
  };
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next: NextFunction = vi.fn();
  return { req: req as Request, res: res as Response, next };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('withTypedConnection middleware', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ---- 1. Happy path ----
  it('should attach connection and config then call next() for a valid matching connection', async () => {
    const connection = makeConnection({ type: 'spotify' });
    mockedParseIntParam.mockReturnValue(1);
    mockedFindUnique.mockResolvedValue(connection);

    const { req, res, next } = makeMocks();
    const middleware = withTypedConnection('spotify');
    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.typedConnection).toBe(connection);
    expect(req.typedConnectionConfig).toEqual({ clientId: 'abc', clientSecret: 'xyz' });
    expect(res.status).not.toHaveBeenCalled();
  });

  // ---- 2. Invalid ID ----
  it('should return 400 for an invalid connection ID', async () => {
    mockedParseIntParam.mockReturnValue(null);

    const { req, res, next } = makeMocks();
    const middleware = withTypedConnection('spotify');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid connection ID' });
    expect(next).not.toHaveBeenCalled();
  });

  // ---- 3. Not found ----
  it('should return 404 when connection does not exist', async () => {
    mockedParseIntParam.mockReturnValue(999);
    mockedFindUnique.mockResolvedValue(null);

    const { req, res, next } = makeMocks();
    const middleware = withTypedConnection('spotify');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Connection not found' });
    expect(next).not.toHaveBeenCalled();
  });

  // ---- 4. Wrong type ----
  it('should return 400 when connection type does not match expectedType', async () => {
    const connection = makeConnection({ type: 'lidarr' });
    mockedParseIntParam.mockReturnValue(1);
    mockedFindUnique.mockResolvedValue(connection);

    const { req, res, next } = makeMocks();
    const middleware = withTypedConnection('spotify');
    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Connection is not a spotify connection' });
    expect(next).not.toHaveBeenCalled();
  });

  // ---- 5–8. Read access (canAccessConnection logic) ----

  describe('read access (default)', () => {
    it('should allow owner to access their own connection', async () => {
      const connection = makeConnection({ userId: 10, type: 'spotify' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10 });
      const middleware = withTypedConnection('spotify');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow admin to access any connection', async () => {
      const connection = makeConnection({ userId: 99, type: 'tautulli' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10, role: 'admin' });
      const middleware = withTypedConnection('tautulli');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow any user to access global Lidarr connection', async () => {
      const connection = makeConnection({ userId: null, type: 'lidarr' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10 });
      const middleware = withTypedConnection('lidarr');
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should deny non-owner non-admin access to another user\'s connection', async () => {
      const connection = makeConnection({ userId: 99, type: 'spotify' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10, role: 'user' });
      const middleware = withTypedConnection('spotify');
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ---- 9–11. Write / modify access ----

  describe('modify access (requireModify: true)', () => {
    it('should allow owner to modify their own connection', async () => {
      const connection = makeConnection({ userId: 10, type: 'spotify' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10 });
      const middleware = withTypedConnection('spotify', { requireModify: true });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should allow admin to modify any connection', async () => {
      const connection = makeConnection({ userId: 99, type: 'deezer' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10, role: 'admin' });
      const middleware = withTypedConnection('deezer', { requireModify: true });
      await middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should deny non-admin modify access to a global connection', async () => {
      const connection = makeConnection({ userId: null, type: 'lidarr' });
      mockedParseIntParam.mockReturnValue(1);
      mockedFindUnique.mockResolvedValue(connection);

      const { req, res, next } = makeMocks({ id: 10, role: 'user' });
      const middleware = withTypedConnection('lidarr', { requireModify: true });
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied' });
      expect(next).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// Standalone helper tests
// ---------------------------------------------------------------------------

describe('canAccessConnection', () => {
  it('should return true for admin', () => {
    const req = { user: { id: 1, role: 'admin' } } as unknown as Request;
    const conn = makeConnection({ userId: 99 });
    expect(canAccessConnection(req, conn)).toBe(true);
  });

  it('should return true for owner', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: 10 });
    expect(canAccessConnection(req, conn)).toBe(true);
  });

  it('should return true for global lidarr', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: null, type: 'lidarr' });
    expect(canAccessConnection(req, conn)).toBe(true);
  });

  it('should return false for non-owner non-admin non-global-lidarr', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: 99, type: 'spotify' });
    expect(canAccessConnection(req, conn)).toBe(false);
  });
});

describe('canModifyConnection', () => {
  it('should return true for admin on global connection', () => {
    const req = { user: { id: 1, role: 'admin' } } as unknown as Request;
    const conn = makeConnection({ userId: null });
    expect(canModifyConnection(req, conn)).toBe(true);
  });

  it('should return false for non-admin on global connection', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: null });
    expect(canModifyConnection(req, conn)).toBe(false);
  });

  it('should return true for owner', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: 10 });
    expect(canModifyConnection(req, conn)).toBe(true);
  });

  it('should return true for admin on any connection', () => {
    const req = { user: { id: 1, role: 'admin' } } as unknown as Request;
    const conn = makeConnection({ userId: 99 });
    expect(canModifyConnection(req, conn)).toBe(true);
  });

  it('should return false for non-owner non-admin', () => {
    const req = { user: { id: 10, role: 'user' } } as unknown as Request;
    const conn = makeConnection({ userId: 99 });
    expect(canModifyConnection(req, conn)).toBe(false);
  });
});
