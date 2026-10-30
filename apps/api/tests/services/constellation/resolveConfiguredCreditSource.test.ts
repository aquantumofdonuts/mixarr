import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConfiguredCreditSource } from '../../../src/services/constellation/resolveCreditSource.js';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  constructed: vi.fn(),
  settings: vi.fn(),
}));
vi.mock('../../../src/lib/db.js', () => ({ default: { connection: { findFirst: mocks.findFirst } } }));
vi.mock('../../../src/lib/redis.js', () => ({ redis: { get: vi.fn(), eval: vi.fn() } }));
vi.mock('../../../src/services/settings.service.js', () => ({ SettingsService: { getConstellationSettings: mocks.settings } }));
vi.mock('../../../src/services/discogs.js', () => ({
  DiscogsService: class {
    constructor(token: string | undefined) { mocks.constructed(token); }
    async getArtistReleases() { return [{ id: 19, type: 'release', year: 2001 }]; }
    async getReleaseCredits() { return []; }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.mockResolvedValue({ constellationIndexEnabled: false, constellationIndexPath: ':memory:', dailyApiBudget: 5000 });
});

describe('configured credit source credential scope', () => {
  it('restricts a background worker without an actor to global connections', async () => {
    mocks.findFirst.mockImplementation(async ({ where }) => 'userId' in where && where.userId === null
      ? { config: { token: 'global-token' } }
      : { config: { token: 'another-users-private-token' } });
    const source = await resolveConfiguredCreditSource();
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { type: 'discogs', isActive: true, userId: null }, orderBy: { userId: 'desc' },
    });
    expect(mocks.constructed).toHaveBeenCalledWith('global-token');
    expect(await source.getArtistReleases(1)).toEqual([{ releaseId: 19, masterId: null, year: 2001, genres: [] }]);
  });

  it('limits an actor to their own and global connections with own credentials preferred', async () => {
    mocks.findFirst.mockResolvedValue({ config: { token: 'own-token' } });
    await resolveConfiguredCreditSource(7);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { type: 'discogs', isActive: true, OR: [{ userId: 7 }, { userId: null }] }, orderBy: { userId: 'desc' },
    });
    expect(mocks.constructed).toHaveBeenCalledWith('own-token');
  });

  it.each([undefined, 7])('uses the public tokenless service if no scoped credential exists for actor %s', async actor => {
    mocks.findFirst.mockResolvedValue(null);
    const source = await resolveConfiguredCreditSource(actor);
    expect(mocks.constructed).toHaveBeenCalledWith(undefined);
    expect(await source.getArtistReleases(1)).toHaveLength(1);
  });
});
