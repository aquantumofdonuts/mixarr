/**
 * FeedService - Aggregates subscription results into deduplicated feed items.
 *
 * Deduplication strategy:
 * 1. Group by MBID when available (most reliable)
 * 2. Fall back to normalized artist name when no MBID
 *
 * Normalization: lowercase, strip "The " prefix, remove non-alphanumeric chars
 */

import prisma from '../lib/db.js';
import type { PrismaClient } from '@prisma/client';
import type { LidarrService } from './lidarr.js';
import type { LidarrConnectionConfig } from '../types/connections.js';
import { createLogger } from '../lib/logger.js';
import { fetchDeezerArtistImage } from './deezer.js';
import { CacheService, CACHE_MISS_SENTINEL, CACHE_TTLS, CACHE_KEYS } from './cache.js';

const log = createLogger('FeedService');

/** Max parallel external API calls (Deezer/Last.fm) during enrichment. */
const ENRICHMENT_CONCURRENCY = 5;

/**
 * Safety bound on how many result rows are aggregated per feed request.
 * Newest rows win; anything older than the cap ages out of the feed.
 */
const MAX_AGGREGATION_ROWS = 5000;

/**
 * Error thrown when a feed item is not found
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/**
 * Error thrown when user is not authorized to access a resource
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export interface AggregatedFeedItem {
  id: string;
  artistName: string;
  artistMbid: string | null;
  imageUrl: string | null;
  subscriptionCount: number;
  sourceTypes: string[];
  sourceCount: number;
  linkedResultIds: number[];
  earliestFound: Date;
  score: number;
  // Metadata fields for display
  tags: string[] | null;
  listeners: number | null;
  subscriptionName: string | null;
}

export interface SubscriptionResultInput {
  id: number;
  artistName: string;
  artistMbid: string | null;
  subscriptionId: number;
  imageUrl?: string | null;
  sources: string[] | string | null | unknown;
  createdAt: Date;
  status: string;
  // Optional metadata from SubscriptionResult
  tags?: string | null;
  listeners?: number | null;
  subscriptionName?: string;
}

export interface ScoreInput {
  subscriptionCount: number;
  sourceCount: number;
  librarySimilarity: number;
  earliestFound: Date;
}

export interface FeedResponse {
  items: AggregatedFeedItem[];
  total: number;
  stats: {
    pending: number;
    addedToday: number;
  };
}

/**
 * Interface for Last.fm service dependency (subset of LastfmService for loose coupling)
 */
export interface LastfmStatsService {
  getArtistStats: (name: string) => Promise<{ listeners: number; playcount: number; tags: string[] } | null>;
}

export interface FeedOptions {
  limit: number;
  offset: number;
  includeActedOn?: boolean;
  /** Optional Last.fm service for on-demand metadata enrichment */
  lastfmService?: LastfmStatsService | null;
}

export class FeedService {
  private prismaClient: PrismaClient;
  private lidarrService?: LidarrService;
  private lidarrConfig?: LidarrConnectionConfig;
  private cacheService: CacheService | null;

  /**
   * Promise for the most recent background Lidarr add kicked off by approve().
   * Never rejects. Exposed so tests (and shutdown hooks) can await completion.
   */
  pendingLidarrAdd: Promise<void> | null = null;

  constructor(
    prismaInstance?: PrismaClient,
    lidarrService?: LidarrService,
    lidarrConfig?: LidarrConnectionConfig,
    cacheService?: CacheService | null
  ) {
    this.prismaClient = (prismaInstance || prisma) as PrismaClient;
    this.lidarrService = lidarrService;
    this.lidarrConfig = lidarrConfig;
    this.cacheService = cacheService ?? null;
  }

