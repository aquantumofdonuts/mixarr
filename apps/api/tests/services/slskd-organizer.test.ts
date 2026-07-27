import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// Create mock functions that persist across test resets
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRename = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);
const mockRmdir = vi.fn().mockResolvedValue(undefined);
const mockStat = vi.fn().mockResolvedValue({ isFile: () => true, size: 1000 });
const mockCopyFile = vi.fn().mockResolvedValue(undefined);
const mockUnlink = vi.fn().mockResolvedValue(undefined);

// Mock the database
vi.mock('../../src/lib/db.js', () => ({
  prisma: {
    slskdDownload: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

// Mock fs with persistent references
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      mkdir: mockMkdir,
      rename: mockRename,
      readdir: mockReaddir,
      rmdir: mockRmdir,
      stat: mockStat,
      copyFile: mockCopyFile,
      unlink: mockUnlink,
    },
  };
});

describe('SlskdOrganizerService', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create service with config', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      expect(service).toBeDefined();
    });
  });

  describe('determineDestination', () => {
    it('should build correct path from metadata and download record', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        { artist: 'Pink Floyd', album: 'The Wall', year: 1979, trackNumber: 1, title: 'In The Flesh' },
        { artistName: 'Pink Floyd', albumName: 'The Wall', albumYear: 1979 },
        '01 - In The Flesh.flac'
      );

      expect(result).toContain('/data/plex/music');
      expect(result).toContain('Pink Floyd');
      expect(result).toContain('The Wall');
      expect(result).toContain('1979');
      expect(result).toContain('.flac');
    });

    it('should use download record when metadata missing', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        {}, // No metadata
        { artistName: 'Radiohead', albumName: 'Kid A', albumYear: 2000 },
        'track.flac'
      );

      expect(result).toContain('Radiohead');
      expect(result).toContain('Kid A');
      expect(result).toContain('2000');
    });

    it('should sanitize filesystem-unsafe characters', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const result = service.determineDestination(
        { artist: 'AC/DC', album: 'Back In Black: Remastered' },
        { artistName: 'AC/DC', albumName: 'Back In Black: Remastered', albumYear: 1980 },
        '01 - Hells Bells.flac'
      );

      // Should not contain / in artist name or : in album name
      expect(result).not.toMatch(/AC\/DC/);
      expect(result).not.toContain('Black: ');
    });
  });

  describe('organizeFile', () => {
    it('should move file to destination and update database', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      const { prisma } = await import('../../src/lib/db.js');
      
      const mockDownload = {
        id: 1,
        artistName: 'Pink Floyd',
        albumName: 'DSOTM',
        albumYear: 1973,
        downloadPath: '/data/slskd/downloads/user1/Pink Floyd - DSOTM/01 - Breathe.flac',
        filename: '01 - Breathe.flac',
      };

      (prisma.slskdDownload.findUnique as any).mockResolvedValue(mockDownload);
      (prisma.slskdDownload.update as any).mockResolvedValue({ ...mockDownload, status: 'completed' });

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      const destination = await service.organizeFile(1);

      expect(destination).toContain('/data/plex/music');
      expect(destination).toContain('Pink Floyd');
      expect(mockMkdir).toHaveBeenCalled();
      expect(mockRename).toHaveBeenCalled();
      expect(prisma.slskdDownload.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({
            status: 'completed',
            finalPath: expect.any(String),
          }),
        })
      );
    });

    it('should throw if download not found', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      const { prisma } = await import('../../src/lib/db.js');
      
      (prisma.slskdDownload.findUnique as any).mockResolvedValue(null);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      await expect(service.organizeFile(999)).rejects.toThrow();
    });
  });

  describe('cleanupEmptyDirs', () => {
    it('should remove empty directories recursively', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      mockReaddir.mockResolvedValue([]);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      await service.cleanupEmptyDirs('/data/slskd/downloads/user/artist/album');

      expect(mockRmdir).toHaveBeenCalled();
    });

    it('should not fail if directory is not empty', async () => {
      const { SlskdOrganizerService } = await import('../../src/services/slskd-organizer.js');
      
      mockReaddir.mockResolvedValue(['file.flac']);

      const service = new SlskdOrganizerService({
        downloadDir: '/data/slskd/downloads',
        musicLibraryDir: '/data/plex/music',
      });

      // Should not throw
      await expect(service.cleanupEmptyDirs('/data/slskd/downloads/user')).resolves.not.toThrow();
    });
  });
});

