/**
 * MetadataFixService
 * 
 * Fixes missing metadata for artists in Lidarr by:
 * 1. Warming the SkyHook cache (to ensure metadata is available)
 * 2. Triggering a refresh in Lidarr
 * 3. Reporting what was fixed and what's still missing
 * 
 * This service is useful for artists that were added before the cache
 * warmer was implemented, or where the initial add failed to get metadata.
 * 
 * Batch Operations:
 * - startBatchFix: Creates job state in Redis, returns immediately
 * - getJobStatus: Returns current job state from Redis
 * - cancelJob: Sets cancel flag in Redis
 * - executeBatchFix: The actual loop that processes artists
 */

import { createLogger } from '../lib/logger.js';
import { redis } from '../lib/redis.js';
import type { SkyHookCacheWarmer } from './skyhook-cache-warmer.js';
import type { LidarrService, LidarrArtist, LidarrCommand } from './lidarr.js';

const log = createLogger('MetadataFix');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface FixResult {
  success: boolean;
  artist: {
    id: number;
    name: string;
    hasPoster: boolean;
    hasOverview: boolean;
    hasGenres: boolean;
  };
  fixed: string[];
  stillMissing: string[];
}

export interface JobInfo {
  jobId: string;
  total: number;
  estimatedMinutes: number;
}

export interface JobStatus {
  jobId: string;
  status: 'running' | 'completed' | 'cancelled';
  total: number;
  processed: number;
  fixed: number;
  failed: number;
  currentArtist?: string;
}

export interface ArtistToFix {
  id: number;
  foreignArtistId: string;
  artistName?: string;
}

interface MetadataState {
  hasPoster: boolean;
  hasOverview: boolean;
  hasGenres: boolean;
}

export class MetadataFixService {
  private warmer: SkyHookCacheWarmer;

  constructor(warmer: SkyHookCacheWarmer) {
    this.warmer = warmer;
  }

  /**
   * Fix missing metadata for a single artist.
   * 
   * @param lidarr - The Lidarr service instance to use
   * @param artistId - The Lidarr artist ID (must be a positive integer)
   * @param mbid - The MusicBrainz ID for the artist
   * @returns FixResult with details of what was fixed
   * @throws Error if inputs are invalid, artist not found, or Lidarr operations fail
   */
  async fixArtist(
    lidarr: LidarrService,
    artistId: number,
    mbid: string
  ): Promise<FixResult> {
    // Validate inputs
    this.validateArtistId(artistId);
    this.validateMbid(mbid);

    log.info(`Starting metadata fix for artist ${artistId} (MBID: ${mbid})`);

    // Fetch current artist state
    const artistBefore = await this.fetchArtist(lidarr, artistId);
    const stateBefore = this.extractMetadataState(artistBefore);

    log.debug(`Artist "${artistBefore.artistName}" current state:`, stateBefore);

    // Warm the SkyHook cache
    const warmResult = await this.warmer.warmArtist(mbid);
    const cacheWarmed = warmResult.success;
    
    if (!cacheWarmed) {
      log.warn(`Cache warm failed for ${mbid}: ${warmResult.error}`);
    } else {
      log.debug(`Cache warmed successfully for ${mbid}`);
    }

    // Trigger Lidarr refresh
    await this.refreshArtistWithTimeout(lidarr, artistId);

    // Fetch updated artist state
    const artistAfter = await this.fetchArtist(lidarr, artistId);
    const stateAfter = this.extractMetadataState(artistAfter);

    log.debug(`Artist "${artistAfter.artistName}" new state:`, stateAfter);

    // Determine what changed
    const fixed = this.determineFixed(stateBefore, stateAfter);
    const stillMissing = this.determineStillMissing(stateAfter);

    // Success is true only if cache warmed AND no missing metadata remains
    const success = cacheWarmed && stillMissing.length === 0;

    if (fixed.length > 0) {
      log.info(`Fixed metadata for "${artistAfter.artistName}": ${fixed.join(', ')}`);
    }
    if (stillMissing.length > 0) {
      log.warn(`Still missing for "${artistAfter.artistName}": ${stillMissing.join(', ')}`);
    }

    return {
      success,
      artist: {
        id: artistAfter.id,
        name: artistAfter.artistName,
        hasPoster: stateAfter.hasPoster,
        hasOverview: stateAfter.hasOverview,
        hasGenres: stateAfter.hasGenres,
      },
      fixed,
      stillMissing,
    };
  }

  private validateArtistId(artistId: number): void {
    if (!Number.isInteger(artistId) || artistId <= 0) {
      throw new Error('Artist ID must be a positive integer');
    }
  }

