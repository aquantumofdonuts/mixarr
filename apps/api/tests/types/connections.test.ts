/**
 * Tests for Connection Configuration Type Guards
 *
 * These tests ensure that type guards correctly validate connection config objects
 * before they're used throughout the codebase.
 */

import { describe, it, expect } from 'vitest';
import {
  isSpotifyConfig,
  isLastFMConfig,
  isDeezerConfig,
  isTidalConfig,
  isListenBrainzConfig,
  isLidarrConfig,
  isTautulliConfig,
  isJellyfinConfig,
  isDiscogsConfig,
  getTypedConfig,
} from '../../src/types/connections';

// =============================================================================
// isSpotifyConfig
// =============================================================================

describe('isSpotifyConfig', () => {
  it('returns true for valid config with required fields', () => {
    const config = {
      clientId: 'spotify-client-id',
      clientSecret: 'spotify-client-secret',
    };
    expect(isSpotifyConfig(config)).toBe(true);
  });

  it('returns true for valid config with optional tokens', () => {
    const config = {
      clientId: 'spotify-client-id',
      clientSecret: 'spotify-client-secret',
      accessToken: 'access-token-123',
      refreshToken: 'refresh-token-456',
      expiresAt: '2026-01-10T00:00:00Z',
      tokenExpiresAt: 1704844800000,
    };
    expect(isSpotifyConfig(config)).toBe(true);
  });

  it('returns false when clientId is missing', () => {
    const config = {
      clientSecret: 'spotify-client-secret',
    };
    expect(isSpotifyConfig(config)).toBe(false);
  });

  it('returns false when clientSecret is missing', () => {
    const config = {
      clientId: 'spotify-client-id',
    };
    expect(isSpotifyConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSpotifyConfig(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isSpotifyConfig(undefined)).toBe(false);
  });

  it('returns false for arrays', () => {
    const config = ['clientId', 'clientSecret'];
    expect(isSpotifyConfig(config)).toBe(false);
  });

  it('returns false for primitive values', () => {
    expect(isSpotifyConfig('string')).toBe(false);
    expect(isSpotifyConfig(123)).toBe(false);
    expect(isSpotifyConfig(true)).toBe(false);
  });

  it('returns false when clientId is not a string', () => {
    const config = {
      clientId: 123,
      clientSecret: 'spotify-client-secret',
    };
    expect(isSpotifyConfig(config)).toBe(false);
  });
});

// =============================================================================
// isLastFMConfig
// =============================================================================

describe('isLastFMConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      apiKey: 'lastfm-api-key',
    };
    expect(isLastFMConfig(config)).toBe(true);
  });

  it('returns true for config with additional fields', () => {
    const config = {
      apiKey: 'lastfm-api-key',
      username: 'lastfm-user',
      sharedSecret: 'shared-secret',
    };
    expect(isLastFMConfig(config)).toBe(true);
  });

  it('returns false when apiKey is missing', () => {
    const config = {
      username: 'lastfm-user',
    };
    expect(isLastFMConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isLastFMConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isLastFMConfig(['apiKey'])).toBe(false);
  });

  it('returns false when apiKey is not a string', () => {
    const config = {
      apiKey: 12345,
    };
    expect(isLastFMConfig(config)).toBe(false);
  });
});

// =============================================================================
// isDeezerConfig
// =============================================================================

describe('isDeezerConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      appId: 'deezer-app-id',
      appSecret: 'deezer-app-secret',
    };
    expect(isDeezerConfig(config)).toBe(true);
  });

  it('returns true for config with optional tokens', () => {
    const config = {
      appId: 'deezer-app-id',
      appSecret: 'deezer-app-secret',
      accessToken: 'access-token',
      expiresAt: 1704844800000,
    };
    expect(isDeezerConfig(config)).toBe(true);
  });

  it('returns false when appId is missing', () => {
    const config = {
      appSecret: 'deezer-app-secret',
    };
    expect(isDeezerConfig(config)).toBe(false);
  });

  it('returns false when appSecret is missing', () => {
    const config = {
      appId: 'deezer-app-id',
    };
    expect(isDeezerConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDeezerConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isDeezerConfig(['appId', 'appSecret'])).toBe(false);
  });
});

