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

  it('FALSE-CORROBORATION regression: only a GENERIC shared title -> needsManual, not cached', async () => {
    // Two candidates; the wrong one (mbid-wrong) is ranked first. The ONLY title
    // shared with the Discogs discography is generic ("Greatest Hits"), which
    // must not count. Neither candidate should corroborate.
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [] }],
      ['/artist?query=', {
        artists: [
          { id: 'mbid-wrong', name: 'Same Name', score: 100 },
          { id: 'mbid-right', name: 'Same Name', score: 90 },
        ],
        count: 2,
        offset: 0,
      }],
      ['/release-group?artist=mbid-wrong', { 'release-groups': [{ id: 'g1', title: 'Greatest Hits' }], count: 1 }],
      ['/release-group?artist=mbid-right', { 'release-groups': [{ id: 'g2', title: 'Greatest Hits' }], count: 1 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => ['Greatest Hits'],
    });

    const result = await svc.discogsToMbid(5555, 'Same Name');

    expect(result).toEqual({ mbid: null, confidence: null, needsManual: true });
    expect(upsert()).not.toHaveBeenCalled();
  });

  it('UNIQUE non-generic overlap: exactly one candidate shares a real title -> corroborated', async () => {
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [] }],
      ['/artist?query=', {
        artists: [
          { id: 'mbid-a', name: 'Common Name', score: 100 },
          { id: 'mbid-b', name: 'Common Name', score: 95 },
        ],
        count: 2,
        offset: 0,
      }],
      // Only mbid-b shares the real album; mbid-a shares nothing.
      ['/release-group?artist=mbid-a', { 'release-groups': [{ id: 'ga', title: 'Nothing In Common' }], count: 1 }],
      ['/release-group?artist=mbid-b', { 'release-groups': [{ id: 'gb', title: 'Distinct Record' }], count: 1 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => ['Distinct Record'],
    });

    const result = await svc.discogsToMbid(6666, 'Common Name');

    expect(result).toEqual({ mbid: 'mbid-b', confidence: 'corroborated', needsManual: false });
    expect(upsert()).toHaveBeenCalledTimes(1);
    expect((upsert().mock.calls[0][0] as any).create).toMatchObject({ externalId: 'mbid-b', confidence: 'corroborated' });
  });

  it('AMBIGUOUS: two candidates both share a real non-generic title -> needsManual', async () => {
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [] }],
      ['/artist?query=', {
        artists: [
          { id: 'mbid-x', name: 'Dup Name', score: 100 },
          { id: 'mbid-y', name: 'Dup Name', score: 100 },
        ],
        count: 2,
        offset: 0,
      }],
      ['/release-group?artist=mbid-x', { 'release-groups': [{ id: 'gx', title: 'Shared Album' }], count: 1 }],
      ['/release-group?artist=mbid-y', { 'release-groups': [{ id: 'gy', title: 'Shared Album' }], count: 1 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => ['Shared Album'],
    });

    const result = await svc.discogsToMbid(7777, 'Dup Name');

    expect(result).toEqual({ mbid: null, confidence: null, needsManual: true });
    expect(upsert()).not.toHaveBeenCalled();
  });

  it('DEGRADE: MB search throws mid-corroboration -> needsManual, not an unhandled rejection', async () => {
    const fetchMock = routeFetch([
      ['/url?resource=', { relations: [] }],
    ]);
    // Make the name-search fetch reject.
    fetchMock.mockImplementation(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/url?resource=')) {
        return { ok: true, json: async () => ({ relations: [] }) } as unknown as Response;
      }
      if (u.includes('/artist?query=')) {
        throw new Error('MusicBrainz unavailable');
      }
      return { ok: true, json: async () => ({}) } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => ['Whatever'],
    });

    const result = await svc.discogsToMbid(8888, 'Outage Artist');

    expect(result).toEqual({ mbid: null, confidence: null, needsManual: true });
    expect(upsert()).not.toHaveBeenCalled();
  });

  it('URL lookup with TWO distinct artist relations is NOT linked (falls through to corroboration)', async () => {
    const fetchMock = routeFetch([
      // Ambiguous URL rel -> not linkable; then name search finds nothing.
      ['/url?resource=', { relations: [
        { type: 'discogs', artist: { id: 'mbid-p', name: 'P' } },
        { type: 'discogs', artist: { id: 'mbid-q', name: 'Q' } },
      ] }],
      ['/artist?query=', { artists: [], count: 0, offset: 0 }],
    ]);
    global.fetch = fetchMock as unknown as typeof fetch;

    const svc = new IdentityService({
      mb: new MusicBrainzService(),
      getDiscogsReleaseTitles: async () => [],
    });

    const result = await svc.discogsToMbid(9999, 'Ambiguous Link');

    // Not linked (would have been mbid-p if it picked the first arbitrarily).
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
