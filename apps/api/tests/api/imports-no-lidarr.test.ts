/**
 * Imports API Tests - No Lidarr Mode
 *
 * Tests that import routes work without Lidarr for preview/queue modes:
 * - preview mode works without Lidarr
 * - queue mode works without Lidarr
 * - auto mode returns 400 with 'LIDARR_REQUIRED' when no Lidarr
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma with hoisted factory
vi.mock('../../src/lib/db.js', () => ({
  default: {
    importSource: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reviewItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    connection: {
      findFirst: vi.fn(),
    },
    logEntry: {
      create: vi.fn(),
    },
  },
}));

// Mock logger to avoid console noise
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock Lidarr service as a class
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class MockLidarrService {
    async getArtists() {
      return [
        { artistName: 'Pink Floyd' },
        { artistName: 'The Beatles' },
      ];
    }
    async searchArtist() {
      return [{ foreignArtistId: 'mbid-123' }];
    }
    async addArtistWithRefresh() {
      return { id: 1, artistName: 'Test Artist' };
    }
  },
  LidarrCache: class MockLidarrCache {
    async refresh() {}
    async exists() { return false; }
  },
}));

// Mock Deezer image fetching
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

// Mock auth middleware
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'testuser', role: 'user' };
    next();
  }),
}));

// Mock scheduler
vi.mock('../../src/jobs/scheduler.js', () => ({
  addImportScheduledJob: vi.fn(),
  removeImportScheduledJob: vi.fn(),
}));

// Mock MusicBrainz
vi.mock('../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: vi.fn().mockImplementation(() => ({
    getMbidFromSpotifyArtist: vi.fn().mockResolvedValue('mbid-123'),
  })),
}));

// Mock Spotify service
vi.mock('../../src/services/spotify.js', () => ({
  SpotifyService: vi.fn(),
}));

// Mock Last.fm service
vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: vi.fn(),
}));

// Mock AI service
vi.mock('../../src/services/ai.js', () => ({
  AIService: vi.fn(),
}));

// Mock notifications
vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    send: vi.fn(),
  },
}));

// Mock logs utility
vi.mock('../../src/routes/logs.js', () => ({
  addLogEntry: vi.fn(),
}));

// Mock public-playlist service
vi.mock('../../src/services/public-playlist.js', () => ({
  parseSpotifyPlaylistUrl: vi.fn().mockReturnValue('playlist123'),
  importPublicPlaylist: vi.fn().mockResolvedValue({
    playlistName: 'Test Playlist',
    totalTracks: 10,
    artistNames: ['Artist A', 'Artist B'],
  }),
}));

// Import after mocks
import { importsRouter } from '../../src/routes/imports.js';
import prisma from '../../src/lib/db.js';

describe('Imports API - No Lidarr Mode', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    
    app = express();
    app.use(express.json());
    app.use('/api/imports', importsRouter);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/imports/preview/import', () => {
    it('should return LIDARR_REQUIRED error for auto mode without Lidarr', async () => {
      // Setup: no Lidarr connection
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/imports/preview/import')
        .send({ 
          artistNames: ['Artist A', 'Artist B'],
          mode: 'auto'
        })
        .expect(400);

      expect(response.body.error).toBe('Auto mode requires a Lidarr connection');
      expect(response.body.code).toBe('LIDARR_REQUIRED');
    });

    it('should work with preview mode without Lidarr', async () => {
      // Setup: no Lidarr connection
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/imports/preview/import')
        .send({ 
          artistNames: ['Artist A', 'Artist B'],
          mode: 'preview'
        });

      // Preview mode should NOT return 400 Lidarr error
      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('Auto mode requires a Lidarr connection');
      expect(response.body.code).not.toBe('LIDARR_REQUIRED');
    });

    it('should work with queue mode without Lidarr', async () => {
      // Setup: no Lidarr connection, but allow review queue operations
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.reviewItem.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reviewItem.create).mockResolvedValue({
        id: 1,
        userId: 1,
        artistName: 'Artist A',
        source: 'manual',
        status: 'pending',
        mbid: null,
        itemType: 'artist',
        albumName: null,
        albumMbid: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app)
        .post('/api/imports/preview/import')
        .send({ 
          artistNames: ['Artist A', 'Artist B'],
          mode: 'queue'
        });

      // Queue mode should NOT return 400 Lidarr error
      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('Auto mode requires a Lidarr connection');
      expect(response.body.code).not.toBe('LIDARR_REQUIRED');
    });

    it('should use auto mode as default (backward compatibility)', async () => {
      // Setup: Lidarr connection exists
      vi.mocked(prisma.connection.findFirst).mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'lidarr',
        name: 'Lidarr',
        isActive: true,
        config: { url: 'http://localhost:8686', apiKey: 'test-key' },
        lastTest: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app)
        .post('/api/imports/preview/import')
        .send({ 
          artistNames: ['Artist A']
          // No mode specified - should default to auto
        });

      // Should work with Lidarr connection
      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/imports/public-playlist/preview', () => {
    it('should work without Lidarr connection', async () => {
      // Setup: no Lidarr connection
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);

      const response = await request(app)
        .post('/api/imports/public-playlist/preview')
        .send({ 
          url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
        });

      // Should NOT return 400 Lidarr error
      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('No active Lidarr connection');
    });
  });

  describe('POST /api/imports/public-playlist/import', () => {
    it('should work without Lidarr - adds to review queue', async () => {
      // Setup: no Lidarr connection
      vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.reviewItem.findMany).mockResolvedValue([]);
      vi.mocked(prisma.reviewItem.create).mockResolvedValue({
        id: 1,
        userId: 1,
        artistName: 'Artist A',
        source: 'playlist:Test Playlist',
        status: 'pending',
        mbid: null,
        itemType: 'artist',
        albumName: null,
        albumMbid: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const response = await request(app)
        .post('/api/imports/public-playlist/import')
        .send({ 
          url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'
        });

      // Should NOT return 400 Lidarr error
      expect(response.status).not.toBe(400);
      expect(response.body.error).not.toBe('No active Lidarr connection');
      // Should successfully add to queue
      expect(response.body.success).toBe(true);
    });
  });
});
