/**
 * Connection Resolver Service
 * 
 * Centralized helpers for resolving connections with user-owned → global fallback pattern.
 * This eliminates duplicate connection resolution logic scattered across route files.
 * 
 * Usage:
 *   const lidarr = await ConnectionResolver.getLidarrService(userId);
 *   const lastfm = await ConnectionResolver.getLastfmService(userId);
 *   const { service, config } = await ConnectionResolver.getLidarrServiceWithConfig(userId);
 */

import prisma from './db.js';
import { readBeforeDeadline } from './acquisition-deadline.js';
import { LidarrService } from '../services/lidarr.js';
import { LastfmService } from '../services/lastfm.js';
import { LidarrConnectionConfig, normalizeLidarrConfig } from '../types/connections.js';
import type { Connection } from '@prisma/client';

/**
 * Connection type strings supported by the resolver
 */
export type ConnectionType = 
  | 'lidarr' 
  | 'lastfm' 
  | 'spotify' 
  | 'deezer' 
  | 'tidal' 
  | 'tautulli' 
  | 'jellyfin' 
  | 'listenbrainz'
  | 'slskd'
  | 'discogs';

/**
 * Centralized connection resolution with consistent user-owned → global fallback
 */
export class ConnectionResolver {
  /**
   * Get a connection by type, preferring user-owned over global.
   * 
   * The ordering ensures user-specific connections are returned first:
   * - User's connection (userId = X) takes priority
   * - Global connection (userId = null) is fallback
   * 
   * @param type - Connection type to find
   * @param userId - User ID to check for user-owned connections
   * @returns Connection or null if none found
   */
  static async getConnection(type: ConnectionType, userId: number): Promise<Connection | null> {
    return prisma.connection.findFirst({
      where: {
        OR: [
          { userId, type, isActive: true },
          { userId: null, type, isActive: true },
        ],
      },
      orderBy: { userId: 'desc' }, // User-owned first (non-null > null)
    });
  }

  /**
   * Get a Lidarr service instance for a user.
   * 
   * @param userId - User ID
   * @returns LidarrService instance or null if no connection
   */
  static async getLidarrService(userId: number, signal?: AbortSignal): Promise<LidarrService | null> {
    signal?.throwIfAborted();
    const query = this.getConnection('lidarr', userId);
    const connection = signal ? await readBeforeDeadline(query, signal) : await query;
    signal?.throwIfAborted();
    if (!connection) return null;

    const config = connection.config as { url: string; apiKey: string };
    return new LidarrService(config);
  }

  /**
   * Get a Lidarr service with full normalized config (for add operations).
   * 
   * This variant returns both the service and the normalized config,
   * which is needed for operations that require profile IDs and other settings.
   * 
   * @param userId - User ID
   * @returns Object with service and config, or null if no connection
   */
  static async getLidarrServiceWithConfig(userId: number, signal?: AbortSignal): Promise<{ service: LidarrService; config: LidarrConnectionConfig } | null> {
    signal?.throwIfAborted();
    const query = this.getConnection('lidarr', userId);
    const connection = signal ? await readBeforeDeadline(query, signal) : await query;
    signal?.throwIfAborted();
    if (!connection) return null;

    const rawConfig = connection.config as unknown as LidarrConnectionConfig;
    // Normalize config to ensure profile IDs are numbers (handles string values from DB)
    const config = normalizeLidarrConfig(rawConfig);
    return { service: new LidarrService(config), config };
  }

  /**
   * Get a Last.fm service instance for a user.
   * 
   * @param userId - User ID
   * @returns LastfmService instance or null if no connection
   */
  static async getLastfmService(userId: number): Promise<LastfmService | null> {
    const connection = await this.getConnection('lastfm', userId);
    if (!connection) return null;

    const config = connection.config as { apiKey: string };
    return new LastfmService(config);
  }

  /**
   * Check if a user has an active connection of a given type.
   * 
   * @param type - Connection type
   * @param userId - User ID
   * @returns true if connection exists and is active
   */
  static async hasConnection(type: ConnectionType, userId: number): Promise<boolean> {
    const connection = await this.getConnection(type, userId);
    return connection !== null;
  }
}

// Export individual functions for convenience (backward compatibility)
export const getConnection = ConnectionResolver.getConnection.bind(ConnectionResolver);
export const getLidarrService = ConnectionResolver.getLidarrService.bind(ConnectionResolver);
export const getLidarrServiceWithConfig = ConnectionResolver.getLidarrServiceWithConfig.bind(ConnectionResolver);
export const getLastfmService = ConnectionResolver.getLastfmService.bind(ConnectionResolver);
export const hasConnection = ConnectionResolver.hasConnection.bind(ConnectionResolver);
