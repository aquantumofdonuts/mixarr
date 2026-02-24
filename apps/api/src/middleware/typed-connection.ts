import type { Request, Response, NextFunction } from 'express';
import type { Connection } from '@prisma/client';
import prisma from '../lib/db.js';
import { parseIntParam } from '../utils/params.js';

// Extend Express Request to carry typed connection data
declare global {
  namespace Express {
    interface Request {
      typedConnection?: Connection;
      typedConnectionConfig?: Record<string, any>;
    }
  }
}

/**
 * Check if user can access a connection (read-only).
 * Owners, admins, and any user for global Lidarr connections.
 */
export function canAccessConnection(req: Request, connection: Connection): boolean {
  const isAdmin = req.user!.role === 'admin';
  const isOwner = connection.userId === req.user!.id;
  const isGlobalLidarr = connection.userId === null && connection.type === 'lidarr';
  return isAdmin || isOwner || isGlobalLidarr;
}

/**
 * Check if user can modify a connection (write access).
 * Owners can modify their own, only admins can modify global connections.
 */
export function canModifyConnection(req: Request, connection: Connection): boolean {
  const isAdmin = req.user!.role === 'admin';
  const isOwner = connection.userId === req.user!.id;
  // Only admins can modify global connections
  if (connection.userId === null) return isAdmin;
  return isAdmin || isOwner;
}

interface WithTypedConnectionOptions {
  /** If true, use canModifyConnection instead of canAccessConnection */
  requireModify?: boolean;
}

/**
 * Middleware factory that fetches a connection by :id param, validates access
 * and type, then attaches `req.typedConnection` and `req.typedConnectionConfig`.
 *
 * Eliminates repeated fetch → access-check → type-check → config-extract boilerplate
 * across connection sub-routes.
 *
 * @param expectedType - The connection type to enforce (e.g. 'lidarr', 'spotify')
 * @param options - Optional config; set `requireModify: true` for write-access routes
 */
export function withTypedConnection(
  expectedType: string,
  options: WithTypedConnectionOptions = {},
) {
  const { requireModify = false } = options;

  return async function typedConnectionMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // 1. Parse and validate connection ID
    const id = parseIntParam(req.params.id);
    if (id === null) {
      res.status(400).json({ error: 'Invalid connection ID' });
      return;
    }

    // 2. Fetch connection from database
    const connection = await prisma.connection.findUnique({
      where: { id },
    });

    if (!connection) {
      res.status(404).json({ error: 'Connection not found' });
      return;
    }

    // 3. Check access (read or modify)
    const hasAccess = requireModify
      ? canModifyConnection(req, connection)
      : canAccessConnection(req, connection);

    if (!hasAccess) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    // 4. Validate connection type
    if (connection.type !== expectedType) {
      res.status(400).json({ error: `Connection is not a ${expectedType} connection` });
      return;
    }

    // 5. Attach connection and parsed config to request
    req.typedConnection = connection;
    req.typedConnectionConfig = (connection.config as Record<string, any>) ?? {};

    next();
  };
}
