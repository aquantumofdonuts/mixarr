import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findOrCreateReviewItem } from '../../src/utils/review-queue.js';

// Mock prisma
vi.mock('../../src/lib/db.js', () => ({
  default: {
    reviewItem: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import prisma from '../../src/lib/db.js';

const mockPrisma = prisma as unknown as {
  reviewItem: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

describe('findOrCreateReviewItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when matching by MBID', () => {
    it('finds existing item by MBID and updates sources', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValueOnce({
        id: 1,
        mbid: 'mbid-123',
        source: 'import-spotify',
        artistName: 'Test Artist',
      });
      mockPrisma.reviewItem.update.mockResolvedValue({});

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'Test Artist',
        mbid: 'mbid-123',
        source: 'subscription:weekly',
      });

      expect(result.id).toBe(1);
      expect(result.created).toBe(false);
      expect(mockPrisma.reviewItem.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { source: 'import-spotify, subscription:weekly' },
      });
    });

    it('does not duplicate source if already present', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValueOnce({
        id: 1,
        mbid: 'mbid-123',
        source: 'import-spotify, subscription:weekly',
        artistName: 'Test Artist',
      });

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'Test Artist',
        mbid: 'mbid-123',
        source: 'subscription:weekly',
      });

      expect(result.id).toBe(1);
      expect(result.created).toBe(false);
      expect(mockPrisma.reviewItem.update).not.toHaveBeenCalled();
    });
  });

  describe('when matching by SpotifyId', () => {
    it('finds existing item by SpotifyId when no MBID match', async () => {
      // No MBID match
      mockPrisma.reviewItem.findFirst
        .mockResolvedValueOnce(null) // MBID search
        .mockResolvedValueOnce({     // SpotifyId search
          id: 2,
          spotifyId: 'spotify-123',
          source: 'import-liked',
          artistName: 'Test Artist',
        });
      mockPrisma.reviewItem.update.mockResolvedValue({});

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'Test Artist',
        spotifyId: 'spotify-123',
        mbid: 'new-mbid',
        source: 'subscription:daily',
      });

      expect(result.id).toBe(2);
      expect(result.created).toBe(false);
      expect(mockPrisma.reviewItem.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: {
          source: 'import-liked, subscription:daily',
          mbid: 'new-mbid', // Fill in MBID
        },
      });
    });
  });

  describe('when matching by normalized artist name', () => {
    it('matches "The Beatles" to "Beatles"', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
      mockPrisma.reviewItem.findMany.mockResolvedValue([
        { id: 3, artistName: 'The Beatles', source: 'import-1', status: 'pending' },
      ]);
      mockPrisma.reviewItem.update.mockResolvedValue({});

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'Beatles',
        source: 'subscription:weekly',
      });

      expect(result.id).toBe(3);
      expect(result.created).toBe(false);
    });

    it('matches "AC/DC" to "ACDC"', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
      mockPrisma.reviewItem.findMany.mockResolvedValue([
        { id: 4, artistName: 'AC/DC', source: 'import-1', status: 'pending' },
      ]);
      mockPrisma.reviewItem.update.mockResolvedValue({});

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'ACDC',
        source: 'subscription:weekly',
      });

      expect(result.id).toBe(4);
      expect(result.created).toBe(false);
    });
  });

  describe('when no match found', () => {
    it('creates new item when no match found', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
      mockPrisma.reviewItem.findMany.mockResolvedValue([]);
      mockPrisma.reviewItem.create.mockResolvedValue({ id: 5 });

      const result = await findOrCreateReviewItem({
        userId: 1,
        artistName: 'New Artist',
        source: 'import-spotify',
      });

      expect(result.id).toBe(5);
      expect(result.created).toBe(true);
      expect(mockPrisma.reviewItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 1,
          artistName: 'New Artist',
          source: 'import-spotify',
          status: 'pending',
        }),
      });
    });

    it('includes optional fields when provided', async () => {
      mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
      mockPrisma.reviewItem.findMany.mockResolvedValue([]);
      mockPrisma.reviewItem.create.mockResolvedValue({ id: 6 });

      await findOrCreateReviewItem({
        userId: 1,
        artistName: 'New Artist',
        mbid: 'mbid-456',
        spotifyId: 'spotify-789',
        albumName: 'Great Album',
        releaseYear: 2024,
        source: 'import-spotify',
      });

      expect(mockPrisma.reviewItem.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          artistName: 'New Artist',
          mbid: 'mbid-456',
          spotifyId: 'spotify-789',
          albumName: 'Great Album',
          releaseYear: 2024,
          source: 'import-spotify',
          status: 'pending',
          itemType: 'artist',
        },
      });
    });

    it('includes all album fields including artistMbid and albumMbid', async () => {
      // Regression test: ensure album items preserve MBID fields
      // Bug: subscription worker was not passing artistMbid to review queue
      mockPrisma.reviewItem.findFirst.mockResolvedValue(null);
      mockPrisma.reviewItem.findMany.mockResolvedValue([]);
      mockPrisma.reviewItem.create.mockResolvedValue({ id: 7 });

      await findOrCreateReviewItem({
        userId: 1,
        artistName: 'Pink Floyd',
        mbid: 'artist-mbid-123',  // artistMbid from subscription
        albumName: 'The Wall',
        albumMbid: 'album-mbid-456',
        releaseYear: 1979,
        releaseDate: '1979-11-30',
        releaseType: 'album',
        source: 'subscription:musicbrainz-new',
        itemType: 'album',
      });

      expect(mockPrisma.reviewItem.create).toHaveBeenCalledWith({
        data: {
          userId: 1,
          artistName: 'Pink Floyd',
          mbid: 'artist-mbid-123',
          spotifyId: undefined,
          albumName: 'The Wall',
          albumMbid: 'album-mbid-456',
          releaseYear: 1979,
          releaseDate: '1979-11-30',
          releaseType: 'album',
          source: 'subscription:musicbrainz-new',
          status: 'pending',
          itemType: 'album',
        },
      });
    });
  });
});