  private validateMbid(mbid: string): void {
    if (!mbid) {
      throw new Error('MBID is required');
    }
    if (!UUID_REGEX.test(mbid)) {
      throw new Error(`Invalid MBID format: ${mbid}`);
    }
  }

  private async fetchArtist(lidarr: LidarrService, artistId: number): Promise<LidarrArtist> {
    const artist = await lidarr.getArtist(artistId);
    if (!artist) {
      throw new Error(`Artist with ID ${artistId} not found in Lidarr`);
    }
    return artist;
  }

  private extractMetadataState(artist: LidarrArtist): MetadataState {
    return {
      hasPoster: this.hasPoster(artist),
      hasOverview: this.hasOverview(artist),
      hasGenres: this.hasGenres(artist),
    };
  }

  private hasPoster(artist: LidarrArtist): boolean {
    return Boolean(
      artist.images &&
      artist.images.length > 0 &&
      artist.images.some(img => img.coverType === 'poster' && img.url)
    );
  }

  private hasOverview(artist: LidarrArtist): boolean {
    return Boolean(artist.overview && artist.overview.trim().length > 0);
  }

  private hasGenres(artist: LidarrArtist): boolean {
    return Boolean(artist.genres && artist.genres.length > 0);
  }

  private async refreshArtistWithTimeout(
    lidarr: LidarrService,
    artistId: number
  ): Promise<LidarrCommand> {
    const command = await lidarr.refreshArtist(artistId);
    log.debug(`Refresh command ${command.id} started for artist ${artistId}`);

    try {
      const result = await lidarr.waitForCommand(command.id);
      
      if (result.status === 'failed') {
        throw new Error(`Lidarr refresh command failed: ${result.message || 'Unknown error'}`);
      }
      
      if (result.status === 'aborted') {
        throw new Error('Lidarr refresh command was aborted');
      }
      
      return result;
    } catch (error) {
      // Check if it's a timeout error from waitForCommand
      if (error instanceof Error && error.message.includes('did not complete within')) {
        throw new Error('Lidarr refresh command timed out');
      }
      throw error;
    }
  }

  private determineFixed(before: MetadataState, after: MetadataState): string[] {
    const fixed: string[] = [];
    
    if (!before.hasPoster && after.hasPoster) {
      fixed.push('poster');
    }
    if (!before.hasOverview && after.hasOverview) {
      fixed.push('overview');
    }
    if (!before.hasGenres && after.hasGenres) {
      fixed.push('genres');
    }
    
    return fixed;
  }

  private determineStillMissing(state: MetadataState): string[] {
    const missing: string[] = [];
    
    if (!state.hasPoster) {
      missing.push('poster');
    }
    if (!state.hasOverview) {
      missing.push('overview');
    }
    if (!state.hasGenres) {
      missing.push('genres');
    }
    
    return missing;
  }

  // ===========================================
  // Batch Operations
  // ===========================================

  private getJobKey(userId: number): string {
    return `metadata-fix:job:${userId}`;
  }

  private getCancelKey(userId: number): string {
    return `metadata-fix:cancel:${userId}`;
  }

  /**
   * Start a batch fix operation for multiple artists.
   * Creates job state in Redis and returns immediately.
   * Uses atomic SET NX to prevent race conditions.
   * 
   * @param userId - User ID for job isolation
   * @param artists - Array of artists to fix
   * @returns Job info with ID, total, and estimated time
   * @throws Error if a job is already in progress for this user
   */
  async startBatchFix(userId: number, artists: ArtistToFix[]): Promise<JobInfo> {
    const jobKey = this.getJobKey(userId);
    
    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const total = artists.length;
    // Estimate: 1 second per artist, convert to minutes
    const estimatedMinutes = Math.ceil(total / 60);

    const initialStatus: JobStatus = {
      jobId,
      status: 'running',
      total,
      processed: 0,
      fixed: 0,
      failed: 0,
    };

    // Atomic check-and-set: only set if key doesn't exist (NX)
    // This prevents race conditions where two concurrent calls could both start jobs
    const acquired = await redis.set(jobKey, JSON.stringify(initialStatus), 'EX', 3600, 'NX');
    if (!acquired) {
      // Key already exists - check if it's a running job or a stale completed one
      const existingJob = await redis.get(jobKey);
      if (existingJob) {
        const parsed = JSON.parse(existingJob) as JobStatus;
        if (parsed.status === 'running') {
          throw new Error('Job already in progress');
        }
        // Job exists but is completed/cancelled - overwrite it
        await redis.set(jobKey, JSON.stringify(initialStatus), 'EX', 3600);
      }
    }

    log.info(`Started batch fix job ${jobId} for user ${userId} with ${total} artists`);

    return {
      jobId,
      total,
      estimatedMinutes,
    };
  }

