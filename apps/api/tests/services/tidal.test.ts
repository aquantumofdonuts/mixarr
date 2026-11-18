/**
 * TidalService against the TIDAL v2 API (post 2026-09-14)
 *
 * Covers the userCollection* relationship endpoints with cursor pagination, nested
 * includes for track artists, the filter[query] search, and the removed mixes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/fetch-with-timeout.js', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn(),
}));

import { fetchWithTimeout } from '../../src/lib/fetch-with-timeout.js';
import { TidalService } from '../../src/services/tidal.js';

const API = 'https://openapi.tidal.com/v2';

function ok(body: unknown) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as unknown as Response;
}

const me = { data: { id: 'u1', type: 'users', attributes: { username: 'listener', country: 'NO' } } };

const artist = (id: string, name: string) => ({ id, type: 'artists', attributes: { name } });
const track = (id: string, title: string, artistIds: string[]) => ({
  id,
  type: 'tracks',
  attributes: { title, duration: 'PT3M' },
  relationships: { artists: { data: artistIds.map(a => ({ id: a, type: 'artists' })) } },
});

function service() {
  return new TidalService({
    clientId: 'cid',
    clientSecret: 'secret',
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
}

function requestedUrls(): string[] {
  return vi.mocked(fetchWithTimeout).mock.calls.map(c => String(c[0]));
}

describe('TidalService (TIDAL v2 API)', () => {
  beforeEach(() => {
    vi.mocked(fetchWithTimeout).mockReset();
  });

  it('reads favorite tracks from userCollectionTracks, following cursor pages', async () => {
    vi.mocked(fetchWithTimeout)
      .mockResolvedValueOnce(ok({
        data: [{ id: 't1', type: 'tracks' }, { id: 't2', type: 'tracks' }],
        included: [track('t1', 'One', ['a1']), track('t2', 'Two', ['a2']), artist('a1', 'Alpha'), artist('a2', 'Beta')],
        links: { next: '/userCollectionTracks/me/relationships/items?include=items.artists&page%5Bcursor%5D=abc' },
      }))
      .mockResolvedValueOnce(ok({
        data: [{ id: 't3', type: 'tracks' }],
        included: [track('t3', 'Three', ['a1']), artist('a1', 'Alpha')],
        links: {},
      }));

    const tracks = await service().getCollectionTracks(50);

    expect(requestedUrls()).toEqual([
      `${API}/userCollectionTracks/me/relationships/items?include=items.artists`,
      `${API}/userCollectionTracks/me/relationships/items?include=items.artists&page%5Bcursor%5D=abc`,
    ]);
    expect(tracks.map(t => t.title)).toEqual(['One', 'Two', 'Three']);
    expect(tracks.map(t => t.artists.map(a => a.name))).toEqual([['Alpha'], ['Beta'], ['Alpha']]);
  });

  it('stops paging once the limit is reached', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(ok({
      data: [{ id: 't1', type: 'tracks' }, { id: 't2', type: 'tracks' }],
      included: [track('t1', 'One', []), track('t2', 'Two', [])],
      links: { next: '/userCollectionTracks/me/relationships/items?page%5Bcursor%5D=abc' },
    }));

    const tracks = await service().getCollectionTracks(1);

    expect(tracks).toHaveLength(1);
    expect(fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('accepts absolute next links', async () => {
    vi.mocked(fetchWithTimeout)
      .mockResolvedValueOnce(ok({
        data: [{ id: 'a1', type: 'artists' }],
        included: [artist('a1', 'Alpha')],
        links: { next: `${API}/userCollectionArtists/me/relationships/items?include=items&page%5Bcursor%5D=x` },
      }))
      .mockResolvedValueOnce(ok({ data: [{ id: 'a2', type: 'artists' }], included: [artist('a2', 'Beta')] }));

    const artists = await service().getCollectionArtists(50);

    expect(artists.map(a => a.name)).toEqual(['Alpha', 'Beta']);
    expect(requestedUrls()[1]).toBe(`${API}/userCollectionArtists/me/relationships/items?include=items&page%5Bcursor%5D=x`);
  });

  it('reads playlist tracks with the account country code and skips videos', async () => {
    vi.mocked(fetchWithTimeout)
      .mockResolvedValueOnce(ok(me))
      .mockResolvedValueOnce(ok({
        data: [{ id: 't1', type: 'tracks' }, { id: 'v1', type: 'videos' }],
        included: [track('t1', 'One', ['a1']), { id: 'v1', type: 'videos', attributes: { title: 'Clip' } }, artist('a1', 'Alpha')],
      }));

    const tracks = await service().getPlaylistTracks('pl-1', 50);

    expect(requestedUrls()[1]).toBe(`${API}/playlists/pl-1/relationships/items?countryCode=NO&include=items.artists`);
    expect(tracks.map(t => t.title)).toEqual(['One']);
  });

  it('lists the user playlists from userCollectionPlaylists', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValueOnce(ok({
      data: [{ id: 'p1', type: 'playlists' }],
      included: [{ id: 'p1', type: 'playlists', attributes: { name: 'Road Trip', numberOfItems: 12 } }],
    }));

    const playlists = await service().getPlaylists(50);

    expect(requestedUrls()[0]).toBe(`${API}/userCollectionPlaylists/me/relationships/items?include=items`);
    expect(playlists).toEqual([{ id: 'p1', name: 'Road Trip', description: undefined, numberOfItems: 12 }]);
  });

  it('searches with filter[query] and keeps the ranking of the search result', async () => {
    vi.mocked(fetchWithTimeout)
      .mockResolvedValueOnce(ok(me))
      .mockResolvedValueOnce(ok({
        data: [{
          id: 'opaque',
          type: 'searchResults',
          relationships: { artists: { data: [{ id: 'a2', type: 'artists' }, { id: 'a1', type: 'artists' }] } },
        }],
        // included order differs from relevance order
        included: [artist('a1', 'Second Best'), artist('a2', 'Best Match')],
      }));

    const artists = await service().searchArtists('best match', 10);

    expect(requestedUrls()[1]).toBe(`${API}/searchResults?filter%5Bquery%5D=best%20match&countryCode=NO&include=artists`);
    expect(artists.map(a => a.name)).toEqual(['Best Match', 'Second Best']);
  });

  it.each([
    ['getDiscoveryMixes'],
    ['getMyMixes'],
    ['getNewArrivalMixes'],
  ] as const)('%s fails clearly because TIDAL removed mixes from its API', async (method) => {
    await expect(service()[method]()).rejects.toThrow('TIDAL no longer offers mixes');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });
});