describe('moveFile', () => {
  beforeEach(() => {
    vi.resetModules();
    mockRename.mockReset();
    mockCopyFile.mockReset();
    mockUnlink.mockReset();
    mockStat.mockReset();
    mockMkdir.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fallback to copy+delete on EXDEV error', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');
    
    // Mock rename to throw EXDEV
    mockRename.mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    );
    mockCopyFile.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 1000 } as any);
    mockMkdir.mockResolvedValue(undefined);
    
    await moveFile('/mnt/downloads/song.mp3', '/mnt/music/artist/song.mp3');
    
    expect(mockRename).toHaveBeenCalled();
    expect(mockCopyFile).toHaveBeenCalledWith('/mnt/downloads/song.mp3', '/mnt/music/artist/song.mp3');
    expect(mockUnlink).toHaveBeenCalledWith('/mnt/downloads/song.mp3');
  });

  it('should not delete source if copy fails', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');
    
    mockRename.mockRejectedValueOnce(
      Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    );
    mockCopyFile.mockRejectedValueOnce(new Error('Disk full'));
    mockMkdir.mockResolvedValue(undefined);
    
    await expect(moveFile('/src/file.mp3', '/dest/file.mp3')).rejects.toThrow('Disk full');
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('should use rename for same-device moves', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');
    
    mockRename.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    
    await moveFile('/music/temp/song.mp3', '/music/library/song.mp3');
    
    expect(mockRename).toHaveBeenCalled();
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it('should verify destination exists before deleting source', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');
    
    mockRename.mockRejectedValueOnce(
      Object.assign(new Error('EXDEV'), { code: 'EXDEV' })
    );
    mockCopyFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 0 } as any); // Empty file - copy failed silently
    mockMkdir.mockResolvedValue(undefined);
    
    await expect(moveFile('/src/file.mp3', '/dest/file.mp3')).rejects.toThrow('Copy verification failed');
    expect(mockUnlink).not.toHaveBeenCalled();
  });

  it('should rethrow non-EXDEV errors', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');

    mockRename.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
    );
    mockMkdir.mockResolvedValue(undefined);

    await expect(moveFile('/nonexistent/file.mp3', '/dest/file.mp3')).rejects.toThrow('ENOENT');
    expect(mockCopyFile).not.toHaveBeenCalled();
  });

  it('should not throw when source cleanup fails after a successful copy', async () => {
    const { moveFile } = await import('../../src/services/slskd-organizer.js');

    mockRename.mockRejectedValueOnce(
      Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' })
    );
    mockCopyFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 1000 } as any);
    mockUnlink.mockRejectedValueOnce(
      Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    );
    mockMkdir.mockResolvedValue(undefined);

    // The copy into the library already succeeded — a permissions failure
    // cleaning up the source (e.g. a downloads volume owned by a different
    // user) should not fail the whole operation.
    await expect(moveFile('/src/file.mp3', '/dest/file.mp3')).resolves.toBeUndefined();
    expect(mockCopyFile).toHaveBeenCalledWith('/src/file.mp3', '/dest/file.mp3');
  });
});

