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

const { mockGetLabelArtists } = vi.hoisted(() => ({ mockGetLabelArtists: vi.fn() }));

// Mock MusicBrainz service - returns results
const mockMusicBrainzArtists = [
  { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Pink Floyd', country: 'GB', type: 'Group', disambiguation: 'English rock band' },
  { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Pink', country: 'US', type: 'Person', disambiguation: 'American singer' },
];

vi.mock('../../src/services/musicbrainz.js', () => ({
  MusicBrainzService: class MusicBrainzService {
    getLabelArtists = mockGetLabelArtists;
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
      return { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Pink Floyd' };
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
  resolveMbid: vi.fn().mockResolvedValue({ mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' }),
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
import prisma from '../../src/lib/db.js';
import { LidarrService } from '../../src/services/lidarr.js';
import { multiSourceSearch, resolveMbid } from '../../src/services/multi-search.js';
import { getArtistImages } from '../../src/services/artist-images.js';

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

  it('returns successful rows with sanitized provider diagnostics from the real discover route', async () => {
    vi.mocked(multiSourceSearch).mockImplementationOnce(async (_query, _userId, _sources, _limit, errors) => {
      errors?.push({ source: 'spotify', message: 'Spotify search unavailable. Check the connection and retry.' });
      return [{ name: 'Artist', imageUrl: null, sources: ['deezer'], deezerId: 7 }];
    });
    const response = await request(app).get('/api/search/discover').query({ q: 'Artist', sources: 'spotify,deezer' });
    expect(response.status).toBe(200);
    expect(response.body.results).toHaveLength(1);
    expect(response.body.errors).toEqual(['Spotify search unavailable. Check the connection and retry.']);
  });

  it('returns structured identity-required candidates before any provider acquisition', async () => {
    const candidates = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Same name', disambiguation: 'Original band' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Same name', disambiguation: 'Other artist' }];
    const connection = { id: 1, type: 'lidarr', config: { url: 'http://localhost', apiKey: 'test', qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music' } };
    vi.mocked(prisma.connection.findFirst).mockResolvedValueOnce(connection as never).mockResolvedValueOnce(connection as never);
    vi.mocked(resolveMbid).mockResolvedValueOnce({ mbid: null, candidates });
    const providerAdd = vi.fn().mockResolvedValue({ artist: { foreignArtistId: candidates[1].id, artistName: 'Same name' } });
    const createProvider = function () { return { addArtistWithCacheWarm: providerAdd } as unknown as LidarrService; };
    vi.mocked(LidarrService).mockImplementationOnce(createProvider).mockImplementationOnce(createProvider);
    const response = await request(app).post('/api/search/discover/add').send({ artistName: 'Same name' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'IDENTITY_REQUIRED', details: { candidates, artistName: 'Same name' }, candidates, artistName: 'Same name' });
    expect(providerAdd).not.toHaveBeenCalled();
    const selected = await request(app).post('/api/search/discover/add').send({ artistName: 'Same name', mbid: candidates[1].id });
    expect(selected.body.error).toBeUndefined();
    expect(selected.status).toBe(200);
    expect(selected.body.success).toBe(true);
    expect(providerAdd).toHaveBeenCalledTimes(1);
    expect(providerAdd.mock.calls[0][0]).toBe(candidates[1].id);
    expect(resolveMbid).toHaveBeenCalledTimes(1);
  });

  describe('POST /api/search/artists/add', () => {
    it('should require Lidarr connection for adding artists', async () => {
      const response = await request(app)
        .post('/api/search/artists/add')
        .send({ foreignArtistId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });

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
        .send({ artistIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'] });

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
  it('does not acquire implicitly even when a name resolution is confident', async () => {
    const connection = { id: 1, type: 'lidarr', config: { url: 'http://localhost', apiKey: 'test', qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music' } };
    vi.mocked(prisma.connection.findFirst).mockResolvedValueOnce(connection as never);
    vi.mocked(resolveMbid).mockResolvedValueOnce({ mbid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    const providerAdd = vi.fn();
    vi.mocked(LidarrService).mockImplementationOnce(function () { return { addArtistWithCacheWarm: providerAdd } as unknown as LidarrService; });
    const response = await request(app).post('/api/search/discover/add').send({ artistName: 'Confident name' });
    expect(response.status).toBe(422); expect(response.body.code).toBe('IDENTITY_REQUIRED');
    expect(providerAdd).not.toHaveBeenCalled();
  });
  it.each(['/artists/add', '/discover/add', '/batch'])('passes selected effective options through the real %s route to the provider', async path => {
    const mbid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const connection = { id: 1, type: 'lidarr', config: { url: 'http://localhost', apiKey: 'test', qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music', searchOnAdd: true } };
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(connection as never);
    const providerAdd = vi.fn().mockResolvedValue({ artist: { foreignArtistId: mbid, artistName: 'Artist' } });
    vi.mocked(LidarrService).mockImplementation(function () { return { addArtistWithCacheWarm: providerAdd,
      getQualityProfiles: vi.fn().mockResolvedValue([{ id: 9 }]), getMetadataProfiles: vi.fn().mockResolvedValue([{ id: 8 }]), getRootFolders: vi.fn().mockResolvedValue([{ path: '/archive' }]),
    } as unknown as LidarrService; });
    const identity = path === '/artists/add' ? { foreignArtistId: mbid } : path === '/batch' ? { artistIds: [mbid] } : { artistName: 'Artist', mbid };
    const response = await request(app).post(`/api/search${path}`).send({ ...identity, qualityProfileId: 9, metadataProfileId: 8, rootFolderPath: '/archive', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' });
    expect(response.status).toBe(200);
    expect(providerAdd).toHaveBeenCalledWith(mbid, 9, 8, '/archive', true, false, false, 'future', 'none');
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);
  });
  it.each([{ qualityProfileId: -1 }, { monitorOption: 'invented' }, { searchOnAdd: 'false' }])('rejects malformed effective options before provider acquisition', async options => {
    const response = await request(app).post('/api/search/artists/add').send({ foreignArtistId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ...options });
    expect(response.status).toBe(400);
  });

  it.each(['/artists/add', '/discover/add', '/batch'])('rejects an unavailable profile in %s without provider acquisition', async path => {
    const mbid = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const connection = { id: 1, type: 'lidarr', config: { url: 'http://localhost', apiKey: 'test', qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music' } };
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(connection as never);
    const add = vi.fn();
    vi.mocked(LidarrService).mockImplementation(function () { return { addArtistWithCacheWarm: add, getQualityProfiles: vi.fn().mockResolvedValue([{ id: 1 }]) } as unknown as LidarrService; });
    const identity = path === '/artists/add' ? { foreignArtistId: mbid } : path === '/batch' ? { artistIds: [mbid] } : { artistName: 'Artist', mbid };
    const response = await request(app).post(`/api/search${path}`).send({ ...identity, qualityProfileId: 99 });
    expect(response.status).toBe(400); expect(response.body.code).toBe('INVALID_OPTIONS'); expect(add).not.toHaveBeenCalled();
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);
  });

});


describe('Label release traversal through the search route', () => {
  const labelId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const artistId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const release = { 'artist-credit': [{ artist: { id: artistId, name: 'Repeated artist', 'sort-name': 'Artist, Repeated' } }] };
  beforeEach(() => {
    mockGetLabelArtists.mockReset();
    vi.mocked(getArtistImages).mockReset().mockResolvedValue(new Map());
  });
  it('advances by raw releases and reports the provider total, including repeated artists', async () => {
    mockGetLabelArtists.mockResolvedValueOnce({ releases: [release, release], count: 5 });
    const response = await request(app).get(`/api/search/label/${labelId}/artists?limit=2&offset=0`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ artists: [{ id: artistId, name: 'Repeated artist', sortName: 'Artist, Repeated', imageUrl: null }], releasesProcessed: 2, totalReleases: 5, nextReleaseOffset: 2 });
    expect(mockGetLabelArtists).toHaveBeenCalledWith(labelId, 2, 0);
  });
  it('advances pages without artist credits and ends at the last raw release', async () => {
    mockGetLabelArtists.mockResolvedValueOnce({ releases: [{}, {}], count: 5 }).mockResolvedValueOnce({ releases: [release], count: 5 });
    const empty = await request(app).get(`/api/search/label/${labelId}/artists?limit=2&offset=2`);
    expect(empty.body).toEqual({ artists: [], releasesProcessed: 2, totalReleases: 5, nextReleaseOffset: 4 });
    const final = await request(app).get(`/api/search/label/${labelId}/artists?limit=2&offset=4`);
    expect(final.body.nextReleaseOffset).toBeNull();
    expect(final.body.releasesProcessed).toBe(1);
  });
  it('treats an empty provider page before its total as recoverable, rather than finished', async () => {
    mockGetLabelArtists.mockResolvedValueOnce({ releases: [], count: 5 });
    const response = await request(app).get(`/api/search/label/${labelId}/artists?offset=2`);
    expect(response.status).toBe(502);
    expect(response.body).not.toHaveProperty('nextReleaseOffset');
  });
  it('preserves valid artists when optional images fail', async () => {
    mockGetLabelArtists.mockResolvedValueOnce({ releases: [release], count: 1 });
    vi.mocked(getArtistImages).mockRejectedValueOnce(new Error('private provider detail'));
    const response = await request(app).get(`/api/search/label/${labelId}/artists`);
    expect(response.status).toBe(200);
    expect(response.body.artists[0].imageUrl).toBeNull();
  });
  it('sanitizes provider failures and allows a retry at the same release offset', async () => {
    mockGetLabelArtists.mockRejectedValueOnce(new Error('secret upstream address')).mockResolvedValueOnce({ releases: [release], count: 3 });
    const failed = await request(app).get(`/api/search/label/${labelId}/artists?offset=2`);
    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain('secret');
    const retried = await request(app).get(`/api/search/label/${labelId}/artists?offset=2`);
    expect(retried.status).toBe(200);
    expect(mockGetLabelArtists.mock.calls.map(call => call[2])).toEqual([2, 2]);
  });
  it.each(['limit=101', 'limit=0', 'limit=1x', 'offset=-1', 'offset=2.5', 'offset=9007199254740992', 'limit=2&limit=3'])('rejects invalid paging %s before calling the provider', async query => {
    const response = await request(app).get(`/api/search/label/${labelId}/artists?${query}`);
    expect(response.status).toBe(400);
    expect(mockGetLabelArtists).not.toHaveBeenCalled();
  });
  it('rejects an invalid label identity before calling the provider', async () => {
    const response = await request(app).get('/api/search/label/not-a-uuid/artists');
    expect(response.status).toBe(400);
    expect(mockGetLabelArtists).not.toHaveBeenCalled();
  });
});
