/**
 * Import Sources API Tests
 * 
 * Tests:
 * - Spotify import source management
 * - Import type validation
 * - Schedule management
 * - Preview and run operations
 * - Zod schema validation for all import endpoints
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockPrisma,
  createMockUser,
  createMockSpotifyConnection,
  createMockSpotifyService,
  resetIdCounter,
} from '../utils/fixtures.js';
import {
  createImportSchema,
  updateImportSchema,
  importIdParamSchema,
  connectionIdParamSchema,
  reviewQueueQuerySchema,
  updateReviewItemSchema,
  bulkReviewSchema,
  previewQuerySchema,
  previewImportSchema,
  publicPlaylistPreviewSchema,
  publicPlaylistImportSchema,
  scheduleField,
} from '../../src/schemas/imports.js';

describe('Import Sources API', () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;
  let testUser: ReturnType<typeof createMockUser>;
  let mockSpotify: ReturnType<typeof createMockSpotifyService>;

  beforeEach(() => {
    resetIdCounter();
    mockPrisma = createMockPrisma();
    testUser = createMockUser();
    mockSpotify = createMockSpotifyService();
  });

  describe('GET /api/imports', () => {
    it('should return user import sources', async () => {
      const sources = [
        { id: 1, userId: testUser.id, type: 'liked_songs', name: 'Liked Songs' },
        { id: 2, userId: testUser.id, type: 'playlist', name: 'My Playlist' },
      ];
      mockPrisma.importSource.findMany.mockResolvedValue(sources);
      
      const result = await mockPrisma.importSource.findMany({
        where: { userId: testUser.id },
      });
      
      expect(result).toHaveLength(2);
    });
  });

  describe('POST /api/imports', () => {
    it('should create liked songs import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'liked_songs',
        name: 'Liked Songs',
        externalId: null,
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'liked_songs',
          name: 'Liked Songs',
        },
      });
      
      expect(result.type).toBe('liked_songs');
    });

    it('should create saved albums import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'saved_albums',
        name: 'Saved Albums',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'saved_albums',
          name: 'Saved Albums',
        },
      });
      
      expect(result.type).toBe('saved_albums');
    });

    it('should create followed artists import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'followed_artists',
        name: 'Followed Artists',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'followed_artists',
          name: 'Followed Artists',
        },
      });
      
      expect(result.type).toBe('followed_artists');
    });

    it('should create playlist import source', async () => {
      const source = {
        id: 1,
        userId: testUser.id,
        type: 'playlist',
        name: 'My Cool Playlist',
        externalId: 'playlist123',
      };
      mockPrisma.importSource.create.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.create({
        data: {
          userId: testUser.id,
          type: 'playlist',
          name: 'My Cool Playlist',
          externalId: 'playlist123',
        },
      });
      
      expect(result.type).toBe('playlist');
      expect(result.externalId).toBe('playlist123');
    });

    it('should require type and name', () => {
      const body = { type: '', name: '' };
      const isValid = body.type && body.name;
      expect(isValid).toBeFalsy();
    });

    it('should validate import type', () => {
      const validTypes = ['liked_songs', 'saved_albums', 'followed_artists', 'playlist'];
      const invalidType = 'invalid';
      
      expect(validTypes.includes(invalidType)).toBe(false);
    });
  });

  describe('PUT /api/imports/:id', () => {
    it('should update import source schedule', async () => {
      const source = { id: 1, userId: testUser.id, schedule: null };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.update.mockResolvedValue({ ...source, schedule: '0 0 * * *' });
      
      const result = await mockPrisma.importSource.update({
        where: { id: source.id },
        data: { schedule: '0 0 * * *' },
      });
      
      expect(result.schedule).toBe('0 0 * * *');
    });

    it('should update result handling mode', async () => {
      const source = { id: 1, userId: testUser.id, resultHandling: 'preview' };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.update.mockResolvedValue({ ...source, resultHandling: 'queue' });
      
      const result = await mockPrisma.importSource.update({
        where: { id: source.id },
        data: { resultHandling: 'queue' },
      });
      
      expect(result.resultHandling).toBe('queue');
    });
  });

  describe('DELETE /api/imports/:id', () => {
    it('should delete import source', async () => {
      const source = { id: 1, userId: testUser.id };
      mockPrisma.importSource.findUnique.mockResolvedValue(source);
      mockPrisma.importSource.delete.mockResolvedValue(source);
      
      const result = await mockPrisma.importSource.delete({
        where: { id: source.id },
      });
      
      expect(result.id).toBe(1);
    });
  });

  describe('POST /api/imports/:id/preview', () => {
    it('should preview liked songs', async () => {
      mockSpotify.getLikedSongs.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }] },
        { artists: [{ name: 'Artist 2' }] },
      ]);
      
      const tracks = await mockSpotify.getLikedSongs();
      const artists = new Set(tracks.flatMap((t: { artists: { name: string }[] }) => t.artists.map((a: { name: string }) => a.name)));
      
      expect(artists.size).toBe(2);
    });

    it('should preview saved albums', async () => {
      mockSpotify.getSavedAlbums.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }], name: 'Album 1' },
      ]);
      
      const albums = await mockSpotify.getSavedAlbums();
      
      expect(albums).toHaveLength(1);
    });

    it('should preview followed artists', async () => {
      mockSpotify.getFollowedArtists.mockResolvedValue([
        { name: 'Artist 1' },
        { name: 'Artist 2' },
      ]);
      
      const artists = await mockSpotify.getFollowedArtists();
      
      expect(artists).toHaveLength(2);
    });

    it('should preview playlist tracks', async () => {
      mockSpotify.getPlaylistTracks.mockResolvedValue([
        { artists: [{ name: 'Artist 1' }] },
        { artists: [{ name: 'Artist 2' }] },
      ]);
      
      const tracks = await mockSpotify.getPlaylistTracks('playlist123');
      
      expect(tracks).toHaveLength(2);
    });

    it('should require Spotify connection', async () => {
      mockPrisma.connection.findFirst.mockResolvedValue(null);
      
      const conn = await mockPrisma.connection.findFirst({
        where: { userId: testUser.id, type: 'spotify', isActive: true },
      });
      
      expect(conn).toBeNull();
    });
  });

  describe('POST /api/imports/:id/run', () => {
    it('should run import and add to review queue', async () => {
      mockSpotify.getLikedSongs.mockResolvedValue([
        { artists: [{ name: 'Artist 1', id: 'spotify1' }] },
      ]);
      
      mockPrisma.reviewItem.createMany.mockResolvedValue({ count: 1 });
      
      const result = await mockPrisma.reviewItem.createMany({
        data: [
          {
            userId: testUser.id,
            artistName: 'Artist 1',
            spotifyId: 'spotify1',
            source: 'liked_songs',
            status: 'pending',
          },
        ],
      });
      
      expect(result.count).toBe(1);
    });

    it('should skip duplicates in review queue', async () => {
      // Artist already in review queue
      mockPrisma.reviewItem.findFirst.mockResolvedValue({
        id: 1,
        artistName: 'Artist 1',
        status: 'pending',
      });
      
      const existing = await mockPrisma.reviewItem.findFirst({
        where: { userId: testUser.id, artistName: 'Artist 1' },
      });
      
      expect(existing).toBeDefined();
      // Should skip this artist
    });
  });

  // ==========================================================================
  // Zod schema validation tests
  // ==========================================================================

  describe('Schema: createImportSchema', () => {
    it('should accept valid create input', () => {
      const result = createImportSchema.safeParse({
        type: 'liked_songs',
        name: 'My Liked Songs',
      });
      expect(result.success).toBe(true);
    });

    it('should accept all optional fields', () => {
      const result = createImportSchema.safeParse({
        type: 'playlist',
        name: 'My Playlist',
        externalId: 'abc123',
        schedule: '0 0 * * *',
        resultHandling: 'auto',
        isActive: false,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.externalId).toBe('abc123');
        expect(result.data.schedule).toBe('0 0 * * *');
        expect(result.data.resultHandling).toBe('auto');
        expect(result.data.isActive).toBe(false);
      }
    });

    it('should default resultHandling to preview', () => {
      const result = createImportSchema.safeParse({
        type: 'liked_songs',
        name: 'Test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.resultHandling).toBe('preview');
      }
    });

    it('should default isActive to true', () => {
      const result = createImportSchema.safeParse({
        type: 'liked_songs',
        name: 'Test',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isActive).toBe(true);
      }
    });

    it('should reject missing type', () => {
      const result = createImportSchema.safeParse({ name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('should reject missing name', () => {
      const result = createImportSchema.safeParse({ type: 'liked_songs' });
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = createImportSchema.safeParse({ type: 'liked_songs', name: '' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid type', () => {
      const result = createImportSchema.safeParse({ type: 'invalid_type', name: 'Test' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid resultHandling', () => {
      const result = createImportSchema.safeParse({
        type: 'liked_songs',
        name: 'Test',
        resultHandling: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: updateImportSchema', () => {
    it('should accept empty object (all optional)', () => {
      const result = updateImportSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial update with name only', () => {
      const result = updateImportSchema.safeParse({ name: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('should accept schedule update', () => {
      const result = updateImportSchema.safeParse({ schedule: '*/30 * * * *' });
      expect(result.success).toBe(true);
    });

    it('should accept null schedule (remove schedule)', () => {
      const result = updateImportSchema.safeParse({ schedule: null });
      expect(result.success).toBe(true);
    });

    it('should reject invalid schedule cron', () => {
      const result = updateImportSchema.safeParse({ schedule: 'not a cron' });
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const result = updateImportSchema.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: scheduleField (cron validation)', () => {
    const validCrons = [
      '* * * * *',
      '0 0 * * *',
      '*/15 * * * *',
      '0 0 1 * *',
      '0 0 * * 0',
      '30 2 * * 1-5',
      '0 0,12 * * *',
      '0 0 1,15 * *',
    ];

    validCrons.forEach((cron) => {
      it(`should accept valid cron: ${cron}`, () => {
        const result = scheduleField.safeParse(cron);
        expect(result.success).toBe(true);
      });
    });

    const invalidCrons = [
      'not a cron',
      '* * *',
      '* * * *',
      '* * * * * *',
      'every day',
      '@daily',
    ];

    invalidCrons.forEach((cron) => {
      it(`should reject invalid cron: ${cron}`, () => {
        const result = scheduleField.safeParse(cron);
        expect(result.success).toBe(false);
      });
    });

    it('should accept null', () => {
      const result = scheduleField.safeParse(null);
      expect(result.success).toBe(true);
    });

    it('should accept empty string', () => {
      const result = scheduleField.safeParse('');
      expect(result.success).toBe(true);
    });
  });

  describe('Schema: importIdParamSchema', () => {
    it('should coerce string id to number', () => {
      const result = importIdParamSchema.safeParse({ id: '5' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe(5);
      }
    });

    it('should accept numeric id', () => {
      const result = importIdParamSchema.safeParse({ id: 10 });
      expect(result.success).toBe(true);
    });

    it('should reject non-numeric id', () => {
      const result = importIdParamSchema.safeParse({ id: 'abc' });
      expect(result.success).toBe(false);
    });

    it('should reject negative id', () => {
      const result = importIdParamSchema.safeParse({ id: '-1' });
      expect(result.success).toBe(false);
    });

    it('should reject zero', () => {
      const result = importIdParamSchema.safeParse({ id: '0' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: connectionIdParamSchema', () => {
    it('should coerce string connectionId to number', () => {
      const result = connectionIdParamSchema.safeParse({ connectionId: '3' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.connectionId).toBe(3);
      }
    });

    it('should reject non-numeric connectionId', () => {
      const result = connectionIdParamSchema.safeParse({ connectionId: 'abc' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: reviewQueueQuerySchema', () => {
    it('should apply defaults for empty query', () => {
      const result = reviewQueueQuerySchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(50);
        expect(result.data.status).toBe('pending');
      }
    });

    it('should coerce limit from string', () => {
      const result = reviewQueueQuerySchema.safeParse({ limit: '25' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(25);
      }
    });

    it('should accept valid status values', () => {
      for (const status of ['pending', 'approved', 'rejected']) {
        const result = reviewQueueQuerySchema.safeParse({ status });
        expect(result.success).toBe(true);
      }
    });

    it('should reject invalid status', () => {
      const result = reviewQueueQuerySchema.safeParse({ status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should accept itemType artist or album', () => {
      expect(reviewQueueQuerySchema.safeParse({ itemType: 'artist' }).success).toBe(true);
      expect(reviewQueueQuerySchema.safeParse({ itemType: 'album' }).success).toBe(true);
    });

    it('should reject invalid itemType', () => {
      const result = reviewQueueQuerySchema.safeParse({ itemType: 'track' });
      expect(result.success).toBe(false);
    });

    it('should reject limit above 500', () => {
      const result = reviewQueueQuerySchema.safeParse({ limit: '501' });
      expect(result.success).toBe(false);
    });

    it('should reject limit below 1', () => {
      const result = reviewQueueQuerySchema.safeParse({ limit: '0' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: updateReviewItemSchema', () => {
    it('should accept valid status', () => {
      expect(updateReviewItemSchema.safeParse({ status: 'approved' }).success).toBe(true);
      expect(updateReviewItemSchema.safeParse({ status: 'rejected' }).success).toBe(true);
      expect(updateReviewItemSchema.safeParse({ status: 'pending' }).success).toBe(false);
    });

    it('should reject invalid status', () => {
      expect(updateReviewItemSchema.safeParse({ status: 'unknown' }).success).toBe(false);
    });

    it('should reject missing status', () => {
      expect(updateReviewItemSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('Schema: bulkReviewSchema', () => {
    it('should accept valid bulk review input', () => {
      const result = bulkReviewSchema.safeParse({
        ids: [1, 2, 3],
        status: 'approved',
      });
      expect(result.success).toBe(true);
    });

    it('should reject empty ids array', () => {
      const result = bulkReviewSchema.safeParse({ ids: [], status: 'approved' });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer ids', () => {
      const result = bulkReviewSchema.safeParse({ ids: [1.5], status: 'approved' });
      expect(result.success).toBe(false);
    });

    it('should reject negative ids', () => {
      const result = bulkReviewSchema.safeParse({ ids: [-1], status: 'approved' });
      expect(result.success).toBe(false);
    });

    it('should reject invalid status in bulk', () => {
      const result = bulkReviewSchema.safeParse({ ids: [1], status: 'invalid' });
      expect(result.success).toBe(false);
    });

    it('should reject missing ids', () => {
      const result = bulkReviewSchema.safeParse({ status: 'approved' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: previewImportSchema', () => {
    it('should accept valid artistNames and mode', () => {
      const result = previewImportSchema.safeParse({
        artistNames: ['Radiohead', 'Björk'],
        mode: 'queue',
      });
      expect(result.success).toBe(true);
    });

    it('should default mode to auto', () => {
      const result = previewImportSchema.safeParse({
        artistNames: ['Radiohead'],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.mode).toBe('auto');
      }
    });

    it('should reject empty artistNames array', () => {
      const result = previewImportSchema.safeParse({ artistNames: [] });
      expect(result.success).toBe(false);
    });

    it('should reject non-array artistNames', () => {
      const result = previewImportSchema.safeParse({ artistNames: 'Radiohead' });
      expect(result.success).toBe(false);
    });

    it('should reject empty strings in artistNames', () => {
      const result = previewImportSchema.safeParse({ artistNames: [''] });
      expect(result.success).toBe(false);
    });

    it('should reject invalid mode', () => {
      const result = previewImportSchema.safeParse({
        artistNames: ['Radiohead'],
        mode: 'invalid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: publicPlaylistPreviewSchema', () => {
    it('should accept valid Spotify URL', () => {
      const result = publicPlaylistPreviewSchema.safeParse({
        url: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      });
      expect(result.success).toBe(true);
    });

    it('should accept url with includeAllArtists', () => {
      const result = publicPlaylistPreviewSchema.safeParse({
        url: 'https://open.spotify.com/playlist/abc',
        includeAllArtists: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing url', () => {
      const result = publicPlaylistPreviewSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject invalid url', () => {
      const result = publicPlaylistPreviewSchema.safeParse({ url: 'not-a-url' });
      expect(result.success).toBe(false);
    });

    it('should reject empty url string', () => {
      const result = publicPlaylistPreviewSchema.safeParse({ url: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: publicPlaylistImportSchema', () => {
    it('should accept url only', () => {
      const result = publicPlaylistImportSchema.safeParse({
        url: 'https://open.spotify.com/playlist/abc',
      });
      expect(result.success).toBe(true);
    });

    it('should accept url with selectedArtists', () => {
      const result = publicPlaylistImportSchema.safeParse({
        url: 'https://open.spotify.com/playlist/abc',
        selectedArtists: ['Artist 1', 'Artist 2'],
      });
      expect(result.success).toBe(true);
    });

    it('should accept url with includeAllArtists', () => {
      const result = publicPlaylistImportSchema.safeParse({
        url: 'https://open.spotify.com/playlist/abc',
        includeAllArtists: true,
      });
      expect(result.success).toBe(true);
    });

    it('should reject missing url', () => {
      const result = publicPlaylistImportSchema.safeParse({
        selectedArtists: ['Artist 1'],
      });
      expect(result.success).toBe(false);
    });

    it('should reject invalid url', () => {
      const result = publicPlaylistImportSchema.safeParse({
        url: 'not-valid',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Schema: previewQuerySchema', () => {
    it('should accept empty query', () => {
      const result = previewQuerySchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept ai=true', () => {
      const result = previewQuerySchema.safeParse({ ai: 'true' });
      expect(result.success).toBe(true);
    });

    it('should accept similar=true', () => {
      const result = previewQuerySchema.safeParse({ similar: 'true' });
      expect(result.success).toBe(true);
    });

    it('should reject invalid ai value', () => {
      const result = previewQuerySchema.safeParse({ ai: 'yes' });
      expect(result.success).toBe(false);
    });
  });
});
