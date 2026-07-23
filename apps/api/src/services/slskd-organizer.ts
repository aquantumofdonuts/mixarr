import { promises as fs } from 'fs';
import path, { normalize, resolve, relative, isAbsolute, dirname } from 'path';
import { prisma } from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { parseFilename, buildTargetPath } from '../utils/slskd-parser.js';
import { addLogEntry } from '../routes/logs.js';

const logger = createLogger('SlskdOrganizer');

/**
 * Sanitize a path by normalizing Unicode and replacing dangerous characters.
 * This prevents Unicode bypass attacks where malicious peers send filenames with
 * characters that look like `/` or `..` but aren't detected by simple checks.
 */
export function sanitizePath(input: string): string {
  // Normalize Unicode to NFC form first
  let normalized = input.normalize('NFC');
  
  // Replace fullwidth characters that could be used for bypass
  normalized = normalized
    .replace(/\uff0f/g, '/') // fullwidth solidus
    .replace(/\uff3c/g, '\\') // fullwidth backslash
    .replace(/\u2024/g, '.') // one dot leader
    .replace(/\u2025/g, '..') // two dot leader
    .replace(/\u2215/g, '/') // division slash
    .replace(/\u2044/g, '/'); // fraction slash
  
  // Remove any null bytes
  normalized = normalized.replace(/\0/g, '');
  
  // Path normalize to resolve . and .. 
  return normalize(normalized);
}

/**
 * Check if a user-provided path is safe (doesn't escape baseDir).
 * This protects against path traversal attacks from malicious Soulseek peers.
 */
export function isPathSafe(userPath: string, baseDir: string): boolean {
  // Sanitize first
  const sanitized = sanitizePath(userPath);
  
  // Reject absolute paths
  if (isAbsolute(sanitized)) {
    return false;
  }
  
  // Resolve to absolute path under base
  const fullPath = resolve(baseDir, sanitized);
  
  // Check the resolved path is actually under baseDir
  const relativePath = relative(baseDir, fullPath);
  
  // If relative path starts with .. or is absolute, it's escaping
  return !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

/**
 * Move a file, handling cross-device moves (EXDEV) with copy+delete fallback.
 * When the source and destination are on different filesystems (e.g., Docker volumes,
 * NFS mounts, different partitions), fs.rename() throws EXDEV. This function detects
 * that error and falls back to copy+delete.
 */
export async function moveFile(src: string, dest: string): Promise<void> {
  // Ensure destination directory exists
  await fs.mkdir(dirname(dest), { recursive: true });
  
  try {
    await fs.rename(src, dest);
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'EXDEV') {
      // Cross-device move: copy then delete
      await fs.copyFile(src, dest);
      // Verify copy succeeded before deleting source
      const destStats = await fs.stat(dest);
      if (destStats.size > 0) {
        // Cleanup is best-effort: the copy into the library already
        // succeeded, which is the part that actually matters. slskd's
        // downloads volume can be owned by a different user (e.g. slskd
        // running as root) than this container, so unlink can legitimately
        // fail on permissions — that shouldn't fail the whole organize
        // operation and re-copy the file on every future poll.
        try {
          await fs.unlink(src);
        } catch (unlinkErr) {
          logger.warn('Copied file to library but failed to remove source (leftover in downloads dir)', {
            src,
            dest,
            error: unlinkErr instanceof Error ? unlinkErr.message : String(unlinkErr),
          });
        }
      } else {
        throw new Error('Copy verification failed: destination file is empty');
      }
    } else {
      throw err;
    }
  }
}

export interface OrganizerConfig {
  downloadDir: string;
  musicLibraryDir: string;
}

export interface AudioMetadata {
  artist?: string;
  album?: string;
  year?: number;
  trackNumber?: number;
  title?: string;
}

export class SlskdOrganizerService {
  constructor(private config: OrganizerConfig) {}

  /**
   * Parse audio metadata from file
   * For MVP, extracts from filename. Could be enhanced with music-metadata library.
   */
  parseAudioMetadata(filePath: string): AudioMetadata {
    const filename = path.basename(filePath);
    const parsed = parseFilename(filename);
    
    return {
      trackNumber: parsed.trackNumber,
      title: parsed.title,
    };
  }

