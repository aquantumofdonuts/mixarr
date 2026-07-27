import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Path-resolution unit test for the dump-import worker. The writer and reader
 * ({@link resolveCreditSource}) must agree on the index path: the DEFAULT comes
 * from the constellation settings (`constellationIndexPath`), and the
 * `CONSTELLATION_INDEX_PATH` env var is an optional override that wins when set.
 *
 * `SettingsService.getConstellationSettings` is mocked so this stays a pure unit
 * test — no prisma, no Redis, no BullMQ.
 */
const getConstellationSettings = vi.fn();

vi.mock('../../../src/services/settings.service.js', () => ({
  SettingsService: {
    getConstellationSettings: (...args: unknown[]) => getConstellationSettings(...args),
  },
}));

import { resolveIndexPath } from '../../../src/jobs/constellation/dump-import-worker.js';

describe('resolveIndexPath', () => {
  const original = process.env.CONSTELLATION_INDEX_PATH;

  afterEach(() => {
    if (original === undefined) delete process.env.CONSTELLATION_INDEX_PATH;
    else process.env.CONSTELLATION_INDEX_PATH = original;
    vi.clearAllMocks();
  });

  it('uses the settings constellationIndexPath when the env override is unset', async () => {
    delete process.env.CONSTELLATION_INDEX_PATH;
    getConstellationSettings.mockResolvedValue({
      constellationIndexEnabled: true,
      constellationIndexPath: '/data/constellation/index.db',
    });

    await expect(resolveIndexPath()).resolves.toBe('/data/constellation/index.db');
    expect(getConstellationSettings).toHaveBeenCalledTimes(1);
  });

  it('lets the CONSTELLATION_INDEX_PATH env override take precedence over settings', async () => {
    process.env.CONSTELLATION_INDEX_PATH = '/override/index.db';
    getConstellationSettings.mockResolvedValue({
      constellationIndexEnabled: true,
      constellationIndexPath: '/data/constellation/index.db',
    });

    await expect(resolveIndexPath()).resolves.toBe('/override/index.db');
    // Env override short-circuits — settings must not even be read.
    expect(getConstellationSettings).not.toHaveBeenCalled();
  });

  it('ignores a blank/whitespace env override and falls back to settings', async () => {
    process.env.CONSTELLATION_INDEX_PATH = '   ';
    getConstellationSettings.mockResolvedValue({
      constellationIndexEnabled: true,
      constellationIndexPath: '/data/constellation/index.db',
    });

    await expect(resolveIndexPath()).resolves.toBe('/data/constellation/index.db');
    expect(getConstellationSettings).toHaveBeenCalledTimes(1);
  });
});
