import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock functions at module level
const mockGetDownloads = vi.fn();
const mockOrganizeFile = vi.fn();
const mockConnectionFindFirst = vi.fn();
const mockDownloadFindMany = vi.fn();
const mockDownloadUpdate = vi.fn();
const mockDownloadUpdateMany = vi.fn();

// Mock the database
vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    connection: {
      findFirst: mockConnectionFindFirst,
    },
    slskdDownload: {
      findMany: mockDownloadFindMany,
      update: mockDownloadUpdate,
      updateMany: mockDownloadUpdateMany,
    },
  },
}));

// Mock SlskdService as a class
vi.mock('../../src/services/slskd.js', () => ({
  SlskdService: class MockSlskdService {
    getDownloads = mockGetDownloads;
  },
}));

// Mock SlskdOrganizerService as a class, but keep real isPathSafe for path validation tests
vi.mock('../../src/services/slskd-organizer.js', async () => {
  const actual = await vi.importActual('../../src/services/slskd-organizer.js');
  return {
    ...(actual as any),
    SlskdOrganizerService: class MockSlskdOrganizerService {
      organizeFile = mockOrganizeFile;
    },
  };
});

// Mock logger to avoid console noise
vi.mock('../../src/lib/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SlskdPollJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('pollSlskdDownloads', () => {
    it('should skip if no slskd connection configured', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue(null);

      await pollSlskdDownloads();

      expect(mockDownloadFindMany).not.toHaveBeenCalled();
    });

    it('should fetch pending downloads from database', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([]);
      mockGetDownloads.mockResolvedValue([]);

      await pollSlskdDownloads();

      expect(mockDownloadFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ['pending', 'downloading'] } },
        })
      );
    });

    it('should update status when download is in progress', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'InProgress' }],
          }],
        },
      ]);

      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockDownloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'downloading' }),
        })
      );
    });

    it('should trigger organization when download completes', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Completed, Succeeded' }],
          }],
        },
      ]);

      // Mock atomic updateMany to succeed (we win the race)
      mockDownloadUpdateMany.mockResolvedValue({ count: 1 });

      mockOrganizeFile.mockResolvedValue('/data/plex/music/Artist/Album/track.flac');
      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockOrganizeFile).toHaveBeenCalledWith(1);
    });

    it('should skip organization if race condition lost', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Completed, Succeeded' }],
          }],
        },
      ]);

      // Mock atomic updateMany to return 0 (lost the race)
      mockDownloadUpdateMany.mockResolvedValue({ count: 0 });

      await pollSlskdDownloads();

      // Should not call organizeFile if we lost the race
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });

    it('should mark download as failed on error', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'user1',
          directories: [{
            directory: 'Album',
            files: [{ filename: '/music/track.flac', state: 'Errored' }],
          }],
        },
      ]);

      mockDownloadUpdate.mockResolvedValue({});

      await pollSlskdDownloads();

      expect(mockDownloadUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ status: 'failed' }),
        })
      );
    });

    it('should handle slskd connection errors gracefully', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'user1', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockRejectedValue(new Error('Connection refused'));

      // Should not throw
      await expect(pollSlskdDownloads()).resolves.not.toThrow();
    });

    it('ignores username when constructing the download path (no username-based traversal possible)', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: '../../etc', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: '../../etc',
          directories: [{
            directory: 'cron.d',
            files: [{ filename: '/music/track.flac', state: 'Completed, Succeeded' }],
          }],
        },
      ]);

      mockDownloadUpdateMany.mockResolvedValue({ count: 1 });

      await pollSlskdDownloads();

      // slskd never namespaces on-disk downloads by username, so username is not
      // part of the constructed path at all — a malicious username can't escape
      // downloadDir because it's never used to build one.
      expect(mockDownloadUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            downloadPath: expect.stringContaining('cron.d'),
          }),
        })
      );
      const downloadPath = mockDownloadUpdateMany.mock.calls[0][0].data.downloadPath;
      expect(downloadPath).not.toContain('etc');
      expect(downloadPath).not.toContain('..');
    });

    it('neutralizes traversal segments in directory by keeping only the leaf folder name', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'normaluser', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'normaluser',
          directories: [{
            directory: '../../../etc/cron.d',
            files: [{ filename: '/music/track.flac', state: 'Completed, Succeeded' }],
          }],
        },
      ]);

      mockDownloadUpdateMany.mockResolvedValue({ count: 1 });

      await pollSlskdDownloads();

      // Only the final path segment ("cron.d") survives — the ".." components
      // are discarded during leaf extraction, so the resulting path is genuinely
      // safe rather than merely detected-and-rejected.
      const downloadPath = mockDownloadUpdateMany.mock.calls[0][0].data.downloadPath;
      expect(downloadPath).toContain('cron.d');
      expect(downloadPath).not.toContain('etc');
      expect(downloadPath).not.toContain('..');
    });

    it('still rejects a directory whose leaf segment is itself ".."', async () => {
      const { pollSlskdDownloads } = await import('../../src/jobs/slskd-poll.js');

      mockConnectionFindFirst.mockResolvedValue({
        id: 'conn-1',
        type: 'slskd',
        enabled: true,
        config: {
          url: 'http://localhost:5030',
          apiKey: 'test-key',
          downloadDir: '/data/slskd/downloads',
          musicLibraryDir: '/data/plex/music',
        },
      });

      mockDownloadFindMany.mockResolvedValue([
        { id: 1, username: 'normaluser', filename: '/music/track.flac', status: 'pending' },
      ]);

      mockGetDownloads.mockResolvedValue([
        {
          username: 'normaluser',
          // leaf segment after splitting is literally ".." — still escapes downloadDir
          directory: 'foo/..',
          directories: [{
            directory: 'foo/..',
            files: [{ filename: '/music/track.flac', state: 'Completed, Succeeded' }],
          }],
        },
      ]);

      mockDownloadUpdateMany.mockResolvedValue({ count: 0 });

      await pollSlskdDownloads();

      expect(mockDownloadUpdateMany).not.toHaveBeenCalled();
      expect(mockOrganizeFile).not.toHaveBeenCalled();
    });
  });
});
