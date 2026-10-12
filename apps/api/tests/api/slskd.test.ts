/**
 * slskd API Routes Tests
 * 
 * Tests:
 * - Search: Start searches, get results, delete searches
 * - Downloads: Queue downloads, get tracked downloads
 * - Connection validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock the rate limiter
vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Mock settings - rate limiting disabled for tests
vi.mock('../../src/lib/settings.js', () => ({
  isSlskdRateLimitingEnabled: vi.fn().mockResolvedValue(false),
}));

// Mock queue operations
vi.mock('../../src/jobs/slskd-operations-queue.js', () => ({
  enqueueSlskdDownload: vi.fn().mockResolvedValue({
    waitUntilFinished: vi.fn().mockResolvedValue({}),
  }),
  SLSKD_QUEUE_NAME: 'slskd-operations',
}));

// Mock redis
vi.mock('../../src/lib/redis.js', () => ({
  createRedisConnection: vi.fn().mockReturnValue({
    duplicate: vi.fn().mockReturnValue({
      on: vi.fn().mockReturnThis(),
      connect: vi.fn().mockResolvedValue({}),
    }),
  }),
}));

vi.mock('bullmq', () => ({
  QueueEvents: class { close = vi.fn().mockResolvedValue(undefined); },
}));

// Mock the organizer service
const mockOrganizeFile = vi.fn();
vi.mock('../../src/services/slskd-organizer.js', () => {
  return {
    SlskdOrganizerService: class MockSlskdOrganizerService {
      organizeFile = mockOrganizeFile;
    },
  };
});

// Helper to create a mock fetch response
function mockFetchResponse(data: unknown, ok = true, status = 200): Partial<Response> {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

describe('slskd API Routes', () => {
  let app: express.Express;
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockPrisma: {
    connection: {
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    slskdDownload: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(async () => {
    vi.resetModules();
    
    // Setup mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Setup mock prisma
    mockPrisma = {
      connection: {
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 1 }]),
      },
      slskdDownload: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
    };
    
    // Mock the database module
    vi.doMock('../../src/lib/db.js', () => ({
      prisma: mockPrisma,
      default: mockPrisma,
    }));
    
    vi.doUnmock('../../src/middleware/auth.js');
    
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 1, username: 'testuser', role: 'user' } as Express.User;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    
    const { default: slskdRouter } = await import('../../src/routes/slskd.js');
    app.use('/api/slskd', slskdRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('POST /api/slskd/search', () => {
    it('should start a search with valid connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'InProgress',
      }));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(200);
      expect(response.body.id).toBe('search-123');
      expect(response.body.searchText).toBe('Pink Floyd');
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Soulseek connection configured. Add one in Settings → Connections.');
    });

    it('should return 400 when query is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.query).toBeDefined();
    });

    it('should pass search options to slskd', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-456',
        searchText: 'Tool',
        state: 'InProgress',
      }));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ 
          query: 'Tool', 
          options: { 
            filterResponses: true,
            minimumPeerUploadSpeed: 1000,
          } 
        });

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalled();
      
      // Verify fetch was called with correct options
      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.searchText).toBe('Tool');
      expect(body.filterResponses).toBe(true);
      expect(body.minimumPeerUploadSpeed).toBe(1000);
    });
  });

  describe('GET /api/slskd/search/:id', () => {
    it('should return search results', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse({
        id: 'search-123',
        searchText: 'Pink Floyd',
        state: 'Completed',
        responses: [
          {
            username: 'user1',
            files: [{ filename: 'song.flac', size: 50000000 }],
          },
        ],
      }));

      const response = await request(app)
        .get('/api/slskd/search/search-123');

      expect(response.status).toBe(200);
      expect(response.body.state).toBe('Completed');
      expect(response.body.responses).toHaveLength(1);
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/slskd/search/search-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Soulseek connection configured. Add one in Settings → Connections.');
    });
  });

  describe('DELETE /api/slskd/search/:id', () => {
    it('should delete a search', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      // DELETE typically returns empty or no-content
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });

      const response = await request(app)
        .delete('/api/slskd/search/search-123');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .delete('/api/slskd/search/search-123');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Soulseek connection configured. Add one in Settings → Connections.');
    });
  });

  describe('POST /api/slskd/download', () => {
    it('should queue files for download', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      });

      mockPrisma.slskdDownload.create.mockImplementation((args: { data: Record<string, unknown> }) => 
        Promise.resolve({
          id: 1,
          ...args.data,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
      );

      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
          files: [
            { filename: '/music/Pink Floyd/DSOTM/01-track.flac', size: 50000000 },
          ],
          artistName: 'Pink Floyd',
          albumName: 'Dark Side of the Moon',
          albumYear: 1973,
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.downloads).toHaveLength(1);
    });

    it('should return 400 when username is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          files: [{ filename: 'test.flac', size: 1000 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.username).toBeDefined();
    });

    it('should return 400 when files is missing', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
        });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.files).toBeDefined();
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/download')
        .send({
          username: 'soulseekuser',
          files: [{ filename: 'test.flac', size: 1000 }],
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Soulseek connection configured. Add one in Settings → Connections.');
    });
  });

  describe('GET /api/slskd/downloads', () => {
    it('should return tracked downloads', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([
        {
          id: 1,
          connectionId: 1,
          username: 'soulseekuser',
          artistName: 'Pink Floyd',
          albumName: 'Dark Side of the Moon',
          albumYear: 1973,
          filename: 'track.flac',
          fileSize: 50000000,
          status: 'completed',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 2,
          connectionId: 1,
          username: 'anotheruser',
          artistName: 'Tool',
          albumName: 'Lateralus',
          albumYear: 2001,
          filename: 'track.flac',
          fileSize: 60000000,
          status: 'downloading',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].artistName).toBe('Pink Floyd');
      expect(response.body[1].artistName).toBe('Tool');
      expect(mockPrisma.connection.findMany).toHaveBeenCalledWith({
        where: { type: 'slskd', userId: 1 }, select: { id: true },
      });
      expect(mockPrisma.slskdDownload.findMany).toHaveBeenCalledWith({
        where: { connectionId: { in: [1] } }, orderBy: { createdAt: 'desc' }, take: 100,
      });
    });

    it('should return empty array when no downloads exist', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(0);
    });
  });

  describe('POST /api/slskd/downloads/:id/retry', () => {
    it('should return 400 when the owned download connection is inactive', async () => {
      mockPrisma.slskdDownload.findUnique.mockResolvedValue({
        id: 1,
        connectionId: 7,
        username: 'soulseekuser',
        filename: 'track.flac',
        fileSize: 50000000,
        status: 'failed',
      });
      mockPrisma.connection.findFirst
        .mockResolvedValueOnce({ id: 7, userId: 1, type: 'slskd', isActive: false })
        .mockResolvedValueOnce(null);

      const response = await request(app).post('/api/slskd/downloads/1/retry');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No Soulseek connection configured. Add one in Settings → Connections.');
      expect(mockPrisma.connection.findFirst).toHaveBeenNthCalledWith(1, {
        where: { id: 7, type: 'slskd', userId: 1 },
      });
      expect(mockPrisma.connection.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: 7, type: 'slskd', userId: 1, isActive: true },
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPrisma.slskdDownload.update).not.toHaveBeenCalled();
    });

    it('should return 404 for a missing download before looking up any connection', async () => {
      mockPrisma.slskdDownload.findUnique.mockResolvedValue(null);

      const response = await request(app).post('/api/slskd/downloads/999/retry');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Download not found');
      expect(mockPrisma.connection.findFirst).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPrisma.slskdDownload.update).not.toHaveBeenCalled();
    });

    it('should return 404 when the exact download connection is not owned by the actor', async () => {
      mockPrisma.slskdDownload.findUnique.mockResolvedValue({ id: 1, connectionId: 99, status: 'failed' });
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app).post('/api/slskd/downloads/1/retry');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Download not found');
      expect(mockPrisma.connection.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { id: 99, type: 'slskd', userId: 1 },
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockPrisma.slskdDownload.update).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle slskd API errors gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      mockFetch.mockResolvedValue(mockFetchResponse(
        { error: 'Internal Server Error' },
        false,
        500
      ));

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Search failed');
    });

    it('should handle database errors gracefully', async () => {
      mockPrisma.slskdDownload.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get downloads');
      expect(mockPrisma.slskdDownload.findMany).toHaveBeenCalledWith({
        where: { connectionId: { in: [1] } }, orderBy: { createdAt: 'desc' }, take: 100,
      });
    });
  });

  describe('POST /api/slskd/webhook', () => {
    it('should accept download completion webhook', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'pending',
        artistName: 'Pink Floyd',
      });

      // Mock atomic updateMany - simulate successful race win
      mockPrisma.slskdDownload.updateMany.mockResolvedValue({ count: 1 });

      // Configure the mock organizer
      mockOrganizeFile.mockResolvedValue('/data/plex/music/Pink Floyd/track.flac');

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: '/music/Pink Floyd/track.flac',
          directory: 'Pink Floyd - DSOTM',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should prevent race condition with atomic status updates', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      // Simulate finding a download that's being processed
      mockPrisma.slskdDownload.findFirst.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'downloading', // Already in downloading state
        artistName: 'Pink Floyd',
      });

      // Simulate atomic update returning 0 (another process already updated)
      mockPrisma.slskdDownload.updateMany.mockResolvedValue({ count: 0 });

      // Mock organizer should NOT be called
      mockOrganizeFile.mockClear();

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: '/music/Pink Floyd/track.flac',
          directory: 'Pink Floyd - DSOTM',
        });

      // Should still return success but skip organization
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.organized).toBe(false);
      
      // Most importantly: organizeFile should NOT have been called
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });

    it('should ignore non-download events', async () => {
      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'SearchComplete',
          searchId: 'search-123',
        });

      expect(response.status).toBe(200);
      expect(response.body.ignored).toBe(true);
    });

    it('should handle unknown downloads gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        enabled: true,
        config: { url: 'http://localhost:5030', apiKey: 'key' },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'unknown',
          filename: 'unknown.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(200);
      expect(response.body.matched).toBe(false);
    });

    it('should return 400 when no slskd connection exists', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: 'track.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('No slskd connection configured');
    });

    it('should handle organization errors gracefully', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockPrisma.slskdDownload.findFirst.mockResolvedValue({
        id: 1,
        username: 'soulseekuser',
        filename: 'track.flac',
        status: 'pending',
      });

      // Atomic update succeeds (we win the race)
      mockPrisma.slskdDownload.updateMany.mockResolvedValue({ count: 1 });

      // But then organization fails
      mockOrganizeFile.mockRejectedValue(new Error('Organization failed'));

      // Update for error handling should succeed
      mockPrisma.slskdDownload.update.mockResolvedValue({
        id: 1,
        status: 'failed',
      });

      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({
          event: 'DownloadComplete',
          username: 'soulseekuser',
          filename: 'track.flac',
          directory: 'Album',
        });

      expect(response.status).toBe(500);
    });
  });
});

// ============================================================================
// INPUT VALIDATION TESTS
// ============================================================================

describe('slskd input validation', () => {
  let app: express.Express;
  let mockPrisma: Record<string, Record<string, ReturnType<typeof vi.fn>>>;

  beforeEach(async () => {
    vi.resetModules();

    global.fetch = vi.fn();

    mockPrisma = {
      connection: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([{ id: 1 }]) },
      slskdDownload: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn(),
      },
    };

    vi.doMock('../../src/lib/db.js', () => ({
      prisma: mockPrisma,
      default: mockPrisma,
    }));

    vi.doUnmock('../../src/middleware/auth.js');

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { id: 1, username: 'testuser', role: 'user' } as Express.User;
      req.isAuthenticated = (() => true) as typeof req.isAuthenticated;
      next();
    });
    const { default: slskdRouter } = await import('../../src/routes/slskd.js');
    app.use('/api/slskd', slskdRouter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('POST /api/slskd/search validation', () => {
    it('should reject empty query string', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: '' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.query).toBeDefined();
    });

    it('should reject query exceeding 500 chars', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'a'.repeat(501) });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.query).toBeDefined();
    });

    it('should reject non-string query', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 123 });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject invalid search options', async () => {
      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Pink Floyd', options: { searchTimeout: -5 } });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid search with options', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue({
        id: 1,
        userId: 1,
        type: 'slskd',
        isActive: true,
        config: { url: 'http://localhost:5030', apiKey: 'test-key' },
      });

      (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 's1', searchText: 'Tool', state: 'InProgress' }),
        text: () => Promise.resolve('{}'),
      });

      const response = await request(app)
        .post('/api/slskd/search')
        .send({ query: 'Tool', options: { searchTimeout: 60, filterResponses: true } });

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/slskd/download validation', () => {
    it('should reject empty files array', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({ username: 'user1', files: [] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.files).toBeDefined();
    });

    it('should reject files exceeding max of 100', async () => {
      const files = Array.from({ length: 101 }, (_, i) => ({ filename: `track${i}.flac`, size: 1000 }));
      const response = await request(app)
        .post('/api/slskd/download')
        .send({ username: 'user1', files });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.files).toBeDefined();
    });

    it('should reject username exceeding 200 chars', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({ username: 'u'.repeat(201), files: [{ filename: 'a.flac', size: 100 }] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.username).toBeDefined();
    });

    it('should reject file with negative size', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({ username: 'user1', files: [{ filename: 'a.flac', size: -1 }] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject file with empty filename', async () => {
      const response = await request(app)
        .post('/api/slskd/download')
        .send({ username: 'user1', files: [{ filename: '', size: 100 }] });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/slskd/downloads validation', () => {
    it('should reject limit exceeding 500', async () => {
      const response = await request(app)
        .get('/api/slskd/downloads?limit=501');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject limit of 0', async () => {
      const response = await request(app)
        .get('/api/slskd/downloads?limit=0');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid query params', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/slskd/downloads?status=pending&limit=50');

      expect(response.status).toBe(200);
      expect(mockPrisma.connection.findMany).toHaveBeenCalledWith({
        where: { type: 'slskd', userId: 1 }, select: { id: true },
      });
      expect(mockPrisma.slskdDownload.findMany).toHaveBeenCalledWith({
        where: { connectionId: { in: [1] }, status: 'pending' }, orderBy: { createdAt: 'desc' }, take: 50,
      });
    });

    it('should default limit to 100', async () => {
      mockPrisma.slskdDownload.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/slskd/downloads');

      expect(response.status).toBe(200);
      // Verify findMany was called with take: 100
      expect(mockPrisma.slskdDownload.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { connectionId: { in: [1] } }, take: 100 }),
      );
    });
  });

  describe('POST /api/slskd/webhook validation', () => {
    it('should reject missing event field', async () => {
      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({ username: 'user1' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.event).toBeDefined();
    });

    it('should reject empty event string', async () => {
      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({ event: '' });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.event).toBeDefined();
    });

    it('should accept valid webhook with minimal fields', async () => {
      const response = await request(app)
        .post('/api/slskd/webhook')
        .send({ event: 'SearchComplete' });

      expect(response.status).toBe(200);
      expect(response.body.ignored).toBe(true);
    });
  });

  describe('DELETE /api/slskd/downloads/:id validation', () => {
    it('should reject non-numeric id', async () => {
      const response = await request(app)
        .delete('/api/slskd/downloads/abc');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should reject negative id', async () => {
      const response = await request(app)
        .delete('/api/slskd/downloads/-1');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('should accept valid delete with remove=true', async () => {
      mockPrisma.slskdDownload.findUnique.mockResolvedValue({
        id: 1,
        connectionId: 7,
        status: 'failed',
      });
      mockPrisma.connection.findFirst.mockResolvedValue({ id: 7, userId: 1, type: 'slskd', isActive: true });
      mockPrisma.slskdDownload.delete.mockResolvedValue({ id: 1 });

      const response = await request(app)
        .delete('/api/slskd/downloads/1?remove=true');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockPrisma.connection.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { id: 7, type: 'slskd', userId: 1 },
      });
      expect(mockPrisma.slskdDownload.delete).toHaveBeenCalledWith({ where: { id: 1 } });
    });
  });

  describe('POST /api/slskd/downloads/:id/retry validation', () => {
    it('should reject non-numeric id', async () => {
      const response = await request(app)
        .post('/api/slskd/downloads/abc/retry');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });
});

/**
 * Separate describe block to verify webhook auth requirement.
 * Uses an unauthenticated request fixture with the real requireAuth middleware.
 */
describe('slskd webhook authentication', () => {
  it('should require authentication for webhook endpoint (router-level middleware)', async () => {
    vi.resetModules();

    vi.doUnmock('../../src/middleware/auth.js');

    // Need all the same infrastructure mocks so the router module loads
    vi.doMock('../../src/lib/db.js', () => ({
      prisma: { connection: { findFirst: vi.fn() }, slskdDownload: { findFirst: vi.fn() } },
      default: { connection: { findFirst: vi.fn() }, slskdDownload: { findFirst: vi.fn() } },
    }));

    const testApp = express();
    testApp.use(express.json());
    testApp.use((req, _res, next) => {
      req.isAuthenticated = (() => false) as typeof req.isAuthenticated;
      next();
    });
    const { default: slskdRouter } = await import('../../src/routes/slskd.js');
    testApp.use('/api/slskd', slskdRouter);

    const response = await request(testApp)
      .post('/api/slskd/webhook')
      .send({
        event: 'DownloadComplete',
        username: 'testuser',
        filename: 'test.flac',
        directory: 'Album',
      });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Authentication required');
  });
});
