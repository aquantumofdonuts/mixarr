import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the rate limiter (used by MusicBrainzService.request + the default Discogs seam).
vi.mock('../../../src/services/rate-limiter.js', () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
}));

// Mock Prisma. The SOURCE (src/services/constellation/IdentityService.ts) imports
// prisma from '../../lib/db.js' -> src/lib/db.js, so from this test dir the path is
// '../../../src/lib/db.js'.
vi.mock('../../../src/lib/db.js', () => ({
  default: {
    constellationIdentity: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}));

import prisma from '../../../src/lib/db.js';
import { MusicBrainzService } from '../../../src/services/musicbrainz.js';
import { IdentityService } from '../../../src/services/constellation/IdentityService.js';

const findUnique = () => vi.mocked(prisma.constellationIdentity.findUnique);
const upsert = () => vi.mocked(prisma.constellationIdentity.upsert);

/**
 * Route a mocked global.fetch by URL substring. Each entry is [match, jsonBody].
 * Unmatched URLs resolve to an empty MusicBrainz-ish payload so stray calls do
 * not throw (tests assert call counts separately).
 */
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

describe('IdentityService.discogsToMbid', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique().mockResolvedValue(null);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('LINKED: resolves via the MB url-relationship and caches confidence=linked', async () => {
    // MB /url lookup returns a url entity with an artist relation -> mbid-1.
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [{ type: 'discogs', artist: { id: 'mbid-1', name: 'Artist One' } }] }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => [],
    });

    const result = await svc.discogsToMbid(1111, 'Artist One');

    expect(result).toEqual({ mbid: 'mbid-1', confidence: 'linked', needsManual: false });
    // Cached as linked.
    expect(upsert()).toHaveBeenCalledTimes(1);
    const call = upsert().mock.calls[0][0] as any;
    expect(call.where.personId_source).toEqual({ personId: 1111, source: 'mb' });
    expect(call.create).toMatchObject({ personId: 1111, source: 'mb', externalId: 'mbid-1', confidence: 'linked' });
    // No name search needed: only the /url endpoint was hit.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('CORROBORATED: no url rel, but MB candidate shares a discography title -> corroborated + cached', async () => {
    const fetchMock = routeFetch([
      // url lookup: no artist relation.
      ['/url?resource=', { relations: [] }],
      // name search: one candidate.
      ['/artist?query=', { artists: [{ id: 'mbid-2', name: 'Artist Two', score: 100 }], count: 1, offset: 0 }],
      // candidate's release-groups: shares "Blue Album".
      ['/release-group?artist=mbid-2', { 'release-groups': [{ id: 'rg1', title: 'Blue Album' }], count: 1 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      // Discogs discography shares the (normalized) title "blue album".
      getDiscogsReleaseTitles: async () => ['Blue Album!', 'Other Record'],
    });

    const result = await svc.discogsToMbid(2222, 'Artist Two');

    expect(result).toEqual({ mbid: 'mbid-2', confidence: 'corroborated', needsManual: false });
    expect(upsert()).toHaveBeenCalledTimes(1);
    const call = upsert().mock.calls[0][0] as any;
    expect(call.create).toMatchObject({ externalId: 'mbid-2', confidence: 'corroborated' });
  });

  it('AMBIGUOUS -> manual: name candidate but zero discography overlap -> needsManual, not cached', async () => {
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [] }],
      ['/artist?query=', { artists: [{ id: 'mbid-3', name: 'Artist Three', score: 100 }], count: 1, offset: 0 }],
      ['/release-group?artist=mbid-3', { 'release-groups': [{ id: 'rg9', title: 'Totally Different' }], count: 1 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => ['Something Else Entirely'],
    });

    const result = await svc.discogsToMbid(3333, 'Artist Three');

    expect(result).toEqual({ mbid: null, confidence: null, needsManual: true });
    expect(upsert()).not.toHaveBeenCalled();
  });

  it('CACHE HIT: returns the stored identity without any fetch', async () => {
    findUnique().mockResolvedValue({
      personId: 4444,
      source: 'mb',
      externalId: 'mbid-cached',
      confidence: 'corroborated',
    } as any);

    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const getDiscogs = vi.fn(async () => [] as string[]);
    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: getDiscogs,
    });

    const result = await svc.discogsToMbid(4444, 'Whoever');

    expect(result).toEqual({ mbid: 'mbid-cached', confidence: 'corroborated', needsManual: false });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getDiscogs).not.toHaveBeenCalled();
    expect(upsert()).not.toHaveBeenCalled();
  });
});
