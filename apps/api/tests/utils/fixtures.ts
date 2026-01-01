/**
 * Test Utilities and Fixtures
 * 
 * Provides:
 * - Mock data factories
 * - Test helpers
 * - API client wrapper
 */

import { vi } from 'vitest';
import type { User, Connection, Subscription, ReviewItem } from '@prisma/client';

// MOCK DATA FACTORIES

let idCounter = 1;

export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: idCounter++,
    username: `testuser${idCounter}`,
    passwordHash: '$2a$12$hashedpassword',
    displayName: `Test User ${idCounter}`,
    role: 'user',
    isActive: true,
    lastLogin: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createMockAdminUser(overrides: Partial<User> = {}): User {
  return createMockUser({ role: 'admin', username: 'admin', displayName: 'Admin', ...overrides });
}

export function createMockConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: idCounter++,
    userId: 1,
    type: 'lidarr',
    name: 'Lidarr',
    config: { url: 'http://localhost:8686', apiKey: 'test-api-key' },
    isActive: true,
    lastTest: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Connection;
}

export function createMockLidarrConnection(userId: number | null = 1): Connection {
  return createMockConnection({
    userId,
    type: 'lidarr',
    name: 'Lidarr',
    config: { url: 'http://localhost:8686', apiKey: 'lidarr-api-key' },
  });
}

export function createMockSpotifyConnection(userId: number): Connection {
  return createMockConnection({
    userId,
    type: 'spotify',
    name: 'Spotify',
    config: {
      clientId: 'spotify-client-id',
      clientSecret: 'spotify-client-secret',
      accessToken: 'test-access-token',
      refreshToken: 'test-refresh-token',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
  });
}

export function createMockLastfmConnection(userId: number | null = 1): Connection {
  return createMockConnection({
    userId,
    type: 'lastfm',
    name: 'Last.fm',
    config: { apiKey: 'lastfm-api-key' },
  });
}

export function createMockSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: idCounter++,
    userId: 1,
    connectionId: null,
    name: 'Test Subscription',
    type: 'lastfm_chart',
    config: { chartType: 'artists', period: 'week' },
    resultLimit: 50,
    resultHandling: 'preview',
    schedule: null,
    isActive: true,
    lastRun: null,
    lastRunStatus: null,
    lastRunCount: null,
    nextRun: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Subscription;
}

export function createMockReviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: idCounter++,
    userId: 1,
    itemType: 'artist',
    artistName: 'Test Artist',
    albumName: null,
    albumMbid: null,
    releaseDate: null,
    releaseType: null,
    releaseYear: null,
    spotifyId: 'spotify:artist:123',
    mbid: null,
    source: 'spotify_liked_songs',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ReviewItem;
}

// PRISMA MOCK

export function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    connection: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    subscriptionRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    subscriptionResult: {
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    importSource: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reviewItem: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    logEntry: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    globalSetting: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    userSetting: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
    ssoProvider: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    authIdentity: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
  };
}

// SERVICE MOCKS

export function createMockLidarrService() {
  return {
    testConnection: vi.fn().mockResolvedValue(true),
    getArtists: vi.fn().mockResolvedValue([]),
    getArtist: vi.fn().mockResolvedValue(null),
    getArtistByMbid: vi.fn().mockResolvedValue(null),
    searchArtist: vi.fn().mockResolvedValue([]),
    addArtist: vi.fn().mockResolvedValue({ id: 1 }),
    addArtistWithRefresh: vi.fn().mockResolvedValue({ artist: { id: 1 }, refreshCommand: { id: 1, status: 'queued' } }),
    addAlbum: vi.fn().mockResolvedValue({ artist: { id: 1 }, album: { id: 1 }, isNewArtist: true }),
    getAlbums: vi.fn().mockResolvedValue([]),
    updateAlbum: vi.fn().mockResolvedValue({ id: 1, monitored: true }),
    searchAlbumCommand: vi.fn().mockResolvedValue({ id: 1 }),
    refreshArtist: vi.fn().mockResolvedValue({ id: 1, name: 'RefreshArtist', status: 'queued' }),
    getCommand: vi.fn().mockResolvedValue({ id: 1, status: 'completed' }),
    waitForCommand: vi.fn().mockResolvedValue({ id: 1, status: 'completed' }),
    getQualityProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
    getMetadataProfiles: vi.fn().mockResolvedValue([{ id: 1, name: 'Standard' }]),
    getRootFolders: vi.fn().mockResolvedValue([{ id: 1, path: '/music' }]),
  };
}

export function createMockSpotifyService() {
  return {
    testConnection: vi.fn().mockResolvedValue(true),
    getLikedSongs: vi.fn().mockResolvedValue([]),
    getSavedAlbums: vi.fn().mockResolvedValue([]),
    getFollowedArtists: vi.fn().mockResolvedValue([]),
    getPlaylistTracks: vi.fn().mockResolvedValue([]),
    getNewReleases: vi.fn().mockResolvedValue([]),
  };
}

export function createMockLastfmService() {
  return {
    testConnection: vi.fn().mockResolvedValue(true),
    getTopArtists: vi.fn().mockResolvedValue([]),
    getTopTracks: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    getArtistInfo: vi.fn().mockResolvedValue(null),
  };
}

export function createMockLidarrCache() {
  return {
    refresh: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    getArtists: vi.fn().mockReturnValue([]),
  };
}

// REQUEST HELPERS

export function createAuthenticatedRequest(user: User) {
  return {
    user,
    isAuthenticated: () => true,
    session: {},
  };
}

export function resetIdCounter() {
  idCounter = 1;
}
