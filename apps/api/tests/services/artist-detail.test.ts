import type { PrismaClient } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistDetailInputError, ArtistDetailService } from '../../src/services/artist-detail.js';
import { LidarrService } from '../../src/services/lidarr.js';
import { MusicBrainzService } from '../../src/services/musicbrainz.js';
import { setRateLimitConfig } from '../../src/services/rate-limiter.js';

const mbid = 'df494a19-4657-4a77-92b6-80325c63510f';
const otherMbid = 'bc4c3083-c484-4c2f-8983-dd82eb8b60c0';
const at = new Date('2026-10-07T12:00:00.000Z');
const result = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, mbid, name: 'Shared Artist', artistName: null, itemType: 'artist', subscriptionId: 71, runId: 82,
  createdAt: at, status: 'pending', sourceUrl: 'https://example.org/source', imageUrl: null,
  subscription: { userId: 1, name: 'My subscription' }, ...overrides,
});
const review = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, mbid, userId: 1, artistName: 'Shared Artist', source: 'spotify:Daily Mix', status: 'approved', createdAt: at, ...overrides,
});
type Evidence = ReturnType<typeof result> | ReturnType<typeof review>;
type ReadArgs = {
  where: {
    mbid: string; userId?: number; subscription?: { userId: number };
    createdAt?: { gt?: Date; gte?: Date };
    OR?: Array<{ createdAt: Date | { gt: Date }; id?: { gt: number } }>;
  };
  take?: number;
};

function read(rows: Evidence[], { where, take }: ReadArgs) {
  const matchesTime = (row: Evidence) => {
    if (where.OR) return where.OR.some(clause => clause.createdAt instanceof Date
      ? row.createdAt.getTime() === clause.createdAt.getTime() && row.id > clause.id!.gt
      : row.createdAt > clause.createdAt.gt);
    if (where.createdAt?.gt) return row.createdAt > where.createdAt.gt;
    if (where.createdAt?.gte) return row.createdAt >= where.createdAt.gte;
    return true;
  };
  return rows.filter(row => row.mbid === where.mbid &&
    ('subscription' in row ? row.subscription.userId === where.subscription?.userId : row.userId === where.userId) && matchesTime(row))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id).slice(0, take);
}