  /**
   * Normalize artist name for deduplication.
   * Lowercase, remove "The " prefix, strip non-alphanumeric.
   */
  private normalizeName(name: string): string {
    return name
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  /**
   * Parse sources from various formats (JSON array, string, null, etc.)
   */
  private parseSources(sources: unknown): string[] {
    if (sources === null || sources === undefined) {
      return [];
    }
    if (Array.isArray(sources)) {
      return sources.filter((s): s is string => typeof s === 'string');
    }
    if (typeof sources === 'string') {
      try {
        const parsed = JSON.parse(sources);
        return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  /**
   * Parse tags from various formats (JSON array, string[], null).
   * Returns null for invalid/missing data, limits to first 3 tags.
   */
  private parseTags(tags: unknown): string[] | null {
    if (tags === null || tags === undefined) {
      return null;
    }
    if (Array.isArray(tags)) {
      const validTags = tags.filter((t): t is string => typeof t === 'string');
      return validTags.length > 0 ? validTags.slice(0, 3) : null;
    }
    if (typeof tags === 'string') {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) {
          const validTags = parsed.filter((t): t is string => typeof t === 'string');
          return validTags.length > 0 ? validTags.slice(0, 3) : null;
        }
        return null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Run an async mapper over items with a bounded number of workers,
   * preserving result order. Keeps enrichment from firing one external
   * API call per feed item simultaneously.
   */
  private async mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const i = nextIndex++;
        results[i] = await fn(items[i]);
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Enrich feed items with images from Deezer for items missing imageUrl.
   * Uses Redis cache to avoid redundant Deezer API calls.
   * Flow per item: cache check → API call (if miss) → cache store
   */
  async enrichWithImages(items: AggregatedFeedItem[]): Promise<AggregatedFeedItem[]> {
    const itemsNeedingImages = items.filter((item) => !item.imageUrl);
    if (itemsNeedingImages.length === 0) {
      return items;
    }

    // Fetch images with bounded concurrency (with cache)
    const results = await this.mapWithConcurrency(itemsNeedingImages, ENRICHMENT_CONCURRENCY, async (item) => {
      const normalizedName = this.normalizeName(item.artistName);
      const cacheKey = CACHE_KEYS.deezerImage(normalizedName);

      // Check cache first
      if (this.cacheService) {
        try {
          const cached = await this.cacheService.get<string>(cacheKey);
          if (cached === CACHE_MISS_SENTINEL) {
            return { id: item.id, imageUrl: null };
          }
          if (cached !== null) {
            return { id: item.id, imageUrl: cached };
          }
        } catch {
          // Cache error — fall through to API
        }
      }

      // Cache miss or no cache — call Deezer
      try {
        const imageUrl = await fetchDeezerArtistImage(item.artistName);
        if (imageUrl) {
          // Cache the successful result (fire-and-forget, don't discard valid result)
          try { if (this.cacheService) await this.cacheService.set(cacheKey, imageUrl, CACHE_TTLS.DEEZER_IMAGE); } catch { /* cache write failure is non-fatal */ }
          return { id: item.id, imageUrl };
        } else {
          // Cache the miss (fire-and-forget)
          try { if (this.cacheService) await this.cacheService.setMiss(cacheKey, CACHE_TTLS.MISS); } catch { /* cache write failure is non-fatal */ }
          return { id: item.id, imageUrl: null };
        }
      } catch {
        return { id: item.id, imageUrl: null };
      }
    });

    const imageMap = new Map(results.map((r) => [r.id, r.imageUrl]));

    // Update items with fetched images
    return items.map((item) => {
      if (!item.imageUrl && imageMap.has(item.id)) {
        return { ...item, imageUrl: imageMap.get(item.id) || null };
      }
      return item;
    });
  }

  /**
   * Enrich feed items with tags and listeners from Last.fm API.
   * Only fetches for items missing both tags AND listeners (on-demand enrichment).
   * Skips items that already have metadata from database.
   * 
   * @param items - Feed items to enrich
   * @param lastfmService - Last.fm service instance, or null if no connection
   * @returns Enriched items with tags/listeners populated where available
   */
  async enrichWithLastfm(
    items: AggregatedFeedItem[],
    lastfmService: { getArtistStats: (name: string) => Promise<{ listeners: number; playcount: number; tags: string[] } | null> } | null
  ): Promise<AggregatedFeedItem[]> {
    // No Last.fm service available - return items unchanged
    if (!lastfmService) {
      return items;
    }

    // Find items that need enrichment (missing both tags AND listeners)
    const itemsNeedingEnrichment = items.filter(
      (item) => item.tags === null && item.listeners === null
    );

    if (itemsNeedingEnrichment.length === 0) {
      return items;
    }

    // Fetch stats with bounded concurrency
    const results = await this.mapWithConcurrency(itemsNeedingEnrichment, ENRICHMENT_CONCURRENCY, async (item) => {
      const normalizedName = this.normalizeName(item.artistName);
      const cacheKey = CACHE_KEYS.lastfmStats(normalizedName);

      // Check cache first
      if (this.cacheService) {
        try {
          const cached = await this.cacheService.get<{ listeners: number; playcount: number; tags: string[] }>(cacheKey);
          if (cached === CACHE_MISS_SENTINEL) {
            return { id: item.id, stats: null };
          }
          if (cached !== null) {
            return { id: item.id, stats: cached };
          }
        } catch {
          // Cache error — fall through to API
        }
      }

      // Cache miss or no cache — call Last.fm
      try {
        const stats = await lastfmService.getArtistStats(item.artistName);
        if (stats) {
          try { if (this.cacheService) await this.cacheService.set(cacheKey, stats, CACHE_TTLS.LASTFM_STATS); } catch { /* non-fatal */ }
        } else {
          try { if (this.cacheService) await this.cacheService.setMiss(cacheKey, CACHE_TTLS.MISS); } catch { /* non-fatal */ }
        }
        return { id: item.id, stats };
      } catch {
        return { id: item.id, stats: null };
      }
    });

    const statsMap = new Map(results.map((r) => [r.id, r.stats]));

    // Update items with fetched stats
    return items.map((item) => {
      // Skip if item already has data
      if (item.tags !== null || item.listeners !== null) {
        return item;
      }

      const stats = statsMap.get(item.id);
      if (!stats) {
        return item;
      }

      // Limit tags to 3, convert empty array to null
      const tags = stats.tags.length > 0 ? stats.tags.slice(0, 3) : null;

      return {
        ...item,
        tags,
        listeners: stats.listeners,
      };
    });
  }

  /**
   * Persist enrichment data back to SubscriptionResult rows.
   * Compares before/after items and writes changed fields.
   * Fire-and-forget — errors are logged but don't propagate.
   */
  async persistEnrichment(
    before: AggregatedFeedItem[],
    after: AggregatedFeedItem[]
  ): Promise<void> {
    const beforeMap = new Map(before.map(item => [item.id, item]));

    const writes: Promise<unknown>[] = [];

    for (const afterItem of after) {
      const beforeItem = beforeMap.get(afterItem.id);
      if (!beforeItem) continue;

      const data: Record<string, unknown> = {};

      // Check if imageUrl was enriched
      if (!beforeItem.imageUrl && afterItem.imageUrl) {
        data.imageUrl = afterItem.imageUrl;
      }

      // Check if tags were enriched
      if (beforeItem.tags === null && afterItem.tags !== null) {
        data.tags = JSON.stringify(afterItem.tags);
      }

      // Check if listeners were enriched
      if (beforeItem.listeners === null && afterItem.listeners !== null) {
        data.listeners = afterItem.listeners;
      }

      if (Object.keys(data).length === 0) continue;

      writes.push(
        this.prismaClient.subscriptionResult
          .updateMany({
            where: { id: { in: afterItem.linkedResultIds } },
            data,
          })
          .catch((error: unknown) => {
            log.warn('Enrichment write-back failed', {
              artistName: afterItem.artistName,
              error: (error as Error).message,
            });
          })
      );
    }

    await Promise.all(writes);
  }

  /**
   * Generate a synthetic feed item ID from linked result IDs.
   * Sorted for consistency.
   */
  private generateFeedId(linkedIds: number[]): string {
    const sorted = [...linkedIds].sort((a, b) => a - b);
    return `feed-${sorted.join('-')}`;
  }

  /**
   * Aggregate subscription results into deduplicated feed items.
   *
   * Groups results by MBID (preferred) or normalized artist name (fallback).
   * When an MBID match is found, also merges name-based matches into that group.
   * Collects source types, counts subscriptions, and tracks earliest found date.
   */
  aggregateResults(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
    if (results.length === 0) {
      return [];
    }

    // First pass: build MBID to normalized-name mapping
    const mbidToName = new Map<string, string>();
    const nameToMbid = new Map<string, string>();

    for (const result of results) {
      if (result.artistMbid) {
        const normalizedName = this.normalizeName(result.artistName);
        mbidToName.set(result.artistMbid, normalizedName);
        nameToMbid.set(normalizedName, result.artistMbid);
      }
    }

    // Group by canonical key (prefer MBID, but link name-based to existing MBID groups)
    const groups = new Map<string, SubscriptionResultInput[]>();

    for (const result of results) {
      let key: string;
      if (result.artistMbid) {
        key = result.artistMbid;
      } else {
        const normalizedName = this.normalizeName(result.artistName);
        // Check if we have an MBID for this normalized name
        key = nameToMbid.get(normalizedName) || normalizedName;
      }
      const existing = groups.get(key) || [];
      existing.push(result);
      groups.set(key, existing);
    }

    // Convert groups to aggregated items
    const aggregated: AggregatedFeedItem[] = [];

    for (const [, groupResults] of groups) {
      const linkedResultIds = groupResults.map((r) => r.id);
      const subscriptionIds = new Set(groupResults.map((r) => r.subscriptionId));

      // Collect all unique source types
      const allSources = new Set<string>();
      for (const r of groupResults) {
        const sources = this.parseSources(r.sources);
        sources.forEach((s) => allSources.add(s));
      }

      // Find earliest date
      const earliestFound = groupResults.reduce((earliest, r) => {
        return r.createdAt < earliest ? r.createdAt : earliest;
      }, groupResults[0].createdAt);

      // Prefer result with MBID for display data (better quality)
      const primary = groupResults.find((r) => r.artistMbid) || groupResults[0];

      // Aggregate tags: merge unique tags from all results, limit to 3
      // Prioritize tags from results with MBID
      const allTags = new Set<string>();
      const sortedResults = [...groupResults].sort((a, b) => {
        // Results with MBID come first
        if (a.artistMbid && !b.artistMbid) return -1;
        if (!a.artistMbid && b.artistMbid) return 1;
        return 0;
      });
      for (const r of sortedResults) {
        const tags = this.parseTags(r.tags);
        if (tags) {
          tags.forEach((t) => allTags.add(t));
        }
      }
      const aggregatedTags = allTags.size > 0 ? Array.from(allTags).slice(0, 3) : null;

      // Aggregate listeners: take max value across all results
      let maxListeners: number | null = null;
      for (const r of groupResults) {
        if (r.listeners !== null && r.listeners !== undefined) {
          maxListeners = maxListeners === null ? r.listeners : Math.max(maxListeners, r.listeners);
        }
      }

      // Resolve subscription name:
      // - Single subscription: use the subscription name
      // - Multiple subscriptions: show "Found in X subs"
      // - No names provided: null
      let resolvedSubscriptionName: string | null = null;
      const uniqueSubNames = new Set<string>();
      for (const r of groupResults) {
        if (r.subscriptionName) {
          uniqueSubNames.add(r.subscriptionName);
        }
      }
      if (subscriptionIds.size === 1 && uniqueSubNames.size === 1) {
        // Single subscription with name
        resolvedSubscriptionName = Array.from(uniqueSubNames)[0];
      } else if (subscriptionIds.size > 1) {
        // Multiple subscriptions
        resolvedSubscriptionName = `Found in ${subscriptionIds.size} subs`;
      }
      // If no subscriptionName was provided, leave as null

      aggregated.push({
        id: this.generateFeedId(linkedResultIds),
        artistName: primary.artistName,
        artistMbid: primary.artistMbid,
        imageUrl: primary.imageUrl || null,
        subscriptionCount: subscriptionIds.size,
        sourceTypes: Array.from(allSources),
        sourceCount: allSources.size,
        linkedResultIds,
        earliestFound,
        score: 0, // Calculated in aggregateAndScore
        tags: aggregatedTags,
        listeners: maxListeners,
        subscriptionName: resolvedSubscriptionName,
      });
    }

    return aggregated;
  }

  /**
   * Calculate value score for a feed item.
   * Formula: (subscriptionCount × 40) + (sourceCount × 30) + (librarySimilarity × 20) + (recencyBonus × 10)
   * Caps: subscriptionCount at 10, sourceCount at 5, librarySimilarity at 20
   */
  calculateScore(input: ScoreInput): number {
    const SUB_WEIGHT = 40;
    const SOURCE_WEIGHT = 30;
    const LIBRARY_WEIGHT = 20;
    const RECENCY_WEIGHT = 10;

    const subScore = Math.min(input.subscriptionCount, 10) * (SUB_WEIGHT / 10);
    const sourceScore = Math.min(input.sourceCount, 5) * (SOURCE_WEIGHT / 5);
    const libraryScore = Math.min(input.librarySimilarity, 20) * (LIBRARY_WEIGHT / 20);

    // Recency bonus
    const now = Date.now();
    const age = now - input.earliestFound.getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const ONE_WEEK = 7 * ONE_DAY;

    let recencyBonus = 0;
    if (age < ONE_DAY) {
      recencyBonus = RECENCY_WEIGHT;
    } else if (age < ONE_WEEK) {
      recencyBonus = RECENCY_WEIGHT * 0.5;
    }

    return Math.round(subScore + sourceScore + libraryScore + recencyBonus);
  }

  /**
   * Aggregate results and calculate scores, sorted by score descending.
   */
  aggregateAndScore(results: SubscriptionResultInput[]): AggregatedFeedItem[] {
    const aggregated = this.aggregateResults(results);

    // Calculate scores
    for (const item of aggregated) {
      item.score = this.calculateScore({
        subscriptionCount: item.subscriptionCount,
        sourceCount: item.sourceCount,
        librarySimilarity: 0, // MVP: not implemented
        earliestFound: item.earliestFound,
      });
    }

    // Sort by score descending
    return aggregated.sort((a, b) => b.score - a.score);
  }

  /**
   * Get feed for a specific user.
   * Queries SubscriptionResult records where status='pending' or 'queued',
   * joins with Subscription to filter by userId,
   * aggregates and scores results, then paginates.
   */
  async getFeedForUser(userId: number, options: FeedOptions): Promise<FeedResponse> {
    const { limit, offset, includeActedOn = false, lastfmService } = options;

    // Get user's subscriptions with names for display
    const subscriptions = await this.prismaClient.subscription.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    if (subscriptions.length === 0) {
      return { items: [], total: 0, stats: { pending: 0, addedToday: 0 } };
    }

    const subscriptionIds = subscriptions.map((s) => s.id);
    const subscriptionNameMap = new Map(subscriptions.map((s) => [s.id, s.name]));

    // Filter statuses
    const statusFilter = includeActedOn
      ? ['pending', 'queued', 'added', 'rejected']
      : ['pending', 'queued'];

    // Fetch matching results (artist type only for MVP), newest first,
    // bounded so a single request can never pull an unbounded result set
    // into memory.
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: {
        subscriptionId: { in: subscriptionIds },
        itemType: 'artist',
        status: { in: statusFilter },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_AGGREGATION_ROWS,
      select: {
        id: true,
        name: true,
        artistName: true,
        mbid: true,
        subscriptionId: true,
        imageUrl: true,
        sources: true,
        createdAt: true,
        status: true,
        itemType: true,
        tags: true,
        listeners: true,
      },
    });

    // Map Prisma result to SubscriptionResultInput format
    const mappedResults: SubscriptionResultInput[] = results.map((r) => ({
      id: r.id,
      // For artists, 'name' is the artist name; 'artistName' is used for albums
      artistName: r.name,
      artistMbid: r.mbid,
      subscriptionId: r.subscriptionId,
      imageUrl: r.imageUrl,
      sources: r.sources,
      createdAt: r.createdAt,
      status: r.status,
      tags: r.tags,
      listeners: r.listeners,
      subscriptionName: subscriptionNameMap.get(r.subscriptionId) || undefined,
    }));

    // Aggregate and score
    const aggregated = this.aggregateAndScore(mappedResults);

    const total = aggregated.length;

    // Paginate
    const paginated = aggregated.slice(offset, offset + limit);

    // Snapshot items before enrichment (for write-back comparison)
    const preEnrichment = paginated.map(item => ({ ...item }));

    // Enrich items missing images from Deezer
    const imageEnrichedItems = await this.enrichWithImages(paginated);

    // Enrich items missing metadata from Last.fm (on-demand)
    const enrichedItems = await this.enrichWithLastfm(imageEnrichedItems, lastfmService || null);

    // Fire-and-forget: persist enrichment data to SubscriptionResult rows
    this.persistEnrichment(preEnrichment, enrichedItems).catch(err =>
      log.warn('Background enrichment write-back failed', { error: (err as Error).message })
    );

    // Calculate stats
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [addedToday, pending] = await Promise.all([
      this.prismaClient.subscriptionResult.count({
        where: {
          subscriptionId: { in: subscriptionIds },
          status: 'added',
          processedAt: { gte: today },
        },
      }),
      this.prismaClient.subscriptionResult.count({
        where: {
          subscriptionId: { in: subscriptionIds },
          status: { in: ['pending', 'queued'] },
        },
      }),
    ]);

    return {
      items: enrichedItems,
      total,
      stats: { pending, addedToday },
    };
  }

  /**
   * Parse linked result IDs from synthetic feed ID.
   * Feed IDs are in format "feed-1-2-3" where 1, 2, 3 are result IDs.
   */
  private parseFeedId(feedId: string): number[] {
    const match = feedId.match(/^feed-(.+)$/);
    if (!match) return [];
    return match[1].split('-').map((id) => parseInt(id, 10)).filter((n) => !isNaN(n));
  }

  /**
   * Approve a feed item: update status to 'added', remove from ReviewItem.
   * All linked SubscriptionResults are updated atomically.
   */
  async approve(feedId: string, userId: number): Promise<{ artistName: string }> {
    const resultIds = this.parseFeedId(feedId);
    if (resultIds.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Fetch results with subscription to verify ownership
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: { id: { in: resultIds } },
      include: { subscription: { select: { userId: true } } },
    });

    if (results.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Verify all belong to this user
    if (results.some((r) => r.subscription.userId !== userId)) {
      throw new ForbiddenError('Not authorized');
    }

    const artistName = results[0].name;
    const artistMbid = results[0].mbid;

    // Wrap in transaction
    await this.prismaClient.$transaction(async (tx) => {
      // Update all linked results
      await tx.subscriptionResult.updateMany({
        where: { id: { in: resultIds } },
        data: { status: 'added', processedAt: new Date() },
      });

      // Delete matching ReviewItems (by MBID or name)
      const orConditions: { mbid?: string; artistName?: string }[] = [];
      if (artistMbid) {
        orConditions.push({ mbid: artistMbid });
      }
      orConditions.push({ artistName });

      await tx.reviewItem.deleteMany({
        where: { OR: orConditions },
      });
    });

    // Add to Lidarr in the background after the transaction completes —
    // the HTTP response must not wait on Lidarr round-trips.
    if (artistMbid && this.lidarrService) {
      this.pendingLidarrAdd = this.addToLidarrInBackground(artistName, artistMbid);
    } else if (!artistMbid) {
      log.debug(`Skipping Lidarr add for ${artistName}: no MBID available`);
    }

    return { artistName };
  }

  /**
   * Add an approved artist to Lidarr, fetching profile defaults as needed.
   * Runs detached from the approve() response; never throws.
   */
  private async addToLidarrInBackground(artistName: string, artistMbid: string): Promise<void> {
    if (!this.lidarrService) return;
    try {
      // Get config values, fetching defaults from Lidarr if not configured
      let qpId = this.lidarrConfig?.qualityProfileId;
      let mpId = this.lidarrConfig?.metadataProfileId;
      let rfPath = this.lidarrConfig?.rootFolderPath;

      // Fetch defaults for any missing config (same pattern as search.ts)
      if (!qpId) {
        const profiles = await this.lidarrService.getQualityProfiles();
        qpId = profiles[0]?.id;
      }
      if (!mpId) {
        const profiles = await this.lidarrService.getMetadataProfiles();
        mpId = profiles[0]?.id;
      }
      if (!rfPath) {
        const folders = await this.lidarrService.getRootFolders();
        rfPath = folders[0]?.path;
      }

      if (!qpId || !mpId || !rfPath) {
        log.warn(`Cannot add artist to Lidarr - missing configuration: qualityProfileId=${qpId || 'missing'}, metadataProfileId=${mpId || 'missing'}, rootFolderPath=${rfPath || 'missing'}`);
      } else {
        log.info(`Adding artist to Lidarr: ${artistName} (${artistMbid}) with config: qualityProfileId=${qpId}, metadataProfileId=${mpId}, rootFolderPath=${rfPath}`);
        // Use addArtistWithCacheWarm like all other add operations in the codebase
        await this.lidarrService.addArtistWithCacheWarm(
          artistMbid,
          qpId,
          mpId,
          rfPath,
          true,  // monitored
          true,  // searchForMissingAlbums
          false, // waitForRefresh (deprecated)
          this.lidarrConfig?.monitorOption || 'all',
          this.lidarrConfig?.monitorNewItems || 'all'
        );
        log.info(`Successfully added artist to Lidarr: ${artistName} (${artistMbid})`);
      }
    } catch (error) {
      // Lidarr failure shouldn't fail the approve action
      log.warn(`Failed to add artist to Lidarr: ${artistMbid}`, error);
    }
  }

  /**
   * Dismiss a feed item: update status to 'rejected', remove from ReviewItem.
   * All linked SubscriptionResults are updated atomically.
   */
  async dismiss(feedId: string, userId: number): Promise<{ artistName: string }> {
    const resultIds = this.parseFeedId(feedId);
    if (resultIds.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Fetch results with subscription to verify ownership
    const results = await this.prismaClient.subscriptionResult.findMany({
      where: { id: { in: resultIds } },
      include: { subscription: { select: { userId: true } } },
    });

    if (results.length === 0) {
      throw new NotFoundError('Feed item not found');
    }

    // Verify all belong to this user
    if (results.some((r) => r.subscription.userId !== userId)) {
      throw new ForbiddenError('Not authorized');
    }

    const artistName = results[0].name;
    const artistMbid = results[0].mbid;

    // Wrap in transaction
    await this.prismaClient.$transaction(async (tx) => {
      // Update all linked results
      await tx.subscriptionResult.updateMany({
        where: { id: { in: resultIds } },
        data: { status: 'rejected', processedAt: new Date() },
      });

      // Delete matching ReviewItems (by MBID or name)
      const orConditions: { mbid?: string; artistName?: string }[] = [];
      if (artistMbid) {
        orConditions.push({ mbid: artistMbid });
      }
      orConditions.push({ artistName });

      await tx.reviewItem.deleteMany({
        where: { OR: orConditions },
      });
    });

    return { artistName };
  }
}