  /**
   * Get the current job status for a user.
   * 
   * @param userId - User ID to get job status for
   * @returns Job status or null if no job exists
   */
  async getJobStatus(userId: number): Promise<JobStatus | null> {
    const jobKey = this.getJobKey(userId);
    const data = await redis.get(jobKey);
    
    if (!data) {
      return null;
    }

    return JSON.parse(data) as JobStatus;
  }

  /**
   * Request cancellation of a running job.
   * Sets a cancel flag in Redis that executeBatchFix will check.
   * 
   * @param userId - User ID whose job to cancel
   * @returns true if cancel flag was set, false if no job running
   */
  async cancelJob(userId: number): Promise<boolean> {
    const status = await this.getJobStatus(userId);
    
    if (!status || status.status !== 'running') {
      return false;
    }

    // Set cancel flag with 5 minute expiry
    const cancelKey = this.getCancelKey(userId);
    await redis.set(cancelKey, '1', 'EX', 300);

    log.info(`Cancel requested for job ${status.jobId} (user ${userId})`);

    return true;
  }

  /**
   * Execute the batch fix operation.
   * Loops through artists, fixing each one with rate limiting.
   * Checks for cancellation before each artist.
   * 
   * @param userId - User ID for job tracking
   * @param lidarr - LidarrService instance to use
   * @param artists - Array of artists to fix
   */
  async executeBatchFix(
    userId: number,
    lidarr: LidarrService,
    artists: ArtistToFix[]
  ): Promise<void> {
    const jobKey = this.getJobKey(userId);
    const cancelKey = this.getCancelKey(userId);

    // Cache jobId locally to avoid repeated Redis calls
    const initialJob = await this.getJobStatus(userId);
    const jobId = initialJob?.jobId || 'unknown';

    let processed = 0;
    let fixed = 0;
    let failed = 0;

    log.info(`Executing batch fix for user ${userId}: ${artists.length} artists`);

    // Helper to safely update Redis status
    const updateStatus = async (status: JobStatus): Promise<void> => {
      try {
        await redis.set(jobKey, JSON.stringify(status), 'EX', 3600);
      } catch (error) {
        log.warn(`Failed to update job status in Redis: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    };

    for (const artist of artists) {
      // Check for cancellation (with try/catch for Redis resiliency)
      try {
        const cancelFlag = await redis.get(cancelKey);
        if (cancelFlag === '1') {
          log.info(`Batch fix cancelled at ${processed}/${artists.length} for user ${userId}`);
          
          const cancelledStatus: JobStatus = {
            jobId,
            status: 'cancelled',
            total: artists.length,
            processed,
            fixed,
            failed,
          };
          
          await updateStatus(cancelledStatus);
          try {
            await redis.del(cancelKey);
          } catch {
            // Ignore cleanup failure
          }
          return;
        }
      } catch (error) {
        log.warn(`Failed to check cancel flag in Redis: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue processing - don't let Redis issues stop the job
      }

      // Update current artist in status
      const currentStatus: JobStatus = {
        jobId,
        status: 'running',
        total: artists.length,
        processed,
        fixed,
        failed,
        currentArtist: artist.artistName || `Artist ${artist.id}`,
      };
      await updateStatus(currentStatus);

      // Process artist
      try {
        const result = await this.fixArtist(lidarr, artist.id, artist.foreignArtistId);
        if (result.success) {
          fixed++;
        }
      } catch (error) {
        log.warn(`Failed to fix artist ${artist.id}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        failed++;
      }

      processed++;

      // Update progress
      const progressStatus: JobStatus = {
        jobId,
        status: 'running',
        total: artists.length,
        processed,
        fixed,
        failed,
      };
      await updateStatus(progressStatus);

      // Rate limit: wait 1 second between artists (unless this is the last one)
      if (processed < artists.length) {
        await this.sleep(1000);
      }
    }

    // Mark as completed
    const completedStatus: JobStatus = {
      jobId,
      status: 'completed',
      total: artists.length,
      processed,
      fixed,
      failed,
    };
    await updateStatus(completedStatus);
    
    log.info(`Batch fix completed for user ${userId}: ${fixed} fixed, ${failed} failed`);
  }

  /**
   * Sleep for a given number of milliseconds.
   */
  protected async sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }
}
