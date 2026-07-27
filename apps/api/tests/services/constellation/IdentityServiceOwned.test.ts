import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the rate limiter (used by MusicBrainzService.request + the default Discogs seam).
vi.mock('../../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Mock Prisma. The reverse cache lookup is by (source, externalId) -> findFirst.
// buildOwnedSet writes per-user ConstellationOwned rows via upsert.
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    constellationIdentity: {
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
    constellationOwned: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

import prisma from '../../../src/lib/db.js';
import { MusicBrainzService } from '../../../src/services/musicbrainz.js';
import { IdentityService, type OwnedSourceProvider } from '../../../src/services/constellation/IdentityService.js';

const identityFindFirst = () => vi.mocked(prisma.constellationIdentity.findFirst);
const identityUpsert = () => vi.mocked(prisma.constellationIdentity.upsert);
const ownedUpsert = () => vi.mocked(prisma.constellationOwned.upsert);

/** Route a mocked global.fetch by URL substring: [match, jsonBody]. */
function routeFetch(routes: Array<[string, unknown]>) {
  return vi.fn(async (url: string | URL) => {
    const u = String(url);
    for (const [match, body] of routes) {
      if (u.includes(match)) {
        return { ok: true, json: async () => body } as unknown as Response;
      }
    }
    return { ok: true, json: async () => ({}) } as unknown as Response;
  });
}

const discogsRel = (id: number) => ({
  relations: [{ type: 'discogs', url: { resource: `https://www.discogs.com/artist/${id}` } }],
});

describe('IdentityService.mbidToDiscogs', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    identityFindFirst().mockResolvedValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('LINKED: resolves the discogs id via MB url-rel and caches confidence=linked', async () => {
    const fetchMock = routeFetch([['/artist/mbid-fwd', discogsRel(555)]]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({ mb: new MusicBrainzService() });
    const result = await svc.mbidToDiscogs('mbid-fwd');

    expect(result).toBe(555);
    expect(identityUpsert()).toHaveBeenCalledTimes(1);
    const call = identityUpsert().mock.calls[0][0] as any;
    expect(call.where.personId_source).toEqual({ personId: 555, source: 'mb' });
    expect(call.create).toMatchObject({
      personId: 555,
      source: 'mb',
      externalId: 'mbid-fwd',
      confidence: 'linked',
    });
  });

  it('CACHE HIT: a stored (source=mb, externalId=mbid) row returns its personId with no fetch', async () => {
    identityFindFirst().mockResolvedValue({
      personId: 999,
      source: 'mb',
      externalId: 'mbid-cached',
      confidence: 'linked',
    } as any);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({ mb: new MusicBrainzService() });
    const result = await svc.mbidToDiscogs('mbid-cached');

    expect(result).toBe(999);
    // Reverse lookup uses findFirst on (source, externalId).
    const where = identityFindFirst().mock.calls[0][0]?.where as any;
    expect(where).toMatchObject({ source: 'mb', externalId: 'mbid-cached' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(identityUpsert()).not.toHaveBeenCalled();
  });

  it('UNRESOLVED: MB returns no discogs rel -> null, no upsert', async () => {
    const fetchMock = routeFetch([['/artist/mbid-none', { relations: [] }]]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({ mb: new MusicBrainzService() });
    const result = await svc.mbidToDiscogs('mbid-none');

    expect(result).toBeNull();
    expect(identityUpsert()).not.toHaveBeenCalled();
  });
});

describe('IdentityService.buildOwnedSet', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    identityFindFirst().mockResolvedValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const fakeSource = (
    source: OwnedSourceProvider['source'],
    mbids: string[]
  ): OwnedSourceProvider => ({
    source,
    getArtistMbids: async () => mbids,
  });

  it('resolves each library MBID to a discogs id; unresolved is skipped, not errored', async () => {
    // mbid-a -> discogs 111; mbid-b -> no discogs rel (unresolved -> skip).
    const fetchMock = routeFetch([
      ['/artist/mbid-a', discogsRel(111)],
      ['/artist/mbid-b', { relations: [] }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({ mb: new MusicBrainzService() });
    const result = await svc.buildOwnedSet(42, [fakeSource('lidarr', ['mbid-a', 'mbid-b'])]);

    expect(result).toEqual({ owned: 1, skipped: 1 });
    // Exactly ONE owned upsert, for the resolved node, carrying userId + source.
    expect(ownedUpsert()).toHaveBeenCalledTimes(1);
    const call = ownedUpsert().mock.calls[0][0] as any;
    expect(call.create).toMatchObject({ userId: 42, personId: 111, source: 'lidarr' });
    expect(call.where.userId_personId_source).toEqual({
      userId: 42,
      personId: 111,
      source: 'lidarr',
    });
  });

  it('MULTIPLE SOURCES: owned rows carry the right source per provider', async () => {
    const fetchMock = routeFetch([
      ['/artist/mbid-lid', discogsRel(200)],
      ['/artist/mbid-jelly', discogsRel(300)],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({ mb: new MusicBrainzService() });
    const result = await svc.buildOwnedSet(7, [
      fakeSource('lidarr', ['mbid-lid']),
      fakeSource('jellyfin', ['mbid-jelly']),
    ]);

    expect(result).toEqual({ owned: 2, skipped: 0 });
    expect(ownedUpsert()).toHaveBeenCalledTimes(2);
    const rows = ownedUpsert().mock.calls.map(c => (c[0] as any).create);
    expect(rows).toContainEqual({ userId: 7, personId: 200, source: 'lidarr' });
    expect(rows).toContainEqual({ userId: 7, personId: 300, source: 'jellyfin' });
  });
});
