/**
 * Connection Configuration Types
 * 
 * Type definitions and type guards for connection config JSON fields stored in Prisma.
 * These replace the use of `as any` casts throughout the API.
 */

import type { JsonValue } from '@prisma/client/runtime/library';

// Re-export JsonValue for convenience
export type { JsonValue };

// =============================================================================
// Spotify Connection Config
// =============================================================================

export interface SpotifyConnectionConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string | number;
  tokenExpiresAt?: number;
  [key: string]: JsonValue | undefined;
}

export function isSpotifyConfig(config: unknown): config is SpotifyConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.clientId === 'string' && typeof c.clientSecret === 'string';
}

// =============================================================================
// Last.fm Connection Config
// =============================================================================

export interface LastFMConnectionConfig {
  apiKey: string;
  username?: string;
  [key: string]: JsonValue | undefined;
}

export function isLastFMConfig(config: unknown): config is LastFMConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.apiKey === 'string';
}

// =============================================================================
// Deezer Connection Config
// =============================================================================

export interface DeezerConnectionConfig {
  appId: string;
  appSecret: string;
  accessToken?: string;
  expiresAt?: number;
  [key: string]: JsonValue | undefined;
}

export function isDeezerConfig(config: unknown): config is DeezerConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.appId === 'string' && typeof c.appSecret === 'string';
}

// =============================================================================
// TIDAL Connection Config
// =============================================================================

export interface TidalConnectionConfig {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  [key: string]: JsonValue | undefined;
}

export function isTidalConfig(config: unknown): config is TidalConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.clientId === 'string' && typeof c.clientSecret === 'string';
}

// =============================================================================
// ListenBrainz Connection Config
// =============================================================================

export interface ListenBrainzConnectionConfig {
  username: string;
  token?: string;
  url?: string;
  [key: string]: JsonValue | undefined;
}

export function isListenBrainzConfig(config: unknown): config is ListenBrainzConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.username === 'string';
}

// =============================================================================
// Lidarr Connection Config
// =============================================================================

/** Valid Lidarr monitor options for album monitoring (one-time on add) */
export type LidarrMonitorOption = 'all' | 'future' | 'missing' | 'existing' | 'first' | 'latest' | 'none';

/** Valid Lidarr options for monitoring NEW albums (ongoing) */
export type LidarrMonitorNewItems = 'all' | 'none' | 'new';

export interface LidarrConnectionConfig {
  url: string;
  apiKey: string;
  qualityProfileId?: number;
  metadataProfileId?: number;
  rootFolderPath?: string;
  monitorOption?: LidarrMonitorOption;
  monitorNewItems?: LidarrMonitorNewItems;
  searchOnAdd?: boolean;
  [key: string]: JsonValue | undefined;
}

export function isLidarrConfig(config: unknown): config is LidarrConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.url === 'string' && typeof c.apiKey === 'string';
}

/**
 * Normalizes a Lidarr connection config by converting string profile IDs to numbers.
 * This handles the case where the frontend saves profile IDs as strings
 * (from select dropdown values) but the Lidarr API expects numbers.
 */
export function normalizeLidarrConfig(config: LidarrConnectionConfig): LidarrConnectionConfig {
  const normalized = { ...config };

  // Convert qualityProfileId to number if it's a string
  if (normalized.qualityProfileId !== undefined) {
    const parsed = typeof normalized.qualityProfileId === 'string'
      ? parseInt(normalized.qualityProfileId, 10)
      : normalized.qualityProfileId;
    normalized.qualityProfileId = isNaN(parsed) || parsed === 0 ? undefined : parsed;
  }

  // Convert metadataProfileId to number if it's a string
  if (normalized.metadataProfileId !== undefined) {
    const parsed = typeof normalized.metadataProfileId === 'string'
      ? parseInt(normalized.metadataProfileId, 10)
      : normalized.metadataProfileId;
    normalized.metadataProfileId = isNaN(parsed) || parsed === 0 ? undefined : parsed;
  }

  // Normalize empty rootFolderPath to undefined (prevents fallback to folders[0])
  if (normalized.rootFolderPath !== undefined && normalized.rootFolderPath.trim() === '') {
    normalized.rootFolderPath = undefined;
  }

  // Validate monitorNewItems is a valid option (defaults to 'all' if invalid)
  const validMonitorNewItems = ['all', 'none', 'new'];
  if (normalized.monitorNewItems !== undefined) {
    if (!validMonitorNewItems.includes(normalized.monitorNewItems as string)) {
      normalized.monitorNewItems = 'all';
    }
  }

  return normalized;
}

// =============================================================================
// Tautulli Connection Config
// =============================================================================

export interface TautulliConnectionConfig {
  tautulliUrl: string;
  tautulliApiKey: string;
  plexLibraryId?: number;
  plexUserId?: number;
  [key: string]: JsonValue | undefined;
}

export function isTautulliConfig(config: unknown): config is TautulliConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.tautulliUrl === 'string' && typeof c.tautulliApiKey === 'string';
}

// =============================================================================
// Jellyfin Connection Config
// =============================================================================

export interface JellyfinConnectionConfig {
  jellyfinUrl: string;
  jellyfinApiKey: string;
  jellyfinUserId?: string;
  jellyfinLibraryId?: string;
  [key: string]: JsonValue | undefined;
}

export function isJellyfinConfig(config: unknown): config is JellyfinConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.jellyfinUrl === 'string' && typeof c.jellyfinApiKey === 'string';
}

// =============================================================================
// Discogs Connection Config
// =============================================================================

export interface DiscogsConnectionConfig {
  consumerKey?: string;
  consumerSecret?: string;
  accessToken?: string;
  accessSecret?: string;
  token?: string; // Personal access token (alternative to OAuth)
  [key: string]: JsonValue | undefined;
}

export function isDiscogsConfig(config: unknown): config is DiscogsConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  // Either OAuth credentials or personal token
  return (
    (typeof c.consumerKey === 'string' && typeof c.consumerSecret === 'string') ||
    typeof c.token === 'string'
  );
}

// =============================================================================
// slskd Connection Config
// =============================================================================

export interface SlskdConnectionConfig {
  url: string;
  apiKey: string;
  downloadDir?: string;
  musicLibraryDir?: string;
  [key: string]: JsonValue | undefined;
}

export function isSlskdConfig(config: unknown): config is SlskdConnectionConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return false;
  }
  const c = config as Record<string, unknown>;
  return typeof c.url === 'string' && typeof c.apiKey === 'string';
}

// =============================================================================
// Union Type
// =============================================================================

export type ConnectionConfig =
  | SpotifyConnectionConfig
  | LastFMConnectionConfig
  | DeezerConnectionConfig
  | TidalConnectionConfig
  | ListenBrainzConnectionConfig
  | LidarrConnectionConfig
  | TautulliConnectionConfig
  | JellyfinConnectionConfig
  | DiscogsConnectionConfig
  | SlskdConnectionConfig;

// =============================================================================
// Helper Function
// =============================================================================

/**
 * Get a typed config from a JsonValue, throwing if validation fails.
 * 
 * @param config - The JSON config value from Prisma
 * @param validator - Type guard function to validate the config
 * @param connectionType - Name of the connection type for error messages
 * @returns The typed config
 * @throws Error if the config doesn't match the expected type
 * 
 * @example
 * const config = getTypedConfig(connection.config, isSpotifyConfig, 'Spotify');
 */
export function getTypedConfig<T>(
  config: unknown,
  validator: (c: unknown) => c is T,
  connectionType: string
): T {
  if (!validator(config)) {
    throw new Error(`Invalid ${connectionType} connection configuration`);
  }
  return config;
}
