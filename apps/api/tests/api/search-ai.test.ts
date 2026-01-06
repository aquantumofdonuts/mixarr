// apps/api/tests/api/search-ai.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { searchRouter } from '../../src/routes/search.js';

// Create mock functions that we can control per-test
const mockSearchArtist = vi.fn();
const mockLidarrCacheRefresh = vi.fn();
const mockLidarrCacheExists = vi.fn();

// Mock dependencies
vi.mock('../../src/lib/db.js', () => ({
  default: {
    connection: { findFirst: vi.fn() },
    aISettings: { findFirst: vi.fn() },
  },
}));

vi.mock('../../src/services/ai.js', () => ({
  aiService: {
    loadSettings: vi.fn(),
    isAvailable: vi.fn(),
    searchByPrompt: vi.fn(),
  },
  AIService: vi.fn(),
}));

vi.mock('../../src/services/lidarr.js', () => {
  return {
    LidarrService: class MockLidarrService {
      searchArtist = mockSearchArtist;
    },
    LidarrCache: class MockLidarrCache {
      refresh = mockLidarrCacheRefresh;
      exists = mockLidarrCacheExists;
    },
  };
});

vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImages: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('../../src/services/musicbrainz.js', () => {
  const mockMbSearchArtist = vi.fn();
  return {
    MusicBrainzService: class MockMusicBrainzService {
      searchArtist = mockMbSearchArtist;
    },
    __mockMbSearchArtist: mockMbSearchArtist,
  };
});

vi.mock('../../src/services/lastfm.js', () => ({
  LastfmService: vi.fn(),
}));

vi.mock('../../src/services/multi-search.js', () => ({
  multiSourceSearch: vi.fn(),
  resolveMbid: vi.fn(),
}));

vi.mock('../../src/services/metadata-enrichment.js', () => ({
  MetadataEnrichmentService: vi.fn(),
}));

vi.mock('../../src/services/notifications.js', () => ({
  notificationService: {
    notify: vi.fn(),
    send: vi.fn(),
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'test' };
    next();
  }),
  requireAdmin: vi.fn((req: any, _res: any, next: any) => {
    req.user = { id: 1, username: 'test', role: 'admin' };
    next();
  }),
}));

import prisma from '../../src/lib/db.js';
import { aiService } from '../../src/services/ai.js';
// Get mock function from the mock module
const { __mockMbSearchArtist: mockMbSearchArtist } = await import('../../src/services/musicbrainz.js') as any;

const app = express();
app.use(express.json());
app.use('/api/search', searchRouter);

describe('POST /api/search/ai', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 400 if prompt is missing', async () => {
    const res = await request(app)
      .post('/api/search/ai')
      .send({});
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('prompt');
  });

  it('should return 400 if prompt is empty string', async () => {
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: '   ' });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('prompt');
  });

  it('should return 400 if AI is not configured', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(false);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'chill lo-fi beats' });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('AI');
    expect(res.body.configured).toBe(false);
  });

  it('should use MusicBrainz when no Lidarr connection and omit inLibrary field', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(true);
    vi.mocked(aiService.searchByPrompt).mockResolvedValue({
      artists: ['Nujabes'],
      providers: ['openai'],
    });
    vi.mocked(prisma.connection.findFirst).mockResolvedValue(null);
    
    // Mock MusicBrainz to return an artist
    mockMbSearchArtist.mockResolvedValueOnce([
      { id: 'mb-12345', name: 'Nujabes', disambiguation: 'Japanese producer' }
    ]);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'chill lo-fi beats' });
    
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].foreignArtistId).toBe('mb-12345');
    expect(res.body.results[0].artistName).toBe('Nujabes');
    // inLibrary should be omitted when no Lidarr
    expect(res.body.results[0]).not.toHaveProperty('inLibrary');
  });

  it('should return empty results when AI finds no artists', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(true);
    vi.mocked(aiService.searchByPrompt).mockResolvedValue({
      artists: [],
      providers: ['openai'],
    });
    
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: 1,
      type: 'lidarr',
      config: { url: 'http://localhost', apiKey: 'test' },
    } as any);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'obscure experimental noise' });
    
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(0);
    expect(res.body.message).toContain('No recommendations');
  });

  it('should return enriched artist results', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(true);
    vi.mocked(aiService.searchByPrompt).mockResolvedValue({
      artists: ['Nujabes', 'J Dilla'],
      providers: ['openai'],
    });
    
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: 1,
      type: 'lidarr',
      config: { url: 'http://localhost', apiKey: 'test' },
    } as any);
    
    mockSearchArtist
      .mockResolvedValueOnce([{ foreignArtistId: 'mbid-1', artistName: 'Nujabes', overview: 'Japanese producer' }])
      .mockResolvedValueOnce([{ foreignArtistId: 'mbid-2', artistName: 'J Dilla', overview: 'Detroit producer' }]);
    mockLidarrCacheExists.mockResolvedValue(false);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'chill lo-fi beats' });
    
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe('chill lo-fi beats');
    expect(res.body.results).toHaveLength(2);
    expect(res.body.aiProviders).toContain('openai');
    expect(res.body.results[0].foreignArtistId).toBe('mbid-1');
    expect(res.body.results[1].foreignArtistId).toBe('mbid-2');
  });

  it('should filter out artists that cannot be resolved via Lidarr', async () => {
    vi.mocked(aiService.isAvailable).mockResolvedValue(true);
    vi.mocked(aiService.searchByPrompt).mockResolvedValue({
      artists: ['Known Artist', 'Unknown Artist'],
      providers: ['anthropic'],
    });
    
    vi.mocked(prisma.connection.findFirst).mockResolvedValue({
      id: 1,
      type: 'lidarr',
      config: { url: 'http://localhost', apiKey: 'test' },
    } as any);
    
    mockSearchArtist
      .mockResolvedValueOnce([{ foreignArtistId: 'mbid-1', artistName: 'Known Artist' }])
      .mockResolvedValueOnce([]); // Unknown artist returns empty
    mockLidarrCacheExists.mockResolvedValue(false);
    
    const res = await request(app)
      .post('/api/search/ai')
      .send({ prompt: 'test query' });
    
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].artistName).toBe('Known Artist');
  });
});
