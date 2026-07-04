/**
 * Search API Tests - No Lidarr Mode
 *
 * Tests that search endpoints work without Lidarr:
 * - Search returns results (from MusicBrainz, Last.fm, etc.)
 * - Results don't have inLibrary field when no Lidarr
 * - /search/add still requires Lidarr (it's adding to Lidarr)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock prisma before any imports - NO Lidarr connection
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: {
      findFirst: vi.fn().mockResolvedValue(null), // No connections
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

// Mock auth middleware to inject user into requests
vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'testuser', role: 'user' };
    next();
  }),
}));

// Mock MusicBrainz service - returns results
const mockMusicBrainzArtists = [
  { id: 'mbid-1', name: 'Pink Floyd', country: 'GB', type: 'Group', disambiguation: 'English rock band' },
  { id: 'mbid-2', name: 'Pink', country: 'US', type: 'Person', disambiguation: 'American singer' },
];

vi.mock('../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: class MusicBrainzService {
    async searchArtist() {
      return mockMusicBrainzArtists;
    }
    async searchByAlbum() {
      return { releases: [], count: 0, offset: 0 };
    }
    async searchByLabel() {
      return { labels: [], count: 0, offset: 0 };
    }
    async searchByYear() {
      return { releases: [], count: 0, offset: 0 };
    }
    async getArtistReleases() {
      return { releases: [], count: 0, offset: 0 };
    }
    async getArtist() {
      return { id: 'mbid-1', name: 'Pink Floyd' };
    }
    async getRelease() {
      return { id: 'release-1', title: 'Dark Side of the Moon' };
    }
  },
}));

// Mock Lidarr service - should never be instantiated without connection
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: vi.fn(),
  LidarrCache: vi.fn(),
  getSharedLidarrCache: vi.fn(() => ({
    exists: vi.fn().mockResolvedValue(false),
    get: vi.fn().mockResolvedValue(null),
    refresh: vi.fn().mockResolvedValue(undefined),
  })),
  invalidateLidarrCache: vi.fn(),
}));

// Mock artist image service - prevents real Redis/Deezer calls in tests
vi.mock('../../src/services/artist-images.js', () => ({
  getArtistImages: vi.fn().mockResolvedValue(new Map()),
  normalizeArtistName: vi.fn((name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')),
}));

// Mock Last.fm service - may be used for some endpoints
vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: vi.fn().mockImplementation(() => ({
    getTopArtists: vi.fn().mockResolvedValue([]),
    getTopAlbums: vi.fn().mockResolvedValue([]),
    getTopTracks: vi.fn().mockResolvedValue([]),
    getSimilarArtists: vi.fn().mockResolvedValue([]),
    getArtistStats: vi.fn().mockResolvedValue({ listeners: 1000, playcount: 50000, tags: ['rock'] }),
  })),
}));

// Mock Deezer image fetching
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

// Mock multi-search service (used by /discover)
vi.mock('../../src/services/multi-search.js', () => ({
  multiSourceSearch: vi.fn().mockResolvedValue([
    { name: 'Test Artist', source: 'spotify' },
  ]),
  resolveMbid: vi.fn().mockResolvedValue({ mbid: 'mbid-1' }),
}));

// Mock metadata enrichment service
vi.mock('../../src/services/metadata-enrichment.js', () => ({
  MetadataEnrichmentService: vi.fn(),
}));

// Mock notification service
vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock AI service
vi.mock('../../src/services/ai.js', () => ({
  aiService: {
    isAvailable: vi.fn().mockResolvedValue(false),
    searchByPrompt: vi.fn().mockResolvedValue({ artists: [], providers: [], errors: [] }),
  },
}));

// Mock logs
vi.mock('../../src/routes/logs.js', () => ({
  addLogEntry: vi.fn().mockResolvedValue(undefined),
}));

// Import after mocks are set up
import { searchRouter } from '../../src/routes/search.js';

const app = express();
app.use(express.json());
app.use('/api/search', searchRouter);

describe('Search API - No Lidarr Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/search/artists (main search)', () => {
    it('should return results without Lidarr connection', async () => {
      const response = await request(app)
        .get('/api/search/artists')
        .query({ q: 'pink' });

      // Should NOT return 400 error about missing Lidarr
      expect(response.status).not.toBe(400);
      // Should return 200 with results
      expect(response.status).toBe(200);
    });

    it('should not have inLibrary field when no Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/artists')
        .query({ q: 'pink' });

      expect(response.status).toBe(200);
      if (response.body.results && response.body.results.length > 0) {
        // inLibrary should be absent, not false
        expect(response.body.results[0]).not.toHaveProperty('inLibrary');
      }
    });
  });

  describe('GET /api/search/musicbrainz/artist', () => {
    it('should search MusicBrainz without Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/musicbrainz/artist')
        .query({ q: 'pink' });

      // MusicBrainz search should work without Lidarr
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('results');
    });
  });

  describe('GET /api/search/album', () => {
    it('should search albums without Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/album')
        .query({ q: 'dark side' });

      // Album search should work without Lidarr
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/search/label', () => {
    it('should search labels without Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/label')
        .query({ q: 'EMI' });

      // Label search should work without Lidarr
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/search/year', () => {
    it('should search by year without Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/year')
        .query({ year: '2024' });

      // Year search should work without Lidarr
      expect(response.status).toBe(200);
    });
  });

  describe('GET /api/search/discover', () => {
    it('should discover artists without Lidarr', async () => {
      const response = await request(app)
        .get('/api/search/discover')
        .query({ q: 'electronic' });

      // Multi-source discover should work without Lidarr
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('results');
    });
  });

  describe('POST /api/search/artists/add', () => {
    it('should require Lidarr connection for adding artists', async () => {
      const response = await request(app)
        .post('/api/search/artists/add')
        .send({ foreignArtistId: 'mbid-1' });

      // Adding artists MUST require Lidarr
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Lidarr');
    });
  });

  describe('POST /api/search/discover/add', () => {
    it('should require Lidarr connection for adding from discover', async () => {
      const response = await request(app)
        .post('/api/search/discover/add')
        .send({ artistName: 'Test Artist' });

      // Adding from discover MUST require Lidarr
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Lidarr');
    });
  });

  describe('POST /api/search/batch', () => {
    it('should require Lidarr connection for batch add', async () => {
      const response = await request(app)
        .post('/api/search/batch')
        .send({ artistIds: ['mbid-1', 'mbid-2'] });

      // Batch add MUST require Lidarr
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Lidarr');
    });
  });

  describe('GET /api/search/lidarr/config', () => {
    it('should require Lidarr connection for config', async () => {
      const response = await request(app)
        .get('/api/search/lidarr/config');

      // Getting Lidarr config MUST require Lidarr
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Lidarr');
    });
  });

  describe('GET /api/search/lidarr/artists', () => {
    it('should require Lidarr connection for listing library', async () => {
      const response = await request(app)
        .get('/api/search/lidarr/artists');

      // Listing library MUST require Lidarr
      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Lidarr');
    });
  });
});
