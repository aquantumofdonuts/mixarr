/**
 * Try Soulseek through SlskdSubscriptionProcessor for a Lidarr album.
 * Record every outcome in soulseek_diversions for the scheduled sweep.
 */
import { PrismaClient } from "@prisma/client";
import { SlskdService } from "../services/slskd.js";
import { SlskdSubscriptionProcessor } from "../services/slskd-subscription-processor.js";

export interface DivertResult {
  status: "queued" | "no_results" | "error" | "not_found";
  searchResultCount?: number;
  error?: string;
}

export async function divertAlbumToSoulseek(
  prisma: PrismaClient,
  processor: SlskdSubscriptionProcessor,
  connectionId: number,
  userId: number,
  artistName: string,
  albumTitle: string,
  lidarrArtistId: number,
  lidarrAlbumId: number,
): Promise<DivertResult> {
  const result = await processor.processArtist(
    { name: artistName, album: albumTitle },
    { connectionId, userId, preferences: { preferLossless: true } },
  );

  await prisma.$executeRaw`
    INSERT INTO soulseek_diversions (lidarr_album_id, lidarr_artist_id, artist_name, album_title, diverted_at)
    VALUES (${lidarrAlbumId}, ${lidarrArtistId}, ${artistName}, ${albumTitle}, NOW())
    ON DUPLICATE KEY UPDATE diverted_at = VALUES(diverted_at), resolved_at = NULL, resolution = NULL
  `;

  return { status: result.status, searchResultCount: result.searchResultCount };
}

export async function getActiveSlskdConnection(prisma: PrismaClient) {
  const connection = await prisma.connection.findFirst({
    where: { type: "slskd", isActive: true },
  });
  if (!connection) return null;

  const config = connection.config as unknown as { url: string; apiKey: string };
  const slskdService = new SlskdService({ url: config.url, apiKey: config.apiKey });
  const processor = new SlskdSubscriptionProcessor(prisma, slskdService);
  return { connectionId: connection.id, slskdService, processor };
}
