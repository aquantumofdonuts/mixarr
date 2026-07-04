import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedService } from '../../src/services/FeedService.js';

// Mock prisma before importing
vi.mock('../../src/lib/db.js', () => ({
  default: {
    subscription: {
      findMany: vi.fn(),
    },
    subscriptionResult: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

// Mock Deezer service
vi.mock('../../src/services/deezer.js', () => ({
  fetchDeezerArtistImage: vi.fn(),
}));

import prisma from '../../src/lib/db.js';
import { fetchDeezerArtistImage } from '../../src/services/deezer.js';

const mockPrisma = prisma as unknown as {
  subscription: {
    findMany: ReturnType<typeof vi.fn>;
  };
  subscriptionResult: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

/**
 * FeedService Test Suite
 *
 * Edge Cases Documented:
 * - Empty array: returns empty array
 * - Single item: returns unchanged with linkedResultIds
 * - Multiple items same MBID: deduplicates into one
 * - Multiple items same name no MBID: deduplicates by normalized name
 * - Mixed MBID and no-MBID: groups correctly
 *
 * Test Priority:
 * 1. Edge cases (empty, single)
 * 2. Aggregation logic (MBID dedup, name dedup)
 * 3. Scoring (future task)
 * 4. Database integration (getFeedForUser)
 */

describe('FeedService', () => {
  describe('aggregateResults', () => {
    it('returns empty array when no results', () => {
      const service = new FeedService();
      const result = service.aggregateResults([]);
      expect(result).toEqual([]);
    });

    it('returns single item unchanged when one result', () => {
      const service = new FeedService();
      const results = [{
        id: 1,
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        subscriptionId: 1,
        imageUrl: 'http://example.com/img.jpg',
        createdAt: new Date('2026-01-30'),
        status: 'pending',
        sources: ['lastfm'],
      }];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].artistName).toBe('Radiohead');
      expect(aggregated[0].linkedResultIds).toEqual([1]);
    });

    it('deduplicates by MBID when available', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Radiohead', artistMbid: 'abc-123', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
      expect(aggregated[0].linkedResultIds).toEqual([1, 2]);
    });

    it('deduplicates by normalized name when no MBID', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'The Beatles', artistMbid: null, subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Beatles', artistMbid: null, subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].subscriptionCount).toBe(2);
    });

    it('collects unique source types across results', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['lastfm', 'spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toContain('lastfm');
      expect(aggregated[0].sourceTypes).toContain('spotify');
      expect(aggregated[0].sourceCount).toBe(2);
    });

    it('uses earliest createdAt from linked results', () => {
      const service = new FeedService();
      const early = new Date('2026-01-01');
      const late = new Date('2026-01-30');
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: late, status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['spotify'], createdAt: early, status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].earliestFound).toEqual(early);
    });

    it('handles same subscription with multiple results', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      // Same subscription counted once
      expect(aggregated[0].subscriptionCount).toBe(1);
      expect(aggregated[0].linkedResultIds).toEqual([1, 2]);
    });

    it('prefers result with MBID for display data', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'beatles', artistMbid: null, subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'The Beatles', artistMbid: 'beatles-mbid', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(1);
      expect(aggregated[0].artistMbid).toBe('beatles-mbid');
      expect(aggregated[0].artistName).toBe('The Beatles');
    });

    it('generates consistent feed IDs from linked result IDs', () => {
      const service = new FeedService();
      const results = [
        { id: 3, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      // IDs should be sorted for consistency
      expect(aggregated[0].id).toBe('feed-1-3');
    });

    it('handles JSON string sources', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: '["lastfm", "spotify"]', createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toContain('lastfm');
      expect(aggregated[0].sourceTypes).toContain('spotify');
    });

    it('handles null/undefined sources gracefully', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Artist', artistMbid: 'abc', subscriptionId: 1, sources: null, createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated[0].sourceTypes).toEqual([]);
      expect(aggregated[0].sourceCount).toBe(0);
    });

    it('keeps different artists with different MBIDs separate', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'Radiohead', artistMbid: 'radiohead-mbid', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 2, artistName: 'Coldplay', artistMbid: 'coldplay-mbid', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
      ];
      const aggregated = service.aggregateResults(results);
      expect(aggregated).toHaveLength(2);
    });
  });

  describe('calculateScore', () => {
    it('weights subscription count at 40%', () => {
      const service = new FeedService();
      // 2 subscriptions × 40 = 80 (before normalization)
      const score = service.calculateScore({
        subscriptionCount: 2,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0), // old, no recency bonus
      });
      expect(score).toBeGreaterThan(0);
    });

    it('weights source count at 30%', () => {
      const service = new FeedService();
      const scoreWith1Source = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreWith3Sources = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 3,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreWith3Sources).toBeGreaterThan(scoreWith1Source);
    });

    it('caps subscription count at 10', () => {
      const service = new FeedService();
      const scoreAt10 = service.calculateScore({
        subscriptionCount: 10,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreAt20 = service.calculateScore({
        subscriptionCount: 20,
        sourceCount: 0,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreAt20).toBe(scoreAt10);
    });

    it('caps source count at 5', () => {
      const service = new FeedService();
      const scoreAt5 = service.calculateScore({
        subscriptionCount: 0,
        sourceCount: 5,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      const scoreAt10 = service.calculateScore({
        subscriptionCount: 0,
        sourceCount: 10,
        librarySimilarity: 0,
        earliestFound: new Date(0),
      });
      expect(scoreAt10).toBe(scoreAt5);
    });

    it('gives recency bonus for items under 24 hours old', () => {
      const service = new FeedService();
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const recentScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: hourAgo,
      });
      const oldScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: weekAgo,
      });
      expect(recentScore).toBeGreaterThan(oldScore);
    });

    it('gives partial recency bonus for items under 7 days old', () => {
      const service = new FeedService();
      const now = new Date();
      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const recentishScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: threeDaysAgo,
      });
      const oldScore = service.calculateScore({
        subscriptionCount: 1,
        sourceCount: 1,
        librarySimilarity: 0,
        earliestFound: monthAgo,
      });
      expect(recentishScore).toBeGreaterThan(oldScore);
    });
  });

  describe('aggregateAndScore', () => {
    it('sorts results by score descending', () => {
      const service = new FeedService();
      const results = [
        { id: 1, artistName: 'LowScore', artistMbid: 'a', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date('2020-01-01'), status: 'pending' },
        { id: 2, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 1, sources: ['lastfm'], createdAt: new Date(), status: 'pending' },
        { id: 3, artistName: 'HighScore', artistMbid: 'b', subscriptionId: 2, sources: ['spotify'], createdAt: new Date(), status: 'pending' },
      ];
      const feed = service.aggregateAndScore(results);
      expect(feed[0].artistName).toBe('HighScore');
      expect(feed[1].artistName).toBe('LowScore');
    });
  });

  /**
   * Task 3: getFeedForUser - Database Integration Tests
   *
   * Edge Cases:
   * - User with no subscriptions -> empty feed
   * - User with no pending results -> empty feed
   * - User with pending results -> returns them
   *
   * Security:
   * - User can only see own subscriptions' results (userId filter)
   *
   * Note: FeedItemAction table doesn't exist yet - exclusion tests skipped
   */
  describe('getFeedForUser', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('returns empty feed when user has no subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: { userId: 123 },
        select: { id: true, name: true },
      });
    });

    it('returns empty feed when no pending results exist', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1, name: 'Sub 1' }, { id: 2, name: 'Sub 2' }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('returns only pending results for specified user', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 1,
          imageUrl: 'http://example.com/img.jpg',
          sources: '["lastfm"]',
          createdAt: new Date('2026-01-30'),
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].artistName).toBe('Radiohead');
      expect(result.items[0].artistMbid).toBe('radiohead-mbid');
      expect(mockPrisma.subscriptionResult.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: { in: [1] },
            itemType: 'artist',
            status: { in: ['pending', 'queued'] },
          },
        })
      );
    });

    it('maps Prisma result to SubscriptionResultInput format correctly', async () => {
      const createdAt = new Date('2026-01-30');
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 5 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 42,
          name: 'The Beatles',
          artistName: null,
          mbid: 'beatles-mbid',
          subscriptionId: 5,
          imageUrl: 'http://example.com/beatles.jpg',
          sources: '["spotify", "lastfm"]',
          createdAt,
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      const item = result.items[0];
      expect(item.linkedResultIds).toEqual([42]);
      expect(item.artistName).toBe('The Beatles');
      expect(item.artistMbid).toBe('beatles-mbid');
      expect(item.imageUrl).toBe('http://example.com/beatles.jpg');
      expect(item.sourceTypes).toContain('spotify');
      expect(item.sourceTypes).toContain('lastfm');
      expect(item.earliestFound).toEqual(createdAt);
    });

    it('aggregates multiple results from same artist across subscriptions', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        {
          id: 1,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 1,
          imageUrl: 'http://example.com/img1.jpg',
          sources: '["lastfm"]',
          createdAt: new Date('2026-01-28'),
          status: 'pending',
          itemType: 'artist',
        },
        {
          id: 2,
          name: 'Radiohead',
          artistName: null,
          mbid: 'radiohead-mbid',
          subscriptionId: 2,
          imageUrl: 'http://example.com/img2.jpg',
          sources: '["spotify"]',
          createdAt: new Date('2026-01-30'),
          status: 'pending',
          itemType: 'artist',
        },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].subscriptionCount).toBe(2);
      expect(result.items[0].linkedResultIds).toEqual([1, 2]);
      expect(result.items[0].sourceTypes).toContain('lastfm');
      expect(result.items[0].sourceTypes).toContain('spotify');
    });

    it('respects pagination limit and offset', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      // Return 5 distinct artists
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        { id: 1, name: 'Artist1', artistName: null, mbid: 'mbid-1', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 2, name: 'Artist2', artistName: null, mbid: 'mbid-2', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 3, name: 'Artist3', artistName: null, mbid: 'mbid-3', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 4, name: 'Artist4', artistName: null, mbid: 'mbid-4', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
        { id: 5, name: 'Artist5', artistName: null, mbid: 'mbid-5', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
      ]);
      mockPrisma.subscriptionResult.count.mockResolvedValue(0);

      const service = new FeedService();
      
      const page1 = await service.getFeedForUser(123, { limit: 2, offset: 0 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(5);

      const page2 = await service.getFeedForUser(123, { limit: 2, offset: 2 });
      expect(page2.items).toHaveLength(2);
    });

    it('returns stats with pending count and added today', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 1 }]);
      mockPrisma.subscriptionResult.findMany.mockResolvedValue([
        { id: 1, name: 'Artist1', artistName: null, mbid: 'mbid-1', subscriptionId: 1, imageUrl: null, sources: '["lastfm"]', createdAt: new Date(), status: 'pending', itemType: 'artist' },
      ]);
      // count calls in order: totalBeforeAggregationCap (parallel with findMany), addedToday, pending
      mockPrisma.subscriptionResult.count.mockResolvedValueOnce(1); // totalBeforeAggregationCap
      mockPrisma.subscriptionResult.count.mockResolvedValueOnce(3); // addedToday
      mockPrisma.subscriptionResult.count.mockResolvedValueOnce(5); // pending

      const service = new FeedService();
      const result = await service.getFeedForUser(123, { limit: 50, offset: 0 });

      expect(result.stats).toEqual({
        pending: 5,
        addedToday: 3,
      });
    });

    // Note: Tests for excluding already-approved/dismissed items are skipped
    // because the FeedItemAction table doesn't exist yet.
    // TODO: Add these tests after schema migration:
    // - it('excludes results user already approved')
    // - it('excludes results user already dismissed')
  });

  /**
   * Task 4: approve/dismiss Actions
   *
   * These methods allow users to act on feed items:
   * - approve: marks as 'added', removes from ReviewItem
   * - dismiss: marks as 'rejected', removes from ReviewItem
   *
   * Security: Users can only act on their own feed items (verified via subscription.userId)
   * Atomicity: All operations wrapped in transaction
   */
  describe('approve', () => {
    it('throws NotFoundError when feed item does not exist', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('feed-999', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws NotFoundError when feed ID format is invalid', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('invalid-id', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws ForbiddenError when feed item belongs to different user', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, artistName: 'Test', artistMbid: 'abc', subscription: { userId: 999 } },
          ]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.approve('feed-1', 1)).rejects.toThrow('Not authorized');
    });

    it('updates all linked SubscriptionResults to added status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 3 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 2, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 3, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1-2-3', 1);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2, 3] } },
        data: { status: 'added', processedAt: expect.any(Date) },
      });
    });

    it('deletes matching ReviewItems by MBID and name', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { mbid: 'abc-123' },
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('deletes ReviewItems by name only when no MBID', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: null, subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.approve('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('returns artistName on success', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Radiohead', mbid: 'radiohead-mbid', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      const result = await service.approve('feed-1', 1);

      expect(result).toEqual({ artistName: 'Radiohead' });
    });
  });

  /**
   * Task 10: Lidarr Integration on Approve
   *
   * After updating status to 'added', call Lidarr to add the artist.
   * This is non-blocking - Lidarr failures should not fail the approve action.
   */
  describe('approve with Lidarr integration', () => {
    it('calls Lidarr to add artist after updating status', async () => {
      const addArtistWithCacheWarm = vi.fn().mockResolvedValue({ artist: { id: 123 } });
      const mockLidarrService = { addArtistWithCacheWarm };
      const mockLidarrConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderPath: '/music',
        monitorOption: 'all',
        monitorNewItems: 'all',
      };
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };

      const service = new FeedService(
        mockPrismaClient as any,
        mockLidarrService as any,
        mockLidarrConfig as any
      );
      await service.approve('feed-1', 1);
      // Lidarr add is detached from the approve response; wait for it
      await service.pendingLidarrAdd;

      expect(addArtistWithCacheWarm).toHaveBeenCalledWith(
        'abc-123',
        1,  // qualityProfileId
        1,  // metadataProfileId
        '/music',  // rootFolderPath
        true,  // monitored
        true,  // searchForMissingAlbums
        false, // waitForRefresh
        'all', // monitorOption
        'all'  // monitorNewItems
      );
    });

    it('still succeeds if Lidarr call fails (logs warning)', async () => {
      const addArtistWithCacheWarm = vi.fn().mockRejectedValue(new Error('Lidarr unavailable'));
      const mockLidarrService = { addArtistWithCacheWarm };
      const mockLidarrConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderPath: '/music',
      };
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };

      const service = new FeedService(
        mockPrismaClient as any,
        mockLidarrService as any,
        mockLidarrConfig as any
      );

      // Should not throw - Lidarr failure is non-blocking
      await expect(service.approve('feed-1', 1)).resolves.toEqual({ artistName: 'Test Artist' });
      await service.pendingLidarrAdd;
      expect(addArtistWithCacheWarm).toHaveBeenCalled();
    });

    it('skips Lidarr if no MBID available', async () => {
      const addArtistWithCacheWarm = vi.fn();
      const mockLidarrService = { addArtistWithCacheWarm };
      const mockLidarrConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        qualityProfileId: 1,
        metadataProfileId: 1,
        rootFolderPath: '/music',
      };
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: null, subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };

      const service = new FeedService(
        mockPrismaClient as any,
        mockLidarrService as any,
        mockLidarrConfig as any
      );
      await service.approve('feed-1', 1);

      expect(addArtistWithCacheWarm).not.toHaveBeenCalled();
    });

    it('skips Lidarr if no LidarrService provided', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };

      // No LidarrService provided
      const service = new FeedService(mockPrismaClient as any);
      
      // Should complete without error
      await expect(service.approve('feed-1', 1)).resolves.toEqual({ artistName: 'Test Artist' });
    });

    it('skips Lidarr if config is incomplete (missing profile IDs)', async () => {
      const addArtistWithCacheWarm = vi.fn();
      const mockLidarrService = { addArtistWithCacheWarm };
      // Config missing qualityProfileId
      const incompleteConfig = {
        url: 'http://localhost:8686',
        apiKey: 'test-key',
        rootFolderPath: '/music',
        // qualityProfileId is missing!
        metadataProfileId: 1,
      };
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };

      const service = new FeedService(
        mockPrismaClient as any,
        mockLidarrService as any,
        incompleteConfig as any
      );
      await service.approve('feed-1', 1);
      await service.pendingLidarrAdd;

      // Should not call Lidarr due to incomplete config
      expect(addArtistWithCacheWarm).not.toHaveBeenCalled();
    });
  });

  describe('dismiss', () => {
    it('throws NotFoundError when feed item does not exist', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.dismiss('feed-999', 1)).rejects.toThrow('Feed item not found');
    });

    it('throws ForbiddenError when feed item belongs to different user', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 999 } },
          ]),
        },
      };
      const service = new FeedService(mockPrismaClient as any);

      await expect(service.dismiss('feed-1', 1)).rejects.toThrow('Not authorized');
    });

    it('updates all linked SubscriptionResults to rejected status', async () => {
      const updateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
            { id: 2, name: 'Test', mbid: 'abc', subscription: { userId: 1 } },
          ]),
          updateMany,
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.dismiss('feed-1-2', 1);

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { status: 'rejected', processedAt: expect.any(Date) },
      });
    });

    it('deletes matching ReviewItems', async () => {
      const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Test Artist', mbid: 'abc-123', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      await service.dismiss('feed-1', 1);

      expect(deleteMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { mbid: 'abc-123' },
            { artistName: 'Test Artist' },
          ],
        },
      });
    });

    it('returns artistName on success', async () => {
      const mockPrismaClient = {
        subscriptionResult: {
          findMany: vi.fn().mockResolvedValue([
            { id: 1, name: 'Coldplay', mbid: 'coldplay-mbid', subscription: { userId: 1 } },
          ]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        reviewItem: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        $transaction: vi.fn((fn: any) => fn(mockPrismaClient)),
      };
      const service = new FeedService(mockPrismaClient as any);

      const result = await service.dismiss('feed-1', 1);

      expect(result).toEqual({ artistName: 'Coldplay' });
    });
  });

  describe('metadata aggregation (tags, listeners)', () => {
    describe('parseTags', () => {
      it('parses JSON string tags into array', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          tags: '["rock", "alternative", "british"]',
          listeners: 1000000,
        }]);
        expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      });

      it('handles tags already as array', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          tags: ['rock', 'alternative'],
          listeners: 1000000,
        }] as any);
        expect(result[0].tags).toEqual(['rock', 'alternative']);
      });

      it('returns null for null/undefined tags', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          tags: null,
          listeners: null,
        }]);
        expect(result[0].tags).toBeNull();
      });

      it('returns null for invalid JSON tags', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          tags: 'not valid json',
          listeners: null,
        }]);
        expect(result[0].tags).toBeNull();
      });

      it('limits tags to first 3', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          tags: '["rock", "alternative", "british", "indie", "experimental"]',
          listeners: null,
        }]);
        expect(result[0].tags).toHaveLength(3);
        expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      });
    });

    describe('listener aggregation', () => {
      it('uses listeners value from primary result', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          listeners: 5000000,
        }]);
        expect(result[0].listeners).toBe(5000000);
      });

      it('returns null when no listeners data', () => {
        const service = new FeedService();
        const result = service.aggregateResults([{
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
        }]);
        expect(result[0].listeners).toBeNull();
      });

      it('takes max listeners when merging duplicates', () => {
        const service = new FeedService();
        const result = service.aggregateResults([
          {
            id: 1,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 1,
            sources: ['lastfm'],
            createdAt: new Date(),
            status: 'pending',
            listeners: 3000000,
          },
          {
            id: 2,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 2,
            sources: ['spotify'],
            createdAt: new Date(),
            status: 'pending',
            listeners: 5000000,
          },
        ]);
        expect(result[0].listeners).toBe(5000000);
      });
    });

    describe('metadata merging across duplicates', () => {
      it('merges tags from multiple results (unique only)', () => {
        const service = new FeedService();
        const result = service.aggregateResults([
          {
            id: 1,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 1,
            sources: ['lastfm'],
            createdAt: new Date(),
            status: 'pending',
            tags: '["rock", "alternative"]',
          },
          {
            id: 2,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 2,
            sources: ['spotify'],
            createdAt: new Date(),
            status: 'pending',
            tags: '["alternative", "british"]',
          },
        ]);
        expect(result[0].tags).toContain('rock');
        expect(result[0].tags).toContain('alternative');
        expect(result[0].tags).toContain('british');
        // No duplicates
        expect(result[0].tags?.filter(t => t === 'alternative')).toHaveLength(1);
      });

      it('prefers tags from result with MBID', () => {
        const service = new FeedService();
        const result = service.aggregateResults([
          {
            id: 1,
            artistName: 'beatles',
            artistMbid: null,
            subscriptionId: 1,
            sources: ['lastfm'],
            createdAt: new Date(),
            status: 'pending',
            tags: '["oldies"]',
          },
          {
            id: 2,
            artistName: 'The Beatles',
            artistMbid: 'beatles-mbid',
            subscriptionId: 2,
            sources: ['spotify'],
            createdAt: new Date(),
            status: 'pending',
            tags: '["rock", "british invasion", "pop"]',
          },
        ]);
        // Should use tags from the MBID result as primary source
        expect(result[0].tags).toContain('rock');
      });

      it('handles mixed null/non-null tags across results', () => {
        const service = new FeedService();
        const result = service.aggregateResults([
          {
            id: 1,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 1,
            sources: ['lastfm'],
            createdAt: new Date(),
            status: 'pending',
            tags: null,
          },
          {
            id: 2,
            artistName: 'Radiohead',
            artistMbid: 'abc-123',
            subscriptionId: 2,
            sources: ['spotify'],
            createdAt: new Date(),
            status: 'pending',
            tags: '["rock", "alternative"]',
          },
        ]);
        expect(result[0].tags).toEqual(['rock', 'alternative']);
      });
    });
  });

  describe('subscription name resolution', () => {
    it('uses subscriptionName when provided in single result', () => {
      const service = new FeedService();
      const result = service.aggregateResults([{
        id: 1,
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        subscriptionId: 1,
        sources: ['lastfm'],
        createdAt: new Date(),
        status: 'pending',
        subscriptionName: 'New Releases',
      }]);
      expect(result[0].subscriptionName).toBe('New Releases');
    });

    it('shows subscription name when all results from same subscription', () => {
      const service = new FeedService();
      const result = service.aggregateResults([
        {
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          subscriptionName: 'New Releases',
        },
        {
          id: 2,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['spotify'],
          createdAt: new Date(),
          status: 'pending',
          subscriptionName: 'New Releases',
        },
      ]);
      expect(result[0].subscriptionName).toBe('New Releases');
    });

    it('shows "Found in X subs" when results from multiple subscriptions', () => {
      const service = new FeedService();
      const result = service.aggregateResults([
        {
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          subscriptionName: 'New Releases',
        },
        {
          id: 2,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 2,
          sources: ['spotify'],
          createdAt: new Date(),
          status: 'pending',
          subscriptionName: 'Similar Artists',
        },
      ]);
      expect(result[0].subscriptionName).toBe('Found in 2 subs');
    });

    it('returns null when no subscriptionName provided', () => {
      const service = new FeedService();
      const result = service.aggregateResults([{
        id: 1,
        artistName: 'Radiohead',
        artistMbid: 'abc-123',
        subscriptionId: 1,
        sources: ['lastfm'],
        createdAt: new Date(),
        status: 'pending',
      }]);
      expect(result[0].subscriptionName).toBeNull();
    });

    it('handles mix of provided and missing subscriptionNames', () => {
      const service = new FeedService();
      const result = service.aggregateResults([
        {
          id: 1,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 1,
          sources: ['lastfm'],
          createdAt: new Date(),
          status: 'pending',
          subscriptionName: 'New Releases',
        },
        {
          id: 2,
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          subscriptionId: 2,
          sources: ['spotify'],
          createdAt: new Date(),
          status: 'pending',
          // No subscriptionName provided for this one
        },
      ]);
      // Should still show "Found in 2 subs" because different subscriptionIds
      expect(result[0].subscriptionName).toBe('Found in 2 subs');
    });
  });

  describe('enrichWithLastfm', () => {
    it('returns items unchanged when lastfmService is null', async () => {
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: 'Test Sub',
        },
      ];
      const result = await service.enrichWithLastfm(items, null);
      expect(result).toEqual(items);
      expect(result[0].tags).toBeNull();
      expect(result[0].listeners).toBeNull();
    });

    it('enriches items missing tags and listeners from Last.fm', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue({
          listeners: 5000000,
          playcount: 100000000,
          tags: ['alternative', 'rock', 'electronic'],
        }),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: 'Test Sub',
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      expect(result[0].tags).toEqual(['alternative', 'rock', 'electronic']);
      expect(result[0].listeners).toBe(5000000);
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Radiohead');
    });

    it('skips enrichment for items that already have tags and listeners', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn(),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: ['existing-tag'],
          listeners: 1000000,
          subscriptionName: 'Test Sub',
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      expect(result[0].tags).toEqual(['existing-tag']);
      expect(result[0].listeners).toBe(1000000);
      expect(mockLastfm.getArtistStats).not.toHaveBeenCalled();
    });

    it('enriches only items missing metadata, not those with data', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue({
          listeners: 3000000,
          playcount: 50000000,
          tags: ['pop', 'indie'],
        }),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Artist With Data',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: ['rock'],
          listeners: 2000000,
          subscriptionName: null,
        },
        {
          id: 'feed-2',
          artistName: 'Artist Without Data',
          artistMbid: 'def-456',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['spotify'],
          sourceCount: 1,
          linkedResultIds: [2],
          earliestFound: new Date(),
          score: 40,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      // First item unchanged (had data)
      expect(result[0].tags).toEqual(['rock']);
      expect(result[0].listeners).toBe(2000000);
      // Second item enriched
      expect(result[1].tags).toEqual(['pop', 'indie']);
      expect(result[1].listeners).toBe(3000000);
      // Only called once for the item missing data
      expect(mockLastfm.getArtistStats).toHaveBeenCalledTimes(1);
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Artist Without Data');
    });

    it('handles Last.fm API errors gracefully', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue(null),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Unknown Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      // Should remain null if API returns null
      expect(result[0].tags).toBeNull();
      expect(result[0].listeners).toBeNull();
    });

    it('limits tags to 3 from Last.fm response', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue({
          listeners: 1000000,
          playcount: 20000000,
          tags: ['rock', 'alternative', 'indie', 'british', 'electronic'],
        }),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Multi Tag Artist',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      expect(result[0].tags).toHaveLength(3);
      expect(result[0].tags).toEqual(['rock', 'alternative', 'indie']);
    });

    it('handles empty tags array from Last.fm', async () => {
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue({
          listeners: 500000,
          playcount: 10000000,
          tags: [],
        }),
      };
      const service = new FeedService();
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'No Tags Artist',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithLastfm(items, mockLastfm as any);
      // Empty tags from API should become null
      expect(result[0].tags).toBeNull();
      // But listeners should still be populated
      expect(result[0].listeners).toBe(500000);
    });
  });

  describe('enrichWithImages (cached)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('uses cached image URL and skips Deezer call', async () => {
      const mockCache = {
        get: vi.fn().mockResolvedValue('https://cached.deezer.com/img.jpg'),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBe('https://cached.deezer.com/img.jpg');
      expect(mockCache.get).toHaveBeenCalledWith('deezer:image:radiohead');
      expect(vi.mocked(fetchDeezerArtistImage)).not.toHaveBeenCalled();
    });

    it('skips Deezer call when miss sentinel is cached', async () => {
      const { CACHE_MISS_SENTINEL } = await import('../../src/services/cache.js');
      const mockCache = {
        get: vi.fn().mockResolvedValue(CACHE_MISS_SENTINEL),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'No Image Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBeNull();
      expect(mockCache.set).not.toHaveBeenCalled();
      expect(vi.mocked(fetchDeezerArtistImage)).not.toHaveBeenCalled();
    });

    it('calls Deezer on cache miss and caches the result', async () => {
      vi.mocked(fetchDeezerArtistImage).mockResolvedValue('https://deezer.com/fresh.jpg');
      const mockCache = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'New Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBe('https://deezer.com/fresh.jpg');
      expect(vi.mocked(fetchDeezerArtistImage)).toHaveBeenCalledWith('New Artist');
      expect(mockCache.set).toHaveBeenCalledWith(
        'deezer:image:newartist',
        'https://deezer.com/fresh.jpg',
        7 * 24 * 60 * 60
      );
    });

    it('caches miss when Deezer returns no result', async () => {
      vi.mocked(fetchDeezerArtistImage).mockResolvedValue(null);
      const mockCache = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Unknown Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBeNull();
      expect(mockCache.setMiss).toHaveBeenCalledWith(
        'deezer:image:unknownartist',
        60 * 60
      );
    });

    it('skips items that already have imageUrl (no cache check)', async () => {
      const mockCache = {
        get: vi.fn(),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Has Image',
          artistMbid: null,
          imageUrl: 'https://existing.com/img.jpg',
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBe('https://existing.com/img.jpg');
      expect(mockCache.get).not.toHaveBeenCalled();
    });

    it('falls through to Deezer when cache errors', async () => {
      vi.mocked(fetchDeezerArtistImage).mockResolvedValue('https://deezer.com/fallback.jpg');
      const mockCache = {
        get: vi.fn().mockRejectedValue(new Error('Redis down')),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Fallback Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBe('https://deezer.com/fallback.jpg');
      expect(vi.mocked(fetchDeezerArtistImage)).toHaveBeenCalled();
    });

    it('works without cacheService (backward compatible)', async () => {
      vi.mocked(fetchDeezerArtistImage).mockResolvedValue('https://deezer.com/nocache.jpg');
      const service = new FeedService(); // No cache
      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'No Cache Artist',
          artistMbid: null,
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 30,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];
      const result = await service.enrichWithImages(items);
      expect(result[0].imageUrl).toBe('https://deezer.com/nocache.jpg');
      expect(vi.mocked(fetchDeezerArtistImage)).toHaveBeenCalledWith('No Cache Artist');
    });
  });

  describe('enrichWithLastfm (cached)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const makeItem = (overrides: Partial<import('../../src/services/FeedService.js').AggregatedFeedItem> = {}): import('../../src/services/FeedService.js').AggregatedFeedItem => ({
      id: 'feed-1',
      artistName: 'Radiohead',
      artistMbid: 'abc-123',
      imageUrl: null,
      subscriptionCount: 1,
      sourceTypes: ['lastfm'],
      sourceCount: 1,
      linkedResultIds: [1],
      earliestFound: new Date(),
      score: 50,
      tags: null,
      listeners: null,
      subscriptionName: null,
      ...overrides,
    });

    it('uses cached stats and skips Last.fm call', async () => {
      const cachedStats = { listeners: 5000000, playcount: 100000000, tags: ['rock', 'alternative', 'british'] };
      const mockCache = {
        get: vi.fn().mockResolvedValue(cachedStats),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const mockLastfm = {
        getArtistStats: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].listeners).toBe(5000000);
      expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      expect(mockCache.get).toHaveBeenCalledWith('lastfm:stats:radiohead');
      expect(mockLastfm.getArtistStats).not.toHaveBeenCalled();
    });

    it('skips Last.fm call when miss sentinel is cached', async () => {
      const { CACHE_MISS_SENTINEL } = await import('../../src/services/cache.js');
      const mockCache = {
        get: vi.fn().mockResolvedValue(CACHE_MISS_SENTINEL),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const mockLastfm = {
        getArtistStats: vi.fn(),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].tags).toBeNull();
      expect(result[0].listeners).toBeNull();
      expect(mockLastfm.getArtistStats).not.toHaveBeenCalled();
    });

    it('calls Last.fm on cache miss and caches the result', async () => {
      const apiStats = { listeners: 5000000, playcount: 100000000, tags: ['rock', 'alternative', 'british'] };
      const mockCache = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue(apiStats),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].listeners).toBe(5000000);
      expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Radiohead');
      expect(mockCache.set).toHaveBeenCalledWith(
        'lastfm:stats:radiohead',
        apiStats,
        24 * 60 * 60
      );
    });

    it('caches miss when Last.fm returns null', async () => {
      const mockCache = {
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue(null),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].tags).toBeNull();
      expect(result[0].listeners).toBeNull();
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Radiohead');
      expect(mockCache.setMiss).toHaveBeenCalledWith(
        'lastfm:stats:radiohead',
        60 * 60
      );
    });

    it('works without cacheService (backward compatible)', async () => {
      const apiStats = { listeners: 5000000, playcount: 100000000, tags: ['rock', 'alternative', 'british'] };
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue(apiStats),
      };
      const service = new FeedService(); // No cache
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].listeners).toBe(5000000);
      expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Radiohead');
    });

    it('falls through to Last.fm when cache errors', async () => {
      const apiStats = { listeners: 5000000, playcount: 100000000, tags: ['rock', 'alternative', 'british'] };
      const mockCache = {
        get: vi.fn().mockRejectedValue(new Error('Redis down')),
        set: vi.fn(),
        setMiss: vi.fn(),
      };
      const mockLastfm = {
        getArtistStats: vi.fn().mockResolvedValue(apiStats),
      };
      const service = new FeedService(undefined, undefined, undefined, mockCache as any);
      const items = [makeItem()];

      const result = await service.enrichWithLastfm(items, mockLastfm as any);

      expect(result[0].listeners).toBe(5000000);
      expect(result[0].tags).toEqual(['rock', 'alternative', 'british']);
      expect(mockLastfm.getArtistStats).toHaveBeenCalledWith('Radiohead');
    });
  });

  describe('persistEnrichment', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('updates SubscriptionResult rows with enriched image data', async () => {
      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
      const mockPrismaInstance = {
        subscriptionResult: { updateMany: mockUpdateMany },
      };
      const service = new FeedService(mockPrismaInstance as any);

      const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1-2',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1, 2],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];

      const after = [{ ...before[0], imageUrl: 'https://cdn.deezer.com/img.jpg' }];

      await service.persistEnrichment(before, after);

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: [1, 2] } },
        data: { imageUrl: 'https://cdn.deezer.com/img.jpg' },
      });
    });

    it('updates SubscriptionResult rows with enriched tags and listeners', async () => {
      const mockUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
      const mockPrismaInstance = {
        subscriptionResult: { updateMany: mockUpdateMany },
      };
      const service = new FeedService(mockPrismaInstance as any);

      const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: 'https://existing.com/img.jpg',
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];

      const after = [{ ...before[0], tags: ['rock', 'alternative'], listeners: 5000000 }];

      await service.persistEnrichment(before, after);

      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: { id: { in: [1] } },
        data: { tags: JSON.stringify(['rock', 'alternative']), listeners: 5000000 },
      });
    });

    it('does nothing when no items were enriched', async () => {
      const mockUpdateMany = vi.fn();
      const mockPrismaInstance = {
        subscriptionResult: { updateMany: mockUpdateMany },
      };
      const service = new FeedService(mockPrismaInstance as any);

      const items: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];

      // Before and after identical — no enrichment happened
      await service.persistEnrichment(items, items);

      expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('does not throw when DB update fails', async () => {
      const mockUpdateMany = vi.fn().mockRejectedValue(new Error('DB connection lost'));
      const mockPrismaInstance = {
        subscriptionResult: { updateMany: mockUpdateMany },
      };
      const service = new FeedService(mockPrismaInstance as any);

      const before: import('../../src/services/FeedService.js').AggregatedFeedItem[] = [
        {
          id: 'feed-1',
          artistName: 'Radiohead',
          artistMbid: 'abc-123',
          imageUrl: null,
          subscriptionCount: 1,
          sourceTypes: ['lastfm'],
          sourceCount: 1,
          linkedResultIds: [1],
          earliestFound: new Date(),
          score: 50,
          tags: null,
          listeners: null,
          subscriptionName: null,
        },
      ];

      const after = [{ ...before[0], imageUrl: 'https://cdn.deezer.com/img.jpg' }];

      // Should not throw
      await expect(service.persistEnrichment(before, after)).resolves.toBeUndefined();
    });
  });
});
