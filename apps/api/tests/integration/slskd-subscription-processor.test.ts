import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { SlskdSubscriptionProcessor } from "../../src/services/slskd-subscription-processor";
import { SlskdService } from "../../src/services/slskd-service";
import * as queueModule from "../../src/jobs/slskd-operations-queue";

const prisma = new PrismaClient();

describe("SlskdSubscriptionProcessor - Per-File Download Model", () => {
  let processor: SlskdSubscriptionProcessor;
  let mockSlskdService: {
    createSearch: ReturnType<typeof vi.fn>;
    getSearch: ReturnType<typeof vi.fn>;
    queueDownload: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Clean up test data
    await prisma.slskdDownload.deleteMany({});

    // Disable rate limiting by default for tests (can be overridden in specific tests)
    await prisma.$executeRaw`
      INSERT INTO global_settings (\`key\`, \`value\`, \`created_at\`, \`updated_at\`) 
      VALUES ('slskd_rate_limiting_enabled', 'false', NOW(), NOW())
      ON DUPLICATE KEY UPDATE \`value\` = 'false', \`updated_at\` = NOW()
    `;

    // Mock slskd service
    mockSlskdService = {
      createSearch: vi.fn(),
      getSearch: vi.fn(),
      queueDownload: vi.fn(),
    };

    processor = new SlskdSubscriptionProcessor(
      prisma,
      mockSlskdService as unknown as SlskdService,
      { retryDelay: 100 }, // Use short delay for tests
    );
  });

  // Clean up processor resources after each test.
  afterEach(async () => {
    if (processor) {
      await processor.close();
    }
  });

  it("should create one SlskdDownload record per file", async () => {
    const mockFiles = [
      {
        filename: "01 - Test Song 1.flac",
        size: 30000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: "02 - Test Song 2.flac",
        size: 28000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: "03 - Test Song 3.flac",
        size: 32000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
    ];

    // Mock search creation
    mockSlskdService.createSearch.mockResolvedValue({ id: 1 });

    // Mock search results with 3 files
    mockSlskdService.getSearch.mockResolvedValue({
      id: 1,
      state: "Completed",
      responses: [
        {
          username: "testuser",
          files: mockFiles,
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    mockSlskdService.queueDownload.mockResolvedValue(undefined);

    const result = await processor.processArtist(
      { name: "Test Artist", album: "Test Album" },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
    );

    expect(result.status).toBe("queued");

    // Should create 3 download records (one per file)
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: "Test Artist", albumName: "Test Album" },
    });

    expect(downloads).toHaveLength(3);
    expect(downloads[0].filename).toBe("01 - Test Song 1.flac");
    expect(downloads[0].fileSize).toBe(BigInt(30000000));
    expect(downloads[1].filename).toBe("02 - Test Song 2.flac");
    expect(downloads[1].fileSize).toBe(BigInt(28000000));
    expect(downloads[2].filename).toBe("03 - Test Song 3.flac");
    expect(downloads[2].fileSize).toBe(BigInt(32000000));
  });

  it("should handle empty file array without creating records", async () => {
    // Mock search with no files
    mockSlskdService.createSearch.mockResolvedValue({ id: 2 });
    mockSlskdService.getSearch.mockResolvedValue({
      id: 2,
      state: "Completed",
      responses: [
        {
          username: "testuser",
          files: [], // Empty files array
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    const result = await processor.processArtist(
      { name: "Empty Artist", album: "Empty Album" },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
    );

    expect(result.status).toBe("no_results");

    // Should create zero records
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: "Empty Artist", albumName: "Empty Album" },
    });

    expect(downloads).toHaveLength(0);
  });

  it("should wrap per-file creation in transaction for atomicity", async () => {
    const mockFiles = [
      {
        filename: "track1.flac",
        size: 30000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: "track2.flac",
        size: 28000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
    ];

    mockSlskdService.createSearch.mockResolvedValue({ id: 3 });
    mockSlskdService.getSearch.mockResolvedValue({
      id: 3,
      state: "Completed",
      responses: [
        {
          username: "testuser",
          files: mockFiles,
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    // Mock a failure on queue to test error handling
    mockSlskdService.queueDownload.mockRejectedValueOnce(
      new Error("Queue failed"),
    );

    const result = await processor.processArtist(
      { name: "Transaction Test", album: "Test Album" },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
    );

    // Should return error status instead of throwing
    expect(result.status).toBe("error");
    expect(result.error).toBe("Queue failed");

    // Downloads should be created but marked as failed
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: "Transaction Test", albumName: "Test Album" },
    });

    expect(downloads).toHaveLength(2);
    expect(downloads.every((d) => d.status === "failed")).toBe(true);
  });

  it("should mark downloads as failed if queue operation fails", async () => {
    const mockFiles = [
      {
        filename: "track1.flac",
        size: 30000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
      {
        filename: "track2.flac",
        size: 28000000,
        extension: ".flac",
        bitRate: 1411,
        sampleRate: 44100,
        bitDepth: 16,
      },
    ];

    mockSlskdService.createSearch.mockResolvedValue({ id: 4 });
    mockSlskdService.getSearch.mockResolvedValue({
      id: 4,
      state: "Completed",
      responses: [
        {
          username: "testuser",
          files: mockFiles,
          uploadSpeed: 1000000,
          queueLength: 5,
          hasFreeUploadSlot: true,
        },
      ],
    });

    // Mock queue failure
    mockSlskdService.queueDownload.mockRejectedValue(
      new Error("Network timeout"),
    );

    const result = await processor.processArtist(
      { name: "Failed Queue Test", album: "Test Album" },
      { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
    );

    expect(result.status).toBe("error");

    // Downloads should exist but marked as failed
    const downloads = await prisma.slskdDownload.findMany({
      where: { artistName: "Failed Queue Test", albumName: "Test Album" },
    });

    expect(downloads).toHaveLength(2);
    expect(downloads.every((d) => d.status === "failed")).toBe(true);
  });

  describe("Search Retry Logic", () => {
    it("should retry on timeout error and succeed on 2nd attempt", async () => {
      const mockFiles = [
        {
          filename: "01 - Test Song.flac",
          size: 30000000,
          extension: ".flac",
          bitRate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        },
      ];

      // Mock search creation
      mockSlskdService.createSearch.mockResolvedValue({ id: 10 });

      // First attempt: timeout error
      // Second attempt: success
      mockSlskdService.getSearch
        .mockRejectedValueOnce(new Error("Timeout waiting for search results"))
        .mockResolvedValueOnce({
          id: 10,
          state: "Completed",
          responses: [
            {
              username: "testuser",
              files: mockFiles,
              uploadSpeed: 1000000,
              queueLength: 5,
              hasFreeUploadSlot: true,
            },
          ],
        });

      mockSlskdService.queueDownload.mockResolvedValue(undefined);

      const result = await processor.processArtist(
        { name: "Retry Artist", album: "Retry Album" },
        { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
      );

      expect(result.status).toBe("queued");
      expect(mockSlskdService.getSearch).toHaveBeenCalledTimes(2); // Retry happened

      const downloads = await prisma.slskdDownload.findMany({
        where: { artistName: "Retry Artist", albumName: "Retry Album" },
      });

      expect(downloads).toHaveLength(1);
      expect(downloads[0].status).toBe("pending");
    });

    it("should fail after max retries (3) exceeded", async () => {
      // Mock search creation
      mockSlskdService.createSearch.mockResolvedValue({ id: 11 });

      // All 3 attempts fail
      mockSlskdService.getSearch
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockRejectedValueOnce(new Error("Network timeout"));

      await expect(
        processor.processArtist(
          { name: "Max Retry Artist", album: "Max Retry Album" },
          { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
        ),
      ).rejects.toThrow("Network timeout");

      expect(mockSlskdService.getSearch).toHaveBeenCalledTimes(3); // Max retries

      // No downloads should be created
      const downloads = await prisma.slskdDownload.findMany({
        where: { artistName: "Max Retry Artist", albumName: "Max Retry Album" },
      });

      expect(downloads).toHaveLength(0);
    });

    it('should NOT retry on "not found" (0 results) - valid result', async () => {
      // Mock search creation
      mockSlskdService.createSearch.mockResolvedValue({ id: 12 });

      // Search completes successfully but returns no results
      mockSlskdService.getSearch.mockResolvedValue({
        id: 12,
        state: "Completed",
        responses: [], // No results found
      });

      const result = await processor.processArtist(
        { name: "Not Found Artist", album: "Not Found Album" },
        { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
      );

      expect(result.status).toBe("no_results");
      expect(mockSlskdService.getSearch).toHaveBeenCalledTimes(1); // NO retry - valid result

      // No downloads should be created
      const downloads = await prisma.slskdDownload.findMany({
        where: { artistName: "Not Found Artist", albumName: "Not Found Album" },
      });

      expect(downloads).toHaveLength(0);
    });
  });

  describe("Rate-Limited Queue Integration", () => {
    it("should use queue when rate limiting enabled", async () => {
      // Enable rate limiting
      await prisma.$executeRaw`
        INSERT INTO global_settings (\`key\`, \`value\`, \`created_at\`, \`updated_at\`) 
        VALUES ('slskd_rate_limiting_enabled', 'true', NOW(), NOW())
        ON DUPLICATE KEY UPDATE \`value\` = 'true', \`updated_at\` = NOW()
      `;

      // Create a NEW processor after setting the flag (flag is cached at construction)
      const queueProcessor = new SlskdSubscriptionProcessor(
        prisma,
        mockSlskdService as unknown as SlskdService,
        { retryDelay: 100 },
      );

      const mockFiles = [
        {
          filename: "01 - Test Song.flac",
          size: 30000000,
          extension: ".flac",
          bitRate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        },
      ];

      // Mock the enqueueSlskdSearch function
      const mockWaitUntilFinished = vi.fn().mockResolvedValue({ searchId: 999 });
      const mockJob = {
        waitUntilFinished: mockWaitUntilFinished,
      };
      const enqueueSlskdSearchSpy = vi
        .spyOn(queueModule, "enqueueSlskdSearch")
        .mockResolvedValue(mockJob as any);

      // Mock the enqueueSlskdDownload function
      const mockDownloadWaitUntilFinished = vi.fn().mockResolvedValue({ success: true });
      const mockDownloadJob = {
        waitUntilFinished: mockDownloadWaitUntilFinished,
      };
      const enqueueSlskdDownloadSpy = vi
        .spyOn(queueModule, "enqueueSlskdDownload")
        .mockResolvedValue(mockDownloadJob as any);

      // Mock queue behavior (search will be enqueued)
      mockSlskdService.getSearch.mockResolvedValue({
        id: 999,
        state: "Completed",
        responses: [
          {
            username: "testuser",
            files: mockFiles,
            uploadSpeed: 1000000,
            queueLength: 5,
            hasFreeUploadSlot: true,
          },
        ],
      });

      mockSlskdService.queueDownload.mockResolvedValue(undefined);

      const result = await queueProcessor.processArtist(
        { name: "Queue Test Artist", album: "Queue Test Album" },
        { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
      );

      expect(result.status).toBe("queued");

      // Verify enqueueSlskdSearch was called with correct parameters
      expect(enqueueSlskdSearchSpy).toHaveBeenCalledWith({
        searchText: "Queue Test Artist Queue Test Album",
        searchTimeout: 30000,
        connectionId: 1,
      });

      // Verify createSearch was NOT called directly
      expect(mockSlskdService.createSearch).not.toHaveBeenCalled();

      // Verify waitUntilFinished was called
      expect(mockWaitUntilFinished).toHaveBeenCalled();

      const downloads = await prisma.slskdDownload.findMany({
        where: {
          artistName: "Queue Test Artist",
          albumName: "Queue Test Album",
        },
      });

      expect(downloads).toHaveLength(1);
      expect(downloads[0].status).toBe("pending");

      enqueueSlskdSearchSpy.mockRestore();
      enqueueSlskdDownloadSpy.mockRestore();
      await queueProcessor.close();
    });

    it("should use direct call when rate limiting disabled", async () => {
      // Disable rate limiting
      await prisma.$executeRaw`
        INSERT INTO global_settings (\`key\`, \`value\`, \`created_at\`, \`updated_at\`) 
        VALUES ('slskd_rate_limiting_enabled', 'false', NOW(), NOW())
        ON DUPLICATE KEY UPDATE \`value\` = 'false', \`updated_at\` = NOW()
      `;

      // Create a NEW processor after setting the flag (flag is cached at construction)
      const directProcessor = new SlskdSubscriptionProcessor(
        prisma,
        mockSlskdService as unknown as SlskdService,
        { retryDelay: 100 },
      );

      const mockFiles = [
        {
          filename: "01 - Test Song.flac",
          size: 30000000,
          extension: ".flac",
          bitRate: 1411,
          sampleRate: 44100,
          bitDepth: 16,
        },
      ];

      mockSlskdService.createSearch.mockResolvedValue({ id: 888 });
      mockSlskdService.getSearch.mockResolvedValue({
        id: 888,
        state: "Completed",
        responses: [
          {
            username: "testuser",
            files: mockFiles,
            uploadSpeed: 1000000,
            queueLength: 5,
            hasFreeUploadSlot: true,
          },
        ],
      });

      mockSlskdService.queueDownload.mockResolvedValue(undefined);

      const result = await directProcessor.processArtist(
        { name: "Direct Test Artist", album: "Direct Test Album" },
        { connectionId: 1, userId: 1, preferences: { preferLossless: true } },
      );

      expect(result.status).toBe("queued");

      // Verify createSearch WAS called directly
      expect(mockSlskdService.createSearch).toHaveBeenCalledWith({
        searchText: "Direct Test Artist Direct Test Album",
        searchTimeout: 30000,
      });

      const downloads = await prisma.slskdDownload.findMany({
        where: {
          artistName: "Direct Test Artist",
          albumName: "Direct Test Album",
        },
      });

      expect(downloads).toHaveLength(1);
      expect(downloads[0].status).toBe("pending");

      await directProcessor.close();
    });
  });
});