// =============================================================================
// isTidalConfig
// =============================================================================

describe('isTidalConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      clientId: 'tidal-client-id',
      clientSecret: 'tidal-client-secret',
    };
    expect(isTidalConfig(config)).toBe(true);
  });

  it('returns true for config with optional tokens', () => {
    const config = {
      clientId: 'tidal-client-id',
      clientSecret: 'tidal-client-secret',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: '2026-01-10T00:00:00Z',
    };
    expect(isTidalConfig(config)).toBe(true);
  });

  it('returns false when clientSecret is missing', () => {
    const config = {
      clientId: 'tidal-client-id',
    };
    expect(isTidalConfig(config)).toBe(false);
  });

  it('returns false when clientId is missing', () => {
    const config = {
      clientSecret: 'tidal-client-secret',
    };
    expect(isTidalConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTidalConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isTidalConfig(['clientId', 'clientSecret'])).toBe(false);
  });
});

// =============================================================================
// isListenBrainzConfig
// =============================================================================

describe('isListenBrainzConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      username: 'listenbrainz-user',
    };
    expect(isListenBrainzConfig(config)).toBe(true);
  });

  it('returns true for config with optional token', () => {
    const config = {
      username: 'listenbrainz-user',
      token: 'user-token-123',
    };
    expect(isListenBrainzConfig(config)).toBe(true);
  });

  it('returns false when username is missing', () => {
    const config = {
      token: 'user-token-123',
    };
    expect(isListenBrainzConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isListenBrainzConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isListenBrainzConfig(['username'])).toBe(false);
  });

  it('returns false when username is not a string', () => {
    const config = {
      username: 12345,
    };
    expect(isListenBrainzConfig(config)).toBe(false);
  });
});

// =============================================================================
// isLidarrConfig
// =============================================================================

describe('isLidarrConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      url: 'http://localhost:8686',
      apiKey: 'lidarr-api-key',
    };
    expect(isLidarrConfig(config)).toBe(true);
  });

  it('returns true for config with additional fields', () => {
    const config = {
      url: 'http://localhost:8686',
      apiKey: 'lidarr-api-key',
      rootFolderPath: '/music',
      qualityProfileId: 1,
    };
    expect(isLidarrConfig(config)).toBe(true);
  });

  it('returns false when apiKey is missing', () => {
    const config = {
      url: 'http://localhost:8686',
    };
    expect(isLidarrConfig(config)).toBe(false);
  });

  it('returns false when url is missing', () => {
    const config = {
      apiKey: 'lidarr-api-key',
    };
    expect(isLidarrConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isLidarrConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isLidarrConfig(['url', 'apiKey'])).toBe(false);
  });
});

// =============================================================================
// isTautulliConfig
// =============================================================================

describe('isTautulliConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      tautulliUrl: 'http://localhost:8181',
      tautulliApiKey: 'tautulli-api-key',
    };
    expect(isTautulliConfig(config)).toBe(true);
  });

  it('returns true for config with optional plex IDs', () => {
    const config = {
      tautulliUrl: 'http://localhost:8181',
      tautulliApiKey: 'tautulli-api-key',
      plexLibraryId: 1,
      plexUserId: 123,
    };
    expect(isTautulliConfig(config)).toBe(true);
  });

  it('returns false when tautulliApiKey is missing', () => {
    const config = {
      tautulliUrl: 'http://localhost:8181',
    };
    expect(isTautulliConfig(config)).toBe(false);
  });

  it('returns false when tautulliUrl is missing', () => {
    const config = {
      tautulliApiKey: 'tautulli-api-key',
    };
    expect(isTautulliConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTautulliConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isTautulliConfig(['tautulliUrl', 'tautulliApiKey'])).toBe(false);
  });
});

// =============================================================================
// isJellyfinConfig
// =============================================================================

