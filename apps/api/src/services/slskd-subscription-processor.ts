/**
 * SlskdSubscriptionProcessor - Process subscription results and queue downloads
 * Implements per-file download model with transaction safety
 */

import { PrismaClient } from "@prisma/client";
import { SlskdService, SlskdFile } from "./slskd.js";
import { logger as log } from "../lib/logger.js";
import { selectBestPeer, SlskdPeer } from "./slskd-peer-scorer.js";
import { 
  enqueueSlskdSearch, 
  enqueueSlskdDownload,
  SLSKD_QUEUE_NAME 
} from "../jobs/slskd-operations-queue.js";
import { isSlskdRateLimitingEnabled } from "../lib/settings.js";
import { QueueEvents } from "bullmq";
import { createRedisConnection } from "../lib/redis.js";

export interface ProcessArtistRequest {
  name: string;
  album?: string;  // Optional - if not provided, searches by artist name only
  mbid?: string;   // Optional MusicBrainz ID
}

export interface ProcessContext {
  connectionId: number;
  userId: number;
  preferences: {
    preferLossless?: boolean;
    minBitrate?: number;
  };
}

export interface ProcessResult {
  status: "queued" | "no_results" | "error" | "not_found";
  downloadId?: number;
  searchResultCount?: number;
  error?: string;
}

export class SlskdSubscriptionProcessor {
  private maxRetries = 3;
  private retryDelay = 30000; // 30 seconds
  private queueEvents: QueueEvents;

  constructor(
    private prisma: PrismaClient,
    private slskdService: SlskdService,
    options?: { maxRetries?: number; retryDelay?: number },
  ) {
    if (options?.maxRetries !== undefined) {
      this.maxRetries = options.maxRetries;
    }
    if (options?.retryDelay !== undefined) {
      this.retryDelay = options.retryDelay;
    }
    this.queueEvents = new QueueEvents(SLSKD_QUEUE_NAME, {
      connection: createRedisConnection(),
    });
  }

  async close() {
    await this.queueEvents.close();
  }