describe('Path Security', () => {
  describe('sanitizePath', () => {
    it('should normalize Unicode to NFC form', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      // "é" can be composed (U+00E9) or decomposed (e + U+0301)
      const decomposed = 'cafe\u0301'; // café with combining accent
      const result = sanitizePath(decomposed);
      expect(result).toBe('café'); // normalized to composed form
    });

    it('should convert fullwidth characters to ASCII equivalents', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      // Fullwidth solidus U+FF0F looks like / but isn't detected by simple checks
      const malicious = 'test\uFF0Ffile';
      const result = sanitizePath(malicious);
      expect(result).toContain('/'); // Should convert to real slash
    });

    it('should remove null bytes', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      const withNull = 'file\0name.mp3';
      const result = sanitizePath(withNull);
      expect(result).not.toContain('\0');
      expect(result).toBe('filename.mp3');
    });

    it('should handle fullwidth backslash', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      const withFullwidthBackslash = 'test\uFF3Cfile';
      const result = sanitizePath(withFullwidthBackslash);
      expect(result).toContain('\\');
    });

    it('should handle one dot leader Unicode', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      const withDotLeader = 'file\u2024mp3';
      const result = sanitizePath(withDotLeader);
      expect(result).toContain('.');
    });

    it('should handle two dot leader Unicode', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      const withTwoDotLeader = '\u2025/etc/passwd';
      const result = sanitizePath(withTwoDotLeader);
      expect(result).toContain('..');
    });

    it('should handle division slash Unicode', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      // Division slash U+2215 looks like / but isn't detected by simple checks
      const withDivisionSlash = 'test\u2215file';
      const result = sanitizePath(withDivisionSlash);
      expect(result).toContain('/');
    });

    it('should handle fraction slash Unicode', async () => {
      const { sanitizePath } = await import('../../src/services/slskd-organizer.js');
      
      // Fraction slash U+2044 looks like / but isn't detected by simple checks
      const withFractionSlash = 'test\u2044file';
      const result = sanitizePath(withFractionSlash);
      expect(result).toContain('/');
    });
  });

  describe('isPathSafe', () => {
    it('should reject path traversal attempts', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      expect(isPathSafe('../etc/passwd', '/music')).toBe(false);
      expect(isPathSafe('artist/../../../etc/passwd', '/music')).toBe(false);
    });

    it('should reject absolute paths', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      expect(isPathSafe('/etc/passwd', '/music')).toBe(false);
    });

    it('should accept safe paths', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      expect(isPathSafe('Artist Name/Album (2024)/01 - Track.mp3', '/music')).toBe(true);
      expect(isPathSafe('Café Del Mar/song.flac', '/music')).toBe(true);
    });

    it('should reject paths that escape after Unicode normalization', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      // Fullwidth periods and slashes that could bypass naive checks
      const trickySeparator = '..\uFF0Fsecret'; // .. + fullwidth /
      expect(isPathSafe(trickySeparator, '/music')).toBe(false);
    });

    it('should reject paths with two dot leader escape attempts', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      // Two dot leader + slash could bypass naive checks
      const trickyDots = '\u2025/etc/passwd';
      expect(isPathSafe(trickyDots, '/music')).toBe(false);
    });

    it('should allow paths that stay within base directory', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      expect(isPathSafe('subdir/file.mp3', '/music')).toBe(true);
      expect(isPathSafe('./subdir/file.mp3', '/music')).toBe(true);
    });

    it('should reject paths with embedded null bytes', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      // Null byte could cause truncation in some systems
      const withNull = 'safe\0/../../../etc/passwd';
      expect(isPathSafe(withNull, '/music')).toBe(false);
    });

    it('should reject paths with division slash escape attempts', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      // Division slash U+2215 + .. could bypass naive checks
      const trickyDivisionSlash = '..\u2215etc\u2215passwd';
      expect(isPathSafe(trickyDivisionSlash, '/music')).toBe(false);
    });

    it('should reject paths with fraction slash escape attempts', async () => {
      const { isPathSafe } = await import('../../src/services/slskd-organizer.js');
      
      // Fraction slash U+2044 + .. could bypass naive checks
      const trickyFractionSlash = '..\u2044etc\u2044passwd';
      expect(isPathSafe(trickyFractionSlash, '/music')).toBe(false);
    });
  });
});