describe('isJellyfinConfig', () => {
  it('returns true for valid config', () => {
    const config = {
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'jellyfin-api-key',
    };
    expect(isJellyfinConfig(config)).toBe(true);
  });

  it('returns true for config with optional user and library IDs', () => {
    const config = {
      jellyfinUrl: 'http://localhost:8096',
      jellyfinApiKey: 'jellyfin-api-key',
      jellyfinUserId: 'user-id-123',
      jellyfinLibraryId: 'library-id-456',
    };
    expect(isJellyfinConfig(config)).toBe(true);
  });

  it('returns false when jellyfinUrl is missing', () => {
    const config = {
      jellyfinApiKey: 'jellyfin-api-key',
    };
    expect(isJellyfinConfig(config)).toBe(false);
  });

  it('returns false when jellyfinApiKey is missing', () => {
    const config = {
      jellyfinUrl: 'http://localhost:8096',
    };
    expect(isJellyfinConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isJellyfinConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isJellyfinConfig(['jellyfinUrl', 'jellyfinApiKey'])).toBe(false);
  });
});

// =============================================================================
// isDiscogsConfig
// =============================================================================

describe('isDiscogsConfig', () => {
  it('returns true for valid OAuth config', () => {
    const config = {
      consumerKey: 'discogs-consumer-key',
      consumerSecret: 'discogs-consumer-secret',
    };
    expect(isDiscogsConfig(config)).toBe(true);
  });

  it('returns true for valid OAuth config with tokens', () => {
    const config = {
      consumerKey: 'discogs-consumer-key',
      consumerSecret: 'discogs-consumer-secret',
      accessToken: 'oauth-access-token',
      accessSecret: 'oauth-access-secret',
    };
    expect(isDiscogsConfig(config)).toBe(true);
  });

  it('returns true for config with personal access token', () => {
    const config = {
      token: 'personal-access-token',
    };
    expect(isDiscogsConfig(config)).toBe(true);
  });

  it('returns false when consumerSecret is missing (without token)', () => {
    const config = {
      consumerKey: 'discogs-consumer-key',
    };
    expect(isDiscogsConfig(config)).toBe(false);
  });

  it('returns false for empty object', () => {
    const config = {};
    expect(isDiscogsConfig(config)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isDiscogsConfig(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isDiscogsConfig(['consumerKey', 'consumerSecret'])).toBe(false);
  });

  it('returns false when all auth fields are missing', () => {
    const config = {
      username: 'discogs-user',
    };
    expect(isDiscogsConfig(config)).toBe(false);
  });
});

// =============================================================================
// getTypedConfig
// =============================================================================

describe('getTypedConfig', () => {
  it('returns typed config when valid', () => {
    const config = {
      clientId: 'spotify-client-id',
      clientSecret: 'spotify-client-secret',
    };
    const result = getTypedConfig(config, isSpotifyConfig, 'Spotify');
    expect(result).toBe(config);
    expect(result.clientId).toBe('spotify-client-id');
    expect(result.clientSecret).toBe('spotify-client-secret');
  });

  it('throws error for invalid config', () => {
    const config = {
      invalid: 'config',
    };
    expect(() => getTypedConfig(config, isSpotifyConfig, 'Spotify')).toThrow(
      'Invalid Spotify connection configuration'
    );
  });

  it('throws error for null config', () => {
    expect(() => getTypedConfig(null, isSpotifyConfig, 'Spotify')).toThrow(
      'Invalid Spotify connection configuration'
    );
  });

  it('throws error for undefined config', () => {
    expect(() => getTypedConfig(undefined, isSpotifyConfig, 'Spotify')).toThrow(
      'Invalid Spotify connection configuration'
    );
  });

  it('works with different type guards', () => {
    const lidarrConfig = {
      url: 'http://localhost:8686',
      apiKey: 'lidarr-api-key',
    };
    const result = getTypedConfig(lidarrConfig, isLidarrConfig, 'Lidarr');
    expect(result.url).toBe('http://localhost:8686');
    expect(result.apiKey).toBe('lidarr-api-key');
  });

  it('includes connection type in error message', () => {
    const config = {};
    expect(() => getTypedConfig(config, isTautulliConfig, 'Tautulli')).toThrow(
      'Invalid Tautulli connection configuration'
    );
  });
});
