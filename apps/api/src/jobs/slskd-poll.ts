import path from 'path';
import { prisma } from '../lib/db.js';
import { SlskdService } from '../services/slskd.js';
import { SlskdOrganizerService, isPathSafe } from '../services/slskd-organizer.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('SlskdPoll');

interface SlskdConnectionConfig {
  url: string;
  apiKey: string;
  downloadDir?: string;
  musicLibraryDir?: string;
}

/**
 * Poll slskd for download status updates and trigger organization
 */
export async function pollSlskdDownloads(): Promise<void> {
  // Get active slskd connection
  const connection = await prisma.connection.findFirst({
    where: { type: 'slskd', isActive: true },
  });

  if (!connection) {
    return; // No slskd configured
  }

  const config = connection.config as unknown as SlskdConnectionConfig;
  const downloadDir = config.downloadDir || '/data/slskd/downloads';
  const musicLibraryDir = config.musicLibraryDir || '/data/plex/music';

  const slskdService = new SlskdService({ url: config.url, apiKey: config.apiKey });
  const organizer = new SlskdOrganizerService({ downloadDir, musicLibraryDir });

  try {
    // Get pending downloads from our database
    const pendingDownloads = await prisma.slskdDownload.findMany({
      where: { status: { in: ['pending', 'downloading'] } },
    });

    if (pendingDownloads.length === 0) {
      return; // Nothing to check
    }

    log.debug('Polling slskd for download status', { count: pendingDownloads.length });

    // Get current downloads from slskd
    const slskdDownloads = await slskdService.getDownloads();

    // Build lookup by username + filename (basename for matching)
    const slskdLookup = new Map<string, { state: string; directory: string }>();
    for (const userDownload of slskdDownloads) {
      for (const dir of userDownload.directories) {
        for (const file of dir.files) {
          const basename = path.basename(file.filename);
          const key = `${userDownload.username}:${basename}`;
          slskdLookup.set(key, {
            state: file.state || 'None',
            directory: dir.directory,
          });
        }
      }
    }

    // Update each pending download
    for (const download of pendingDownloads) {
      if (!download.filename) {
        log.warn('Download has no filename', { downloadId: download.id });
        continue;
      }
      const basename = path.basename(download.filename);
      const key = `${download.username}:${basename}`;
      const slskdStatus = slskdLookup.get(key);

      if (!slskdStatus) {
        // Not found in slskd - might not have started yet or completed and cleared
        continue;
      }

      // slskd's real transfer states are compound strings, not the bare
      // words this used to check for — confirmed live 2026-07-21:
      // "Completed, Succeeded", "Completed, Errored", "Completed, TimedOut",
      // "Completed, Aborted", "Completed, Rejected", "InProgress",
      // "Queued, Remotely". A strict `state === 'Completed'` check never
      // matched anything: 2,439 real successful downloads sat undetected,
      // never organized into the library, because none of them were
      // literally the string "Completed" on its own.
      const isSuccess = slskdStatus.state === 'Completed, Succeeded';
      const isFailed = [
        'Completed, Errored',
        'Completed, TimedOut',
        'Completed, Aborted',
        'Completed, Rejected',
        'Errored',
        'Cancelled',
      ].includes(slskdStatus.state);

      if (isSuccess) {
        // Validate the constructed path stays within downloadDir (path traversal protection)
        const relativePath = `${download.username}/${slskdStatus.directory}/${basename}`;
        if (!isPathSafe(relativePath, downloadDir)) {
          log.warn('Unsafe download path detected — possible path traversal', {
            downloadId: download.id,
            username: download.username,
            directory: slskdStatus.directory,
          });
          continue;
        }

        // Download finished - update path and trigger organization
        const downloadPath = path.resolve(downloadDir, relativePath);

        // Atomic status update - only update if still in expected state
        // This prevents race conditions where both webhook and poll job try to organize
        // Concurrency model: Both webhook and poll job can detect completion, but only one
        // succeeds in transitioning to 'organizing'. Include 'organizing' to retry stuck downloads.
        const updated = await prisma.slskdDownload.updateMany({
          where: {
            id: download.id,
            status: { in: ['pending', 'downloading', 'organizing'] },
          },
          data: {
            status: 'organizing',
            downloadPath,
          },
        });

        // Check if we won the race
        if (updated.count === 0) {
          // Another process already started organizing this download
          log.debug('Download already being organized by another process', { downloadId: download.id });
          continue;
        }

        // We won the race - proceed with organization
        try {
          await organizer.organizeFile(download.id);
          log.info('Organized completed slskd download', { downloadId: download.id });
        } catch (error) {
          log.error('Failed to organize download', { 
            downloadId: download.id, 
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          await prisma.slskdDownload.update({
            where: { id: download.id },
            data: { status: 'failed', error: String(error) },
          });
        }
      } else if (slskdStatus.state === 'InProgress') {
        // Still downloading
        if (download.status !== 'downloading') {
          await prisma.slskdDownload.update({
            where: { id: download.id },
            data: { status: 'downloading' },
          });
        }
      } else if (isFailed) {
        await prisma.slskdDownload.update({
          where: { id: download.id },
          data: { status: 'failed', error: slskdStatus.state },
        });
        log.warn('slskd download failed', { downloadId: download.id, state: slskdStatus.state });
      }
    }
  } catch (error) {
    log.error('slskd poll job failed', { error });
  }
}