describe('ArtistDetailService scoped provenance', () => {
  let results: ReturnType<typeof result>[];
  let reviews: ReturnType<typeof review>[];
  let db: {
    subscriptionResult: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    reviewItem: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  };
  let metadata: { getArtist: ReturnType<typeof vi.fn> };
  let membership: { getArtistByMbid: ReturnType<typeof vi.fn> };
  let service: ArtistDetailService;

  beforeEach(() => {
    results = [];
    reviews = [];
    db = {
      subscriptionResult: {
        findMany: vi.fn(async (args: ReadArgs) => read(results, args)),
        findFirst: vi.fn(async (args: ReadArgs) => read(results, { ...args, take: 1 })[0] ?? null),
      },
      reviewItem: {
        findMany: vi.fn(async (args: ReadArgs) => read(reviews, args)),
        findFirst: vi.fn(async (args: ReadArgs) => read(reviews, { ...args, take: 1 })[0] ?? null),
      },
    };
    metadata = { getArtist: vi.fn().mockResolvedValue({ id: mbid, name: 'Provider Artist', disambiguation: 'A <b>verified</b> identity' }) };
    membership = { getArtistByMbid: vi.fn().mockResolvedValue(null) };
    service = new ArtistDetailService(db as unknown as PrismaClient, membership, metadata);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    setRateLimitConfig('lidarr', { requestsPerSecond: 2, burstSize: 5 });
    setRateLimitConfig('musicbrainz', { requestsPerSecond: 1, burstSize: 1 });
  });

  it('returns stored record references/status/time in deterministic mixed-source order', async () => {
    results = [result(7, { status: 'failed' }), result(2, { status: 'added', createdAt: new Date(at.getTime() + 1000) })];
    reviews = [review(9), review(3, { status: 'rejected' })];
    const detail = await service.getArtistDetail(mbid, 1);

    expect(detail.sources.map(row => row.key)).toEqual(['review-item:3', 'review-item:9', 'subscription-result:7', 'subscription-result:2']);
    expect(detail.sources[2]).toEqual({
      key: 'subscription-result:7', kind: 'subscription-result', label: 'My subscription', subscriptionId: 71,
      runId: 82, recordedAt: at.toISOString(), recordStatus: 'failed', sourceUrl: 'https://example.org/source',
    });
    expect(detail.sources[0]).toMatchObject({ label: 'spotify:Daily Mix', subscriptionId: null, runId: null, sourceUrl: null, recordStatus: 'rejected' });
    expect(detail.membership).toBe('not-in-library');
    expect(detail.disambiguation).toBe('A verified identity');
    expect(detail.unavailable).toEqual([]);
  });

  it('never joins same-name records, missing identities, or another user including an admin actor', async () => {
    results = [result(1), result(2, { mbid: otherMbid }), result(3, { mbid: null }), result(4, { subscription: { userId: 2, name: 'Admin own' } })];
    reviews = [review(1), review(2, { mbid: otherMbid }), review(3, { mbid: null }), review(4, { userId: 2 })];

    expect((await service.getArtistDetail(mbid, 1)).sources.map(row => row.key)).toEqual(['review-item:1', 'subscription-result:1']);
    expect((await service.getArtistDetail(mbid, 2)).sources.map(row => row.key)).toEqual(['review-item:4', 'subscription-result:4']);
    expect(db.subscriptionResult.findMany.mock.calls[1][0].where).toEqual({ mbid, subscription: { userId: 2 } });
    expect(db.reviewItem.findMany.mock.calls[1][0].where).toEqual({ mbid, userId: 2 });
  });

  it('keeps review evidence unlinked despite a label that resembles a subscription ID', async () => {
    reviews = [review(1, { source: 'subscription:71' })];
    results = [result(1, { runId: null })];
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail.sources[0]).toMatchObject({ label: 'subscription:71', subscriptionId: null, runId: null, sourceUrl: null });
    expect(detail.sources[1].runId).toBeNull();
  });

  it('deduplicates only repeated record keys without treating evidence as acquisitions', async () => {
    results = [result(1), result(1)];
    reviews = [review(1)];
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail.sources.map(row => row.key)).toEqual(['review-item:1', 'subscription-result:1']);
    expect(detail.sources[0].recordStatus).toBe('approved');
    expect(detail.membership).toBe('not-in-library');
    expect(detail).not.toHaveProperty('addedCount');
  });

  it('paginates tied timestamps across both source tables without duplicates or omissions', async () => {
    results = [result(1), result(2), result(3, { createdAt: new Date(at.getTime() + 1) })];
    reviews = [review(1), review(2), review(3)];
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const detail = await service.getArtistDetail(mbid, 1, { limit: 2, cursor });
      keys.push(...detail.sources.map(row => row.key));
      cursor = detail.sourcesNextCursor ?? undefined;
    } while (cursor);
    expect(keys).toEqual(['review-item:1', 'review-item:2', 'review-item:3', 'subscription-result:1', 'subscription-result:2', 'subscription-result:3']);
    expect(db.subscriptionResult.findMany.mock.calls.every(([args]) => args.take === 3)).toBe(true);
    expect(db.reviewItem.findMany.mock.calls.every(([args]) => args.take === 3)).toBe(true);
  });

  it('defaults to 50 sources while bounding each database stream', async () => {
    results = Array.from({ length: 61 }, (_, index) => result(index + 1));
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail.sources).toHaveLength(50);
    expect(detail.sourcesNextCursor).toEqual(expect.any(String));
    expect(db.subscriptionResult.findMany.mock.calls[0][0].take).toBe(51);
    expect(db.reviewItem.findMany.mock.calls[0][0].take).toBe(51);
  });

  it('rejects malformed/cross-user/cross-artist cursor before querying any evidence', async () => {
    results = [result(1), result(2)];
    const cursor = (await service.getArtistDetail(mbid, 1, { limit: 1 })).sourcesNextCursor!;
    db.subscriptionResult.findMany.mockClear();
    db.reviewItem.findMany.mockClear();
    const extraKeys = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url').toString()), extra: true })).toString('base64url');
    for (const [artistId, actor, token] of [[mbid, 2, cursor], [otherMbid, 1, cursor], [mbid, 1, 'not-json'], [mbid, 1, `${cursor}=`], [mbid, 1, extraKeys], [mbid, 1, '']] as const) {
      await expect(service.getArtistDetail(artistId, actor, { cursor: token })).rejects.toMatchObject({ status: 400, code: 'INVALID_CURSOR' });
    }
    expect(db.subscriptionResult.findMany).not.toHaveBeenCalled();
    expect(db.reviewItem.findMany).not.toHaveBeenCalled();
  });

  it('validates identity/user and bounded source limits before provider calls', async () => {
    await expect(service.getArtistDetail('same-name', 1)).rejects.toBeInstanceOf(ArtistDetailInputError);
    await expect(service.getArtistDetail(mbid, 0)).rejects.toMatchObject({ code: 'INVALID_IDENTITY' });
    for (const limit of [0, 101, 1.5, NaN, Infinity]) {
      await expect(service.getArtistDetail(mbid, 1, { limit })).rejects.toMatchObject({ code: 'INVALID_LIMIT' });
    }
    expect(metadata.getArtist).not.toHaveBeenCalled();
  });

  it('validates source schemes and credentials and preserves only safe actual links', async () => {
    results = ['javascript:alert(1)', 'data:text/html,payload', 'https://user:secret@example.org', 'not a url', 'http://example.org/evidence'].map((sourceUrl, index) => result(index + 1, { sourceUrl }));
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail.sources.map(row => row.sourceUrl)).toEqual([null, null, null, null, 'http://example.org/evidence']);
  });

  it('returns honest metadata and membership unavailability with exact-owned name fallback', async () => {
    metadata.getArtist.mockResolvedValue(null);
    membership.getArtistByMbid.mockRejectedValue(new Error('offline'));
    results = [result(1, { imageUrl: 'https://example.org/art.jpg' })];
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail).toMatchObject({ name: 'Shared Artist', imageUrl: 'https://example.org/art.jpg', membership: 'unknown', disambiguation: null, unavailable: ['metadata', 'membership'] });
    expect(detail.sources).toHaveLength(1);
  });

  it('does not invent metadata or membership when no provider or owned source can supply them', async () => {
    metadata.getArtist.mockRejectedValue(new Error('offline'));
    const noConnection = new ArtistDetailService(db as unknown as PrismaClient, undefined, metadata);
    expect(await noConnection.getArtistDetail(mbid, 1)).toMatchObject({ name: mbid, imageUrl: null, membership: 'unknown', sources: [], unavailable: ['metadata', 'membership'] });
  });

  it('rejects mismatched provider identity rather than importing same-name metadata', async () => {
    metadata.getArtist.mockResolvedValue({ id: otherMbid, name: 'Shared Artist' });
    membership.getArtistByMbid.mockResolvedValue({ foreignArtistId: otherMbid, artistName: 'Shared Artist' });
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail.name).toBe(mbid);
    expect(detail.membership).toBe('unknown');
    expect(detail.unavailable).toEqual(['metadata', 'membership']);
  });

  it('marks source lookup failure explicitly while retaining verified provider identity', async () => {
    db.subscriptionResult.findMany.mockRejectedValue(new Error('database unavailable'));
    membership.getArtistByMbid.mockResolvedValue({ foreignArtistId: mbid, artistName: 'Library Artist', images: [{ coverType: 'poster', url: 'https://example.org/library.jpg' }] });
    const detail = await service.getArtistDetail(mbid, 1);
    expect(detail).toMatchObject({ name: 'Provider Artist', imageUrl: 'https://example.org/library.jpg', membership: 'in-library', sources: [], sourcesNextCursor: null, unavailable: ['sources'] });
  });

  it('preserves a known artist name on an empty continuation page without a name join', async () => {
    metadata.getArtist.mockResolvedValue(null);
    results = [result(1), result(2)];
    const cursor = (await service.getArtistDetail(mbid, 1, { limit: 1 })).sourcesNextCursor!;
    results = [result(1)];
    const detail = await service.getArtistDetail(mbid, 1, { cursor, limit: 1 });
    expect(detail.sources).toEqual([]);
    expect(detail.name).toBe('Shared Artist');
    expect(db.subscriptionResult.findFirst.mock.calls[0][0].where).toEqual({ mbid, subscription: { userId: 1 } });
  });

  it('uses an album record artistName instead of presenting its album title as the artist', async () => {
    metadata.getArtist.mockResolvedValue(null);
    results = [result(1, { itemType: 'album', name: 'Album Title', artistName: 'Recorded Artist' })];
    expect((await service.getArtistDetail(mbid, 1)).name).toBe('Recorded Artist');
  });

  it('returns owned evidence when real provider reads stall and stops Lidarr retrying at the shared 20-second deadline', async () => {
    results = [result(1)];
    setRateLimitConfig('lidarr', { requestsPerSecond: 1000, burstSize: 100 });
    setRateLimitConfig('musicbrainz', { requestsPerSecond: 1000, burstSize: 100 });
    const deadline = new AbortController();
    const nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeouts = vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => ms === 20_000 ? deadline.signal : nativeTimeout(ms));
    let finishMetadata: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (String(url).includes('musicbrainz.org')) {
        return new Promise<Response>(resolve => { finishMetadata = resolve; });
      }
      setImmediate(() => deadline.abort(new DOMException('Read budget expired', 'TimeoutError')));
      return new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const realProviders = new ArtistDetailService(
      db as unknown as PrismaClient,
      new LidarrService({ url: 'http://localhost:8686', apiKey: 'test-key' }),
      new MusicBrainzService(),
    );

    const detail = await realProviders.getArtistDetail(mbid, 1);
    expect(detail).toMatchObject({ name: 'Shared Artist', membership: 'unknown', unavailable: ['metadata', 'membership'] });
    expect(detail.sources.map(row => row.key)).toEqual(['subscription-result:1']);
    expect(timeouts.mock.calls.filter(([ms]) => ms === 20_000)).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('localhost:8686'))).toHaveLength(1);
    const lidarrSignal = fetchMock.mock.calls.find(([url]) => String(url).includes('localhost:8686'))![1]!.signal;
    expect(lidarrSignal?.aborted).toBe(true);
    expect(finishMetadata).toEqual(expect.any(Function));
    finishMetadata!(new Response(JSON.stringify({ id: mbid, name: 'Late provider name' })));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(detail.name).toBe('Shared Artist');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('localhost:8686'))).toHaveLength(1);
  });

  it('cancels actual in-flight membership fetch while retaining completed source reads', async () => {
    results = [result(1)];
    setRateLimitConfig('lidarr', { requestsPerSecond: 1000, burstSize: 100 });
    const caller = new AbortController();
    let providerSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise<Response>((_resolve, reject) => {
      providerSignal = options!.signal!;
      providerSignal.addEventListener('abort', () => reject(providerSignal!.reason), { once: true });
      setImmediate(() => caller.abort());
    }));
    vi.stubGlobal('fetch', fetchMock);
    const realMembership = new ArtistDetailService(db as unknown as PrismaClient, new LidarrService({ url: 'http://localhost:8686', apiKey: 'test-key' }), metadata);

    const detail = await realMembership.getArtistDetail(mbid, 1, { signal: caller.signal });
    expect(detail.sources).toHaveLength(1);
    expect(detail.membership).toBe('unknown');
    expect(detail.unavailable).toEqual(['membership']);
    expect(providerSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('bounds a stalled database read and prevents late continuation queries after expiry', async () => {
    results = [result(1), result(2)];
    const cursor = (await service.getArtistDetail(mbid, 1, { limit: 1 })).sourcesNextCursor!;
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    let finishSources: ((rows: ReturnType<typeof result>[]) => void) | undefined;
    db.subscriptionResult.findMany.mockImplementationOnce(() => new Promise(resolve => { finishSources = resolve; }));
    const pending = service.getArtistDetail(mbid, 1, { cursor });
    await new Promise<void>(resolve => setImmediate(resolve));
    deadline.abort(new DOMException('Read budget expired', 'TimeoutError'));

    const detail = await pending;
    expect(detail).toMatchObject({ name: 'Provider Artist', membership: 'not-in-library', sources: [], sourcesNextCursor: null, unavailable: ['sources'] });
    finishSources!([]);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(db.subscriptionResult.findFirst).not.toHaveBeenCalled();
    expect(db.reviewItem.findFirst).not.toHaveBeenCalled();
  });
});
