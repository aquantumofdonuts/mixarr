import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/db.js', () => ({
  default: { connection: { findMany: vi.fn() } },
}));
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: vi.fn(),
  getSharedLidarrCache: vi.fn(),
}));

import prisma from '../../src/lib/db.js';
import { getSharedLidarrCache } from '../../src/services/lidarr.js';
import { warmLidarrCaches } from '../../src/services/lidarr-warmup.js';

describe('warmLidarrCaches', () => {
  beforeEach(() => vi.clearAllMocks());

  it('warms each unique Lidarr URL once', async () => {
    vi.mocked(prisma.connection.findMany).mockResolvedValueOnce([
      { id: 1, config: { url: 'http://lidarr-a:8686', apiKey: 'k1' } },
      { id: 2, config: { url: 'http://lidarr-a:8686', apiKey: 'k1' } }, // duplicate URL
      { id: 3, config: { url: 'http://lidarr-b:8686', apiKey: 'k2' } },
    ] as never);
    const refresh = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getSharedLidarrCache).mockReturnValue({ refresh } as never);

    await warmLidarrCaches();

    expect(getSharedLidarrCache).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('skips connections with incomplete config', async () => {
    vi.mocked(prisma.connection.findMany).mockResolvedValueOnce([
      { id: 1, config: { url: 'http://lidarr:8686' } }, // no apiKey
      { id: 2, config: {} },
    ] as never);

    await warmLidarrCaches();
    expect(getSharedLidarrCache).not.toHaveBeenCalled();
  });

  it('resolves without throwing when Lidarr is unreachable', async () => {
    vi.mocked(prisma.connection.findMany).mockResolvedValueOnce([
      { id: 1, config: { url: 'http://lidarr:8686', apiKey: 'k' } },
    ] as never);
    vi.mocked(getSharedLidarrCache).mockReturnValue({
      refresh: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as never);

    await expect(warmLidarrCaches()).resolves.toBeUndefined();
  });

  it('resolves without throwing when the DB query fails', async () => {
    vi.mocked(prisma.connection.findMany).mockRejectedValueOnce(new Error('db down'));
    await expect(warmLidarrCaches()).resolves.toBeUndefined();
  });
});