  async processArtist(
    artist: ProcessArtistRequest,
    context: ProcessContext,
  ): Promise<ProcessResult> {
    const { connectionId, preferences } = context;
    const searchText = artist.album ? `${artist.name} ${artist.album}` : artist.name;

    // IMPORTANT FIX #4: Validate connectionId
    if (!connectionId || connectionId <= 0) {
      throw new Error(`Invalid connectionId: ${connectionId}`);
    }

    try {
      // Retry loop for transient errors
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Read flag fresh on each operation to avoid stale cache
          const useQueue = await isSlskdRateLimitingEnabled();

          let searchId: string;

          if (useQueue) {
            // Enqueue search and wait for completion
            log.info("Using rate-limited queue for search", {
              artist: artist.name,
              album: artist.album,
            });

            const searchJob = await enqueueSlskdSearch({
              searchText,
              searchTimeout: 30000,
              connectionId,
            });

            // CRITICAL FIX #2: Catch timeout errors from waitUntilFinished
            let searchResult: { searchId: string };
            try {
              // Wait for job to complete (60s timeout includes queue wait + execution)
              searchResult = await searchJob.waitUntilFinished(
                this.queueEvents,
                60000,
              );
            } catch (error) {
              // Handle WaitingChildrenError (timeout) specifically
              if (error && typeof error === 'object' && 'name' in error && error.name === 'WaitingChildrenError') {
                throw new Error(`Search job timed out after 60s: ${searchText}`);
              }
              throw error;
            }

            searchId = searchResult.searchId;
          } else {
            // Direct call (legacy path)
            log.info("Using direct slskd call (rate limiting disabled)", {
              artist: artist.name,
              album: artist.album,
            });

            const search = await this.slskdService.search(searchText);
            searchId = search.id;
          }

          // Poll until the search reaches a terminal state. A single
          // immediate check here almost always saw 0 responses — slskd
          // needs several seconds to gather peer responses (confirmed
          // live: 0 responses immediately after creating a search, 19+
          // after ~5s) — so this was the root cause of slskd_downloads
          // never getting a single row despite searches genuinely
          // succeeding: every call saw an empty response list and
          // returned "no_results" before slskd had a chance to report
          // anything. slskdService.searchWithPolling() already implements
          // this correctly elsewhere in this file's own service — mirrored
          // here rather than reused directly since search creation for
          // this caller goes through the rate-limited queue path above,
          // and searchWithPolling always creates its own new search.
          const SEARCH_POLL_INTERVAL_MS = 1000;
          const SEARCH_POLL_MAX_ATTEMPTS = 30;
          const SEARCH_TERMINAL_STATES = ["Completed", "TimedOut", "Errored", "Cancelled"];

          let searchResult = await this.slskdService.getSearchResults(String(searchId), true);
          for (
            let pollAttempt = 0;
            pollAttempt < SEARCH_POLL_MAX_ATTEMPTS && !SEARCH_TERMINAL_STATES.includes(searchResult.state);
            pollAttempt++
          ) {
            await new Promise((resolve) => setTimeout(resolve, SEARCH_POLL_INTERVAL_MS));
            searchResult = await this.slskdService.getSearchResults(String(searchId), true);
          }

          if (searchResult.state === "Errored") {
            throw new Error("Search failed");
          }

          // No results is a valid response - do NOT retry
          const responses = searchResult.responses || [];
          if (!responses.length) {
            return { status: "no_results", searchResultCount: 0 };
          }

          // Find best result (simplified scoring)
          const bestResult = this.selectBestResult(
            responses,
            preferences,
          );
          if (!bestResult) {
            return {
              status: "no_results",
              searchResultCount: responses.length,
            };
          }

          // Filter files
          const filesToDownload = this.filterFiles(
            bestResult.files,
            preferences,
          );
          if (!filesToDownload.length) {
            return {
              status: "no_results",
              searchResultCount: responses.length,
            };
          }

          // Phase 1: Create download records with queued_locally status
          const downloads = await this.prisma.$transaction(
            filesToDownload.map((file) =>
              this.prisma.slskdDownload.create({
                data: {
                  connectionId,
                  artistName: artist.name,
                  albumName: artist.album || '',
                  username: bestResult.username,
                  filename: file.filename,
                  fileSize: BigInt(file.size),
                  status: "queued_locally",
                },
              }),
            ),
          );

          // Phase 2: Queue files to slskd
          try {
            for (const file of filesToDownload) {
              if (useQueue) {
                // Use rate-limited queue
                const downloadJob = await enqueueSlskdDownload({
                  username: bestResult.username,
                  filename: file.filename,
                  connectionId,
                });

                // Wait for download to be queued (10s timeout - downloads are quick)
                await downloadJob.waitUntilFinished(this.queueEvents, 10000);
              } else {
                // Direct call (legacy path)
                await this.slskdService.queueDownload(bestResult.username, [{
                  filename: file.filename,
                  size: file.size,
                }]);
              }
            }

            // Phase 3: Update status to pending on success
            await this.prisma.slskdDownload.updateMany({
              where: { id: { in: downloads.map((d) => d.id) } },
              data: { status: "pending" },
            });

            log.info("Queued slskd downloads", {
              artist: artist.name,
              album: artist.album,
              username: bestResult.username,
              fileCount: filesToDownload.length,
              downloadIds: downloads.map((d) => d.id),
            });

            return {
              status: "queued",
              downloadId: downloads[0]?.id,
              searchResultCount: responses.length,
            };
          } catch (error) {
            // Queue failed - mark downloads as failed
            await this.prisma.slskdDownload.updateMany({
              where: { id: { in: downloads.map((d) => d.id) } },
              data: {
                status: "failed",
                error: error instanceof Error ? error.message : "Queue failed",
              },
            });

            log.error("Failed to queue downloads", {
              artist: artist.name,
              downloadIds: downloads.map((d) => d.id),
              error,
            });

            return {
              status: "error",
              error: error instanceof Error ? error.message : "Queue failed",
              searchResultCount: responses.length,
            };
          }
        } catch (error) {
          // IMPORTANT FIX #7: Don't retry on queue full errors
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          const isQueueFull = errorMessage.includes("queue is full") || errorMessage.includes("too many jobs");

          if (isQueueFull) {
            log.error("Queue is full, not retrying", {
              artist: artist.name,
              album: artist.album,
              error: errorMessage,
            });
            throw error;
          }

          // Retry on transient errors (timeout, network, slskd errors)
          if (attempt < this.maxRetries - 1) {
            log.warn("Search failed, retrying", {
              attempt: attempt + 1,
              maxRetries: this.maxRetries,
              artist: artist.name,
              album: artist.album,
              error: errorMessage,
            });

            // Wait before retrying
            await new Promise((resolve) =>
              setTimeout(resolve, this.retryDelay),
            );
            continue;
          }

          // Max retries exceeded - throw error
          throw error;
        }
      }

      // This should never be reached, but TypeScript requires it
      throw new Error("Max retries exceeded without successful result");
    } catch (error) {
      log.error("Failed to process artist", { artist, error });
      throw error;
    }
  }

  private selectBestResult(
    responses: Array<{
      username: string;
      files: SlskdFile[];
      uploadSpeed?: number;
      queueLength?: number;
    }>,
    _preferences: { preferLossless?: boolean },
  ) {
    if (!responses.length) return null;

    // Filter to responses with files first
    const withFiles = responses.filter((r) => r.files.length > 0);
    if (!withFiles.length) return null;

    // Convert to SlskdPeer format for scoring
    const peers: SlskdPeer[] = withFiles.map((r) => ({
      username: r.username,
      uploadSpeed: r.uploadSpeed || 0,
      queueLength: r.queueLength || 0,
      files: r.files.map((f) => ({
        filename: f.filename,
        bitRate: f.bitRate,
        size: f.size,
      })),
    }));

    // Select best peer using quality scoring
    const bestPeer = selectBestPeer(peers);
    if (!bestPeer) return null;

    // Find and return the original response
    return withFiles.find((r) => r.username === bestPeer.username) || null;
  }

  private filterFiles(
    files: SlskdFile[],
    preferences: { preferLossless?: boolean; minBitrate?: number },
  ): SlskdFile[] {
    let filtered = files;

    if (preferences.preferLossless) {
      const lossless = files.filter((f) => f.extension === ".flac");
      if (lossless.length) filtered = lossless;
    }

    if (preferences.minBitrate) {
      filtered = filtered.filter(
        (f) => (f.bitRate || 0) >= (preferences.minBitrate || 0),
      );
    }

    return filtered;
  }
}
