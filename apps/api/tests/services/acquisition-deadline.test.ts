import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LidarrService } from '../../src/services/lidarr.js';
import { rateLimit, setRateLimitConfig } from '../../src/services/rate-limiter.js';
import { SkyHookCacheWarmer, skyhookWarmer } from '../../src/services/skyhook-cache-warmer.js';

const mbid = 'df494a19-4657-4a77-92b6-80325c63510f';
const albumMbid = 'bc4c3083-c484-4c2f-8983-dd82eb8b60c0';
const artist = { id: 17, artistName: 'Test Artist', foreignArtistId: mbid };
const album = { id: 22, artistId: 17, title: 'Test Album', foreignAlbumId: albumMbid, monitored: false };
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

describe('production acquisition cancellation', () => {
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  let service: LidarrService;

  beforeEach(() => {
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    setRateLimitConfig('lidarr', { requestsPerSecond: 1000, burstSize: 100 });
    setRateLimitConfig('lidarr_add', { requestsPerSecond: 1000, burstSize: 100 });
    service = new LidarrService({ url: 'http://localhost:8686', apiKey: 'test-key' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setRateLimitConfig('lidarr', { requestsPerSecond: 2, burstSize: 5 });
    setRateLimitConfig('lidarr_add', { requestsPerSecond: 0.5, burstSize: 2 });
  });

  it('does no provider work for an already expired operation', async () => {
    const controller = new AbortController();
    const reason = new Error('operation expired');
    controller.abort(reason);

    await expect(service.addArtistWithCacheWarm(mbid, 1, 2, '/music', true, true, false, 'all', 'all', controller.signal)).rejects.toBe(reason);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels the actual rate limiter wait without waiting for refill', async () => {
    setRateLimitConfig('deadline-test', { requestsPerSecond: 0.001, burstSize: 1 });
    await rateLimit('deadline-test');
    const controller = new AbortController();
    const pending = rateLimit('deadline-test', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
  });

  it('starts no fetch when acquisition is cancelled during its add rate wait', async () => {
    setRateLimitConfig('lidarr_add', { requestsPerSecond: 0.001, burstSize: 1 });
    await rateLimit('lidarr_add');
    const controller = new AbortController();
    const pending = service.addArtist(mbid, 1, 2, '/music', true, false, 'none', 'new', controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await assertion;
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stops the production Lidarr retry backoff before another request', async () => {
    const controller = new AbortController();
    const reason = new Error('operation expired during backoff');
    fetchMock.mockImplementation(async () => {
      setImmediate(() => controller.abort(reason));
      return json({ message: 'unavailable' }, 503);
    });

    await expect(service.getArtists(controller.signal)).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('aborts a pending provider fetch and preserves the operation reason', async () => {
    const controller = new AbortController();
    const reason = new Error('operation expired during fetch');
    let requestSignal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options?.signal ?? undefined;
      requestSignal!.addEventListener('abort', () => reject(requestSignal!.reason), { once: true });
      setImmediate(() => controller.abort(reason));
    }));

    await expect(service.getArtistByMbid(mbid, controller.signal)).rejects.toBe(reason);
    expect(requestSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('returns existing exact membership without cache warming or POST', async () => {
    fetchMock.mockResolvedValueOnce(json([artist]));
    const warmer = vi.spyOn(skyhookWarmer, 'warmArtist');

    const result = await service.addArtistWithCacheWarm(mbid, 1, 2, '/music');
    expect(result.artist).toEqual(artist);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(warmer).not.toHaveBeenCalled();
  });

  it('permits add after ordinary warm failure and preserves positional settings', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(json({}, 404))
      .mockResolvedValueOnce(json([artist]))
      .mockResolvedValueOnce(json(artist));

    const result = await service.addArtistWithCacheWarm(mbid, 8, 9, '/configured', false, false, false, 'future', 'new', controller.signal);
    expect(result.artist).toEqual(artist);
    expect(result.cacheWarmed).toBe(false);
    const postOptions = fetchMock.mock.calls[3][1]!;
    expect(JSON.parse(postOptions.body as string)).toMatchObject({
      qualityProfileId: 8,
      metadataProfileId: 9,
      rootFolderPath: '/configured',
      monitored: false,
      monitorNewItems: 'new',
      addOptions: { monitor: 'future', searchForMissingAlbums: false },
    });
    expect(timeout.mock.calls.every(([duration]) => duration === 30_000)).toBe(true);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    controller.abort();
    for (const [, options] of fetchMock.mock.calls) {
      expect(options?.signal?.aborted).toBe(true);
    }
  });

  it('does not add when the operation aborts during real SkyHook backoff', async () => {
    const controller = new AbortController();
    const reason = new Error('operation expired during warming');
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('api.lidarr.audio')) {
        setImmediate(() => controller.abort(reason));
        return json({}, 503);
      }
      return json([]);
    });

    await expect(service.addArtistWithCacheWarm(mbid, 1, 2, '/music', true, true, false, 'all', 'all', controller.signal)).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('bounds the real SkyHook pending fetch by its local warming budget', async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      signal = options?.signal ?? undefined;
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
    }));

    const result = await new SkyHookCacheWarmer().warmArtist(mbid, { timeoutMs: 20 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timeout');
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('propagates a shared signal through every configuration fallback getter', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async () => json([]));
    await Promise.all([
      service.getQualityProfiles(controller.signal),
      service.getMetadataProfiles(controller.signal),
      service.getRootFolders(controller.signal),
    ]);
    controller.abort();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });

  it('exposes definite provider HTTP rejection status', async () => {
    fetchMock.mockResolvedValueOnce(json({ message: 'bad profile: upstream fetch failed with 503' }, 400));
    await expect(service.getArtists()).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects an expired operation even if a response body completes afterward', async () => {
    const controller = new AbortController();
    const reason = new Error('operation expired during body read');
    const response = json([]);
    vi.spyOn(response, 'json').mockImplementation(async () => {
      controller.abort(reason);
      return [];
    });
    fetchMock.mockResolvedValueOnce(response);

    await expect(service.getArtists(controller.signal)).rejects.toBe(reason);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves targeted album monitoring and command search under the same signal', async () => {
    const controller = new AbortController();
    fetchMock
      .mockResolvedValueOnce(json([artist]))
      .mockResolvedValueOnce(json([artist]))
      .mockResolvedValueOnce(json([album]))
      .mockResolvedValueOnce(json({ ...album, monitored: true }))
      .mockResolvedValueOnce(json({ id: 33 }));
    const warmer = vi.spyOn(skyhookWarmer, 'warmArtist');

    const result = await service.addAlbumWithCacheWarm(mbid, albumMbid, 1, 2, '/music', controller.signal);
    expect(result.album.monitored).toBe(true);
    expect(result.isNewArtist).toBe(false);
    expect(warmer).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[4][1]!.body as string)).toEqual({ name: 'AlbumSearch', albumIds: [22] });
    controller.abort();
    expect(fetchMock.mock.calls.every(([, options]) => options?.signal?.aborted)).toBe(true);
  });

  it('aborts album metadata polling before update or search', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('/album?')) {
        setImmediate(() => controller.abort());
        return json([]);
      }
      return json([artist]);
    });

    await expect(service.addAlbum(mbid, albumMbid, 1, 2, '/music', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT' || options?.method === 'POST')).toBe(false);
  });
});
