import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../src/services/rate-limiter.js', () => ({ rateLimit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/services/skyhook-cache-warmer.js', () => ({ skyhookWarmer: { warmArtist: vi.fn() } }));
import { LidarrService } from '../../src/services/lidarr.js';
const mbid = '11111111-1111-4111-8111-111111111111', albumId = '22222222-2222-4222-8222-222222222222';
afterEach(() => vi.restoreAllMocks());
describe('targeted album acquisition options through the actual service', () => {
  it.each([false, true])('honors searchOnAdd=%s while monitoring only the chosen existing artist album', async searchOnAdd => {
    const service = new LidarrService({ url: 'http://localhost:8686', apiKey: 'test' });
    vi.spyOn(service, 'getArtistByMbid').mockResolvedValue({ id: 1, foreignArtistId: mbid } as never);
    const album = { id: 2, artistId: 1, foreignAlbumId: albumId, monitored: false, title: 'Record', statistics: { percentOfTracks: 0 } };
    vi.spyOn(service, 'getAlbums').mockResolvedValue([album]);
    const update = vi.spyOn(service, 'updateAlbum').mockResolvedValue({ ...album, monitored: true });
    const search = vi.spyOn(service, 'searchAlbumCommand').mockResolvedValue({} as never);
    const signal = new AbortController().signal;
    const result = await service.addAlbumWithCacheWarm(mbid, albumId, 9, 8, '/archive', signal, searchOnAdd);
    expect(update).toHaveBeenCalledWith({ ...album, monitored: true }, signal);
    expect(search).toHaveBeenCalledTimes(searchOnAdd ? 1 : 0);
    if (searchOnAdd) expect(search).toHaveBeenCalledWith([2], signal);
    expect(result.isNewArtist).toBe(false);
  });
});
