/**
 * MetadataFixService Tests
 * 
 * Tests for single-artist metadata fix functionality.
 * Validates cache warming before Lidarr refresh to fix missing metadata.
 * 
 * Tests:
 * - Input validation (artistId, MBID)
 * - Cache warming before refresh
 * - Fix result reporting
 * - Error handling (cache failures, timeouts)
 * - Batch operations (start, status, cancel)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetadataFixService, type FixResult, type JobInfo, type JobStatus, type ArtistToFix } from '../../src/services/metadata-fix.js';
import { createMockLidarrService } from '../utils/fixtures.js';
import type { SkyHookCacheWarmer, WarmResult } from '../../src/services/skyhook-cache-warmer.js';
import type { LidarrArtist, LidarrCommand, LidarrService } from '../../src/services/lidarr.js';

// Mock Redis
vi.mock('../../src/lib/redis.js', () => ({
  redis: {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  },
}));

import { redis } from '../../src/lib/redis.js';

// Factory for mock SkyHookCacheWarmer
function createMockWarmer(): {
  warmArtist: ReturnType<typeof vi.fn<(mbid: string) => Promise<WarmResult>>>;
} {
  return {
    warmArtist: vi.fn<(mbid: string) => Promise<WarmResult>>().mockResolvedValue({
      success: true,
      attempts: 1,
      cached: true,
    }),
  };
}

// Factory for mock LidarrArtist with metadata
function createMockArtistWithMetadata(overrides: Partial<LidarrArtist> = {}): LidarrArtist {
  return {
    id: 1,
    artistName: 'Test Artist',
    foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    monitored: true,
    qualityProfileId: 1,
    metadataProfileId: 1,
    rootFolderPath: '/music',
    overview: 'A great artist with lots of albums.',
    genres: ['rock', 'alternative'],
    images: [
      { coverType: 'poster', url: '/poster.jpg', remoteUrl: 'http://example.com/poster.jpg' },
    ],
    ...overrides,
  };
}

// Factory for mock LidarrArtist with missing metadata
function createMockArtistMissingMetadata(overrides: Partial<LidarrArtist> = {}): LidarrArtist {
  return {
    id: 1,
    artistName: 'Test Artist',
    foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    monitored: true,
    qualityProfileId: 1,
    metadataProfileId: 1,
    rootFolderPath: '/music',
    overview: undefined,
    genres: [],
    images: [],
    ...overrides,
  };
}

describe('MetadataFixService', () => {
  let service: MetadataFixService;
  let mockWarmer: ReturnType<typeof createMockWarmer>;
  let mockLidarr: ReturnType<typeof createMockLidarrService>;

  beforeEach(() => {
    mockWarmer = createMockWarmer();
    mockLidarr = createMockLidarrService();
    service = new MetadataFixService(mockWarmer as unknown as SkyHookCacheWarmer);
    
    // Reset Redis mocks
    vi.mocked(redis.get).mockReset();
    vi.mocked(redis.set).mockReset();
    vi.mocked(redis.del).mockReset();
  });

  describe('input validation', () => {
    it('should reject invalid artist ID (negative number)', async () => {
      await expect(
        service.fixArtist(
          mockLidarr as unknown as LidarrService,
          -1,
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        )
      ).rejects.toThrow('Artist ID must be a positive integer');
    });

    it('should reject invalid artist ID (zero)', async () => {
      await expect(
        service.fixArtist(
          mockLidarr as unknown as LidarrService,
          0,
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        )
      ).rejects.toThrow('Artist ID must be a positive integer');
    });

    it('should reject invalid artist ID (non-integer)', async () => {
      await expect(
        service.fixArtist(
          mockLidarr as unknown as LidarrService,
          1.5,
          'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
        )
      ).rejects.toThrow('Artist ID must be a positive integer');
    });

    it('should reject empty MBID', async () => {
      await expect(
        service.fixArtist(mockLidarr as unknown as LidarrService, 1, '')
      ).rejects.toThrow('MBID is required');
    });

    it('should reject invalid MBID format', async () => {
      await expect(
        service.fixArtist(mockLidarr as unknown as LidarrService, 1, 'not-a-valid-mbid')
      ).rejects.toThrow('Invalid MBID format');
    });
  });

  describe('cache warming', () => {
    it('should warm cache before refreshing artist', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const artistBefore = createMockArtistMissingMetadata();
      const artistAfter = createMockArtistWithMetadata();

      // Setup: artist starts without metadata, ends with metadata
      mockLidarr.getArtist
        .mockResolvedValueOnce(artistBefore)  // First call: before fix
        .mockResolvedValueOnce(artistAfter);  // Second call: after refresh

      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

      await service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid);

      // Verify order: warm cache first, then refresh
      expect(mockWarmer.warmArtist).toHaveBeenCalledWith(mbid);
      expect(mockWarmer.warmArtist).toHaveBeenCalledBefore(mockLidarr.refreshArtist);
      expect(mockLidarr.refreshArtist).toHaveBeenCalledWith(1);
    });

    it('should handle cache warm failure gracefully and still try refresh', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const artistBefore = createMockArtistMissingMetadata();
      const artistAfter = createMockArtistMissingMetadata(); // No change since cache failed

      // Cache warm fails
      mockWarmer.warmArtist.mockResolvedValue({
        success: false,
        attempts: 5,
        cached: false,
        error: 'Cache warm timeout',
      });

      mockLidarr.getArtist
        .mockResolvedValueOnce(artistBefore)
        .mockResolvedValueOnce(artistAfter);

      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

      // Should NOT throw, should still attempt refresh
      const result = await service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid);

      expect(mockWarmer.warmArtist).toHaveBeenCalledWith(mbid);
      expect(mockLidarr.refreshArtist).toHaveBeenCalledWith(1);
      expect(result.success).toBe(false); // Overall success is false because cache failed
    });
  });

  describe('fix result reporting', () => {
    it('should report what was fixed when metadata is added', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      
      // Before: missing all metadata
      const artistBefore = createMockArtistMissingMetadata();
      
      // After: all metadata present
      const artistAfter = createMockArtistWithMetadata();

      mockLidarr.getArtist
        .mockResolvedValueOnce(artistBefore)
        .mockResolvedValueOnce(artistAfter);

      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

      const result = await service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid);

      expect(result.success).toBe(true);
      expect(result.fixed).toContain('poster');
      expect(result.fixed).toContain('overview');
      expect(result.fixed).toContain('genres');
      expect(result.stillMissing).toHaveLength(0);
      expect(result.artist.hasPoster).toBe(true);
      expect(result.artist.hasOverview).toBe(true);
      expect(result.artist.hasGenres).toBe(true);
    });

    it('should report what is still missing after fix', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      
      // Before: missing all metadata
      const artistBefore = createMockArtistMissingMetadata();
      
      // After: only overview was fixed, still missing poster and genres
      const artistAfter = createMockArtistMissingMetadata({
        overview: 'Some overview text',
      });

      mockLidarr.getArtist
        .mockResolvedValueOnce(artistBefore)
        .mockResolvedValueOnce(artistAfter);

      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

      const result = await service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid);

      expect(result.fixed).toContain('overview');
      expect(result.stillMissing).toContain('poster');
      expect(result.stillMissing).toContain('genres');
      expect(result.artist.hasOverview).toBe(true);
      expect(result.artist.hasPoster).toBe(false);
      expect(result.artist.hasGenres).toBe(false);
    });

    it('should include artist details in result', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const artist = createMockArtistWithMetadata({ id: 42, artistName: 'The Beatles' });

      mockLidarr.getArtist.mockResolvedValue(artist);
      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

      const result = await service.fixArtist(mockLidarr as unknown as LidarrService, 42, mbid);

      expect(result.artist.id).toBe(42);
      expect(result.artist.name).toBe('The Beatles');
    });
  });

  describe('error handling', () => {
    it('should handle Lidarr command timeout', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const artist = createMockArtistMissingMetadata();

      mockLidarr.getArtist.mockResolvedValue(artist);
      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockRejectedValue(
        new Error('Command 100 did not complete within 30000ms')
      );

      await expect(
        service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid)
      ).rejects.toThrow('Lidarr refresh command timed out');
    });

    it('should handle artist not found in Lidarr', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

      mockLidarr.getArtist.mockResolvedValue(null);

      await expect(
        service.fixArtist(mockLidarr as unknown as LidarrService, 999, mbid)
      ).rejects.toThrow('Artist with ID 999 not found in Lidarr');
    });

    it('should handle Lidarr refresh command failure', async () => {
      const mbid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const artist = createMockArtistMissingMetadata();

      mockLidarr.getArtist.mockResolvedValue(artist);
      mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
      mockLidarr.waitForCommand.mockResolvedValue({ 
        id: 100, 
        name: 'RefreshArtist', 
        status: 'failed',
        message: 'Artist metadata fetch failed',
      });

      await expect(
        service.fixArtist(mockLidarr as unknown as LidarrService, 1, mbid)
      ).rejects.toThrow('Lidarr refresh command failed: Artist metadata fetch failed');
    });
  });

  describe('batch operations', () => {
    describe('startBatchFix', () => {
      it('should reject if job already running', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
        ];

        // Simulate existing running job
        vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
          jobId: 'existing-job',
          status: 'running',
          total: 5,
          processed: 2,
          fixed: 1,
          failed: 0,
        }));

        await expect(service.startBatchFix(userId, artists)).rejects.toThrow('Job already in progress');
      });

      it('should return job info with total and estimate', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
          { id: 2, foreignArtistId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', artistName: 'Artist 2' },
          { id: 3, foreignArtistId: 'c3d4e5f6-a7b8-9012-cdef-123456789012', artistName: 'Artist 3' },
        ];

        // No existing job
        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(redis.set).mockResolvedValue('OK');

        const result = await service.startBatchFix(userId, artists);

        expect(result).toHaveProperty('jobId');
        expect(result.total).toBe(3);
        // Estimate: 1 second per artist = 3 seconds = ~0.05 minutes, rounded to nearest minute
        expect(result.estimatedMinutes).toBeGreaterThanOrEqual(0);
      });

      it('should store initial job state in Redis with atomic NX flag', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
        ];

        vi.mocked(redis.get).mockResolvedValue(null);
        vi.mocked(redis.set).mockResolvedValue('OK');

        await service.startBatchFix(userId, artists);

        // Should use atomic SET with NX flag to prevent race conditions
        expect(redis.set).toHaveBeenCalledWith(
          `metadata-fix:job:${userId}`,
          expect.stringContaining('"status":"running"'),
          'EX',
          3600, // 1 hour expiry
          'NX'  // Only set if not exists (atomic check-and-set)
        );
      });
    });

    describe('getJobStatus', () => {
      it('should return null when no job exists', async () => {
        const userId = 1;
        vi.mocked(redis.get).mockResolvedValue(null);

        const result = await service.getJobStatus(userId);

        expect(result).toBeNull();
        expect(redis.get).toHaveBeenCalledWith(`metadata-fix:job:${userId}`);
      });

      it('should return current job state', async () => {
        const userId = 1;
        const jobState: JobStatus = {
          jobId: 'test-job-123',
          status: 'running',
          total: 10,
          processed: 5,
          fixed: 3,
          failed: 1,
          currentArtist: 'Current Artist',
        };

        vi.mocked(redis.get).mockResolvedValue(JSON.stringify(jobState));

        const result = await service.getJobStatus(userId);

        expect(result).toEqual(jobState);
        expect(redis.get).toHaveBeenCalledWith(`metadata-fix:job:${userId}`);
      });
    });

    describe('cancelJob', () => {
      it('should set cancel flag in Redis', async () => {
        const userId = 1;
        
        // Simulate running job exists
        vi.mocked(redis.get).mockResolvedValue(JSON.stringify({
          jobId: 'test-job',
          status: 'running',
          total: 5,
          processed: 2,
          fixed: 1,
          failed: 0,
        }));
        vi.mocked(redis.set).mockResolvedValue('OK');

        const result = await service.cancelJob(userId);

        expect(result).toBe(true);
        expect(redis.set).toHaveBeenCalledWith(
          `metadata-fix:cancel:${userId}`,
          '1',
          'EX',
          300 // 5 min expiry
        );
      });

      it('should return false when no job running', async () => {
        const userId = 1;
        vi.mocked(redis.get).mockResolvedValue(null);

        const result = await service.cancelJob(userId);

        expect(result).toBe(false);
        expect(redis.set).not.toHaveBeenCalled();
      });
    });

    describe('executeBatchFix', () => {
      // Create a testable subclass that exposes the sleep method for mocking
      class TestableMetadataFixService extends MetadataFixService {
        public sleepMock = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
        
        protected override async sleep(ms: number): Promise<void> {
          return this.sleepMock(ms);
        }
      }

      let testableService: TestableMetadataFixService;

      beforeEach(() => {
        testableService = new TestableMetadataFixService(mockWarmer as unknown as SkyHookCacheWarmer);
      });

      it('should update progress during execution', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
          { id: 2, foreignArtistId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', artistName: 'Artist 2' },
        ];

        // Initial job status
        vi.mocked(redis.get).mockImplementation(async (key: string) => {
          if (key === `metadata-fix:job:${userId}`) {
            return JSON.stringify({
              jobId: 'test-job-123',
              status: 'running',
              total: 2,
              processed: 0,
              fixed: 0,
              failed: 0,
            });
          }
          // Cancel key returns null (no cancellation)
          return null;
        });
        vi.mocked(redis.set).mockResolvedValue('OK');

        // Mock fixArtist via Lidarr mocks
        const artistWithMetadata = createMockArtistWithMetadata();
        mockLidarr.getArtist.mockResolvedValue(artistWithMetadata);
        mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
        mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

        await testableService.executeBatchFix(userId, mockLidarr as unknown as LidarrService, artists);

        // Verify Redis set was called multiple times for progress updates
        const setCalls = vi.mocked(redis.set).mock.calls;
        
        // Should have progress updates: currentArtist, progress, currentArtist, progress, completed
        // At minimum, we should have a completed status at the end
        const completedCall = setCalls.find(call => {
          const data = call[1] as string;
          return data.includes('"status":"completed"');
        });
        expect(completedCall).toBeDefined();
        
        const completedData = JSON.parse(completedCall![1] as string) as JobStatus;
        expect(completedData.processed).toBe(2);
        expect(completedData.total).toBe(2);
      });

      it('should handle cancellation during execution', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
          { id: 2, foreignArtistId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', artistName: 'Artist 2' },
        ];

        let callCount = 0;
        vi.mocked(redis.get).mockImplementation(async (key: string) => {
          if (key === `metadata-fix:job:${userId}`) {
            return JSON.stringify({
              jobId: 'test-job-cancel',
              status: 'running',
              total: 2,
              processed: 0,
              fixed: 0,
              failed: 0,
            });
          }
          if (key === `metadata-fix:cancel:${userId}`) {
            // Return cancel flag on first check (before first artist)
            callCount++;
            return callCount === 1 ? '1' : null;
          }
          return null;
        });
        vi.mocked(redis.set).mockResolvedValue('OK');
        vi.mocked(redis.del).mockResolvedValue(1);

        await testableService.executeBatchFix(userId, mockLidarr as unknown as LidarrService, artists);

        // Should have set cancelled status
        const setCalls = vi.mocked(redis.set).mock.calls;
        const cancelledCall = setCalls.find(call => {
          const data = call[1] as string;
          return data.includes('"status":"cancelled"');
        });
        expect(cancelledCall).toBeDefined();
        
        const cancelledData = JSON.parse(cancelledCall![1] as string) as JobStatus;
        expect(cancelledData.status).toBe('cancelled');
        expect(cancelledData.jobId).toBe('test-job-cancel');
        
        // Should have deleted the cancel flag
        expect(redis.del).toHaveBeenCalledWith(`metadata-fix:cancel:${userId}`);
        
        // Should NOT have processed any artists (cancelled before first artist)
        expect(mockLidarr.refreshArtist).not.toHaveBeenCalled();
      });

      it('should set status to completed when all artists processed', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
        ];

        vi.mocked(redis.get).mockImplementation(async (key: string) => {
          if (key === `metadata-fix:job:${userId}`) {
            return JSON.stringify({
              jobId: 'test-job-complete',
              status: 'running',
              total: 1,
              processed: 0,
              fixed: 0,
              failed: 0,
            });
          }
          return null;
        });
        vi.mocked(redis.set).mockResolvedValue('OK');

        // Mock successful fix
        const artistWithMetadata = createMockArtistWithMetadata();
        mockLidarr.getArtist.mockResolvedValue(artistWithMetadata);
        mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
        mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

        await testableService.executeBatchFix(userId, mockLidarr as unknown as LidarrService, artists);

        // Verify final status is completed
        const setCalls = vi.mocked(redis.set).mock.calls;
        const lastCall = setCalls[setCalls.length - 1];
        const lastData = JSON.parse(lastCall[1] as string) as JobStatus;
        
        expect(lastData.status).toBe('completed');
        expect(lastData.jobId).toBe('test-job-complete');
        expect(lastData.processed).toBe(1);
        expect(lastData.total).toBe(1);
        expect(lastData.fixed).toBe(1); // Artist had all metadata, so fix succeeds
      });

      it('should continue processing even if Redis fails during progress update', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
        ];

        vi.mocked(redis.get).mockImplementation(async (key: string) => {
          if (key === `metadata-fix:job:${userId}`) {
            return JSON.stringify({
              jobId: 'test-job-redis-fail',
              status: 'running',
              total: 1,
              processed: 0,
              fixed: 0,
              failed: 0,
            });
          }
          if (key === `metadata-fix:cancel:${userId}`) {
            // Simulate Redis failure when checking cancel flag
            throw new Error('Redis connection lost');
          }
          return null;
        });
        vi.mocked(redis.set).mockResolvedValue('OK');

        // Mock successful fix
        const artistWithMetadata = createMockArtistWithMetadata();
        mockLidarr.getArtist.mockResolvedValue(artistWithMetadata);
        mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
        mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

        // Should NOT throw - Redis failure is caught and logged
        await expect(
          testableService.executeBatchFix(userId, mockLidarr as unknown as LidarrService, artists)
        ).resolves.not.toThrow();

        // Should still have processed the artist
        expect(mockLidarr.refreshArtist).toHaveBeenCalledWith(1);
      });

      it('should cache jobId locally instead of repeated Redis calls', async () => {
        const userId = 1;
        const artists: ArtistToFix[] = [
          { id: 1, foreignArtistId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', artistName: 'Artist 1' },
          { id: 2, foreignArtistId: 'b2c3d4e5-f6a7-8901-bcde-f12345678901', artistName: 'Artist 2' },
        ];

        let getJobStatusCalls = 0;
        vi.mocked(redis.get).mockImplementation(async (key: string) => {
          if (key === `metadata-fix:job:${userId}`) {
            getJobStatusCalls++;
            return JSON.stringify({
              jobId: 'cached-job-id',
              status: 'running',
              total: 2,
              processed: 0,
              fixed: 0,
              failed: 0,
            });
          }
          return null;
        });
        vi.mocked(redis.set).mockResolvedValue('OK');

        const artistWithMetadata = createMockArtistWithMetadata();
        mockLidarr.getArtist.mockResolvedValue(artistWithMetadata);
        mockLidarr.refreshArtist.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'queued' });
        mockLidarr.waitForCommand.mockResolvedValue({ id: 100, name: 'RefreshArtist', status: 'completed' });

        await testableService.executeBatchFix(userId, mockLidarr as unknown as LidarrService, artists);

        // Should only call getJobStatus once at the start to cache the jobId
        // (plus cancel key checks which are separate)
        expect(getJobStatusCalls).toBe(1);
        
        // Verify all status updates use the cached jobId
        const setCalls = vi.mocked(redis.set).mock.calls.filter(call => 
          (call[0] as string).includes('metadata-fix:job:')
        );
        for (const call of setCalls) {
          const data = JSON.parse(call[1] as string) as JobStatus;
          expect(data.jobId).toBe('cached-job-id');
        }
      });
    });
  });
});