  /**
   * Determine destination path for a file
   * Combines metadata with download record data
   */
  determineDestination(
    metadata: AudioMetadata,
    downloadRecord: { artistName: string; albumName?: string | null; albumYear?: number | null },
    filename: string
  ): string {
    return buildTargetPath(
      this.config.musicLibraryDir,
      metadata.artist || downloadRecord.artistName,
      metadata.album || downloadRecord.albumName || undefined,
      metadata.year || downloadRecord.albumYear || undefined,
      filename
    );
  }

  /**
   * Organize a downloaded file - move to music library with proper naming
   */
  async organizeFile(downloadId: number): Promise<string> {
    const download = await prisma.slskdDownload.findUnique({
      where: { id: downloadId },
    });

    if (!download) {
      throw new Error(`Download ${downloadId} not found`);
    }

    if (!download.downloadPath) {
      throw new Error(`Download ${downloadId} has no download path`);
    }

    // Sanitize inputs BEFORE building the destination path to prevent Unicode bypass attacks
    const safeArtist = sanitizePath(download.artistName);
    const safeFilename = sanitizePath(path.basename(download.downloadPath));
    const safeAlbumName = download.albumName ? sanitizePath(download.albumName) : null;

    // Reject if sanitized inputs still contain path separators (after Unicode normalization)
    if (safeArtist.includes('/') || safeArtist.includes('\\')) {
      throw new Error(`Invalid characters in artist name: potential path traversal detected for download ${downloadId}`);
    }
    if (safeFilename.includes('/') || safeFilename.includes('\\')) {
      throw new Error(`Invalid characters in filename: potential path traversal detected for download ${downloadId}`);
    }
    if (safeAlbumName && (safeAlbumName.includes('/') || safeAlbumName.includes('\\'))) {
      throw new Error(`Invalid characters in album name: potential path traversal detected for download ${downloadId}`);
    }

    const metadata = this.parseAudioMetadata(download.downloadPath);
    const destination = this.determineDestination(
      metadata,
      {
        artistName: safeArtist,
        albumName: safeAlbumName,
        albumYear: download.albumYear,
      },
      safeFilename
    );

    // Validate the destination path is safe (doesn't escape music library)
    const relativePath = path.relative(this.config.musicLibraryDir, destination);
    if (!isPathSafe(relativePath, this.config.musicLibraryDir)) {
      throw new Error(`Invalid destination path: potential path traversal detected for download ${downloadId}`);
    }

    // Move file (handles cross-device moves with copy+delete fallback)
    await moveFile(download.downloadPath, destination);

    // Update database
    await prisma.slskdDownload.update({
      where: { id: downloadId },
      data: {
        status: 'completed',
        finalPath: destination,
        completedAt: new Date(),
      },
    });

    logger.info('Organized slskd download', { 
      downloadId, 
      artist: download.artistName,
      album: download.albumName,
      destination,
    });

    // Add activity log entry
    await addLogEntry('info', 'slskd', `Downloaded and organized: ${download.artistName}${download.albumName ? ` - ${download.albumName}` : ''}`, {
      downloadId,
      artist: download.artistName,
      album: download.albumName,
      year: download.albumYear,
      filename: path.basename(destination),
      destination,
      source: download.username,
    });

    // Cleanup empty source directories
    const sourceDir = path.dirname(download.downloadPath);
    await this.cleanupEmptyDirs(sourceDir);

    return destination;
  }

  /**
   * Recursively remove empty directories up to downloadDir
   */
  async cleanupEmptyDirs(dirPath: string): Promise<void> {
    // Don't go above the download directory
    if (dirPath === this.config.downloadDir || !dirPath.startsWith(this.config.downloadDir)) {
      return;
    }

    try {
      const files = await fs.readdir(dirPath);
      if (files.length === 0) {
        await fs.rmdir(dirPath);
        logger.debug('Removed empty directory', { dirPath });
        // Recursively clean parent
        await this.cleanupEmptyDirs(path.dirname(dirPath));
      }
    } catch {
      // Directory doesn't exist or not empty - that's OK
    }
  }
}
