/**
 * Fire-and-forget warm of the shared Lidarr artist caches at startup.
 *
 * Never throws and must never block boot: the API can come up before
 * Lidarr does, in which case the warm fails quietly and the first
 * request populates the cache lazily (LidarrCache handles that path).
 */

import prisma from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { LidarrService, getSharedLidarrCache } from './lidarr.js';

const logger = createLogger('LidarrWarmup');

export async function warmLidarrCaches(): Promise<void> {
  try {
    const connections = await prisma.connection.findMany({
      where: { type: 'lidarr', isActive: true },
    });

    const seen = new Set<string>();
    for (const conn of connections) {
      const config = conn.config as { url?: string; apiKey?: string };
      if (!config?.url || !config?.apiKey || seen.has(config.url)) continue;
      seen.add(config.url);

      const cache = getSharedLidarrCache(
        config.url,
        new LidarrService(config as { url: string; apiKey: string })
      );
      await cache
        .refresh()
        .then(() => logger.info('Warmed Lidarr artist cache', { url: config.url }))
        .catch((error) =>
          logger.warn('Lidarr cache warm failed; will populate lazily on first use', {
            url: config.url,
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }
  } catch (error) {
    logger.warn('Lidarr cache warm skipped', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
