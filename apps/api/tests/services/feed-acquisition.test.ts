import { describe, it, expect, vi } from 'vitest';
import { FeedService } from '../../src/services/FeedService.js';
import type { PrismaClient } from '@prisma/client';
import type { LidarrService } from '../../src/services/lidarr.js';

vi.mock('../../src/services/lidarr.js', () => ({ invalidateLidarrCache: vi.fn() }));
import { invalidateLidarrCache } from '../../src/services/lidarr.js';

const mbid = '11111111-1111-4111-8111-111111111111';
function setup(initial: Record<string, unknown>[] = [{}]) {
  let rows = initial.map((extra, i) => ({ id: i + 1, name: 'Same name', itemType: 'artist', mbid,
    subscriptionId: 10, subscription: { userId: 1 }, status: 'pending', processedAt: null as Date | null,
    errorMessage: null as string | null, skipReason: null as string | null, ...extra }));
  const reviews = [{ id: 1, userId: 1, mbid }, { id: 2, userId: 2, mbid }, { id: 3, userId: 1, mbid: null }];
  const db = {
    subscriptionResult: {
      findMany: vi.fn(async ({ where }) => rows.filter(row => where.id.in.includes(row.id))),
      updateMany: vi.fn(async ({ where, data }) => {
        const selected = rows.filter(row => (typeof where.id === 'number' ? row.id === where.id : where.id.in.includes(row.id))
          && row.subscription.userId === where.subscription.userId && row.status === where.status
          && row.processedAt?.getTime() === where.processedAt?.getTime());
        selected.forEach(row => Object.assign(row, data)); return { count: selected.length };
      }),
    },
    reviewItem: { deleteMany: vi.fn(async ({ where }) => {
      let count = 0;
      for (let i = reviews.length - 1; i >= 0; i--) if (reviews[i].userId === where.userId && reviews[i].mbid === where.mbid) { reviews.splice(i, 1); count++; }
      return { count };
    }) },
    $transaction: vi.fn(async (fn) => { const before = structuredClone(rows); const oldReviews = structuredClone(reviews);
      try { return await fn(db); } catch (err) { rows = before; reviews.splice(0, reviews.length, ...oldReviews); throw err; } }),
  };
  const lidarr = { getArtistByMbid: vi.fn().mockResolvedValue(null), addArtistWithCacheWarm: vi.fn().mockResolvedValue({ artist: { foreignArtistId: mbid } }),
    getQualityProfiles: vi.fn().mockResolvedValue([{ id: 2 }]), getMetadataProfiles: vi.fn().mockResolvedValue([{ id: 3 }]), getRootFolders: vi.fn().mockResolvedValue([{ path: '/music' }]) };
  const service = new FeedService(db as unknown as PrismaClient, lidarr as unknown as LidarrService,
    { url: 'http://lidarr.test', qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/music', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' } as never);
  return { service, db, lidarr, reviews, rows: () => rows };
}

describe('Feed acquisition claims', () => {
  it.each(['feed-', 'feed-1x', 'feed-0', 'feed--1', 'feed-9007199254740992', `feed-${Array.from({ length: 101 }, (_, i) => i + 1).join('-')}`])('rejects malformed/bounded ID %s without writes', async id => {
    const s = setup(); await expect(s.service.approve(id, 1)).rejects.toMatchObject({ code: 'INVALID_FEED_ID' });
    expect(s.db.subscriptionResult.updateMany).not.toHaveBeenCalled();
  });
  it('requires every linked ID to exist', async () => {
    const s = setup(); await expect(s.service.approve('feed-1-2', 1)).rejects.toThrow('Feed item not found'); expect(s.lidarr.getArtistByMbid).not.toHaveBeenCalled();
  });
  it('rejects any foreign linked row without side effects', async () => {
    const s = setup([{}, { subscription: { userId: 2 } }]); await expect(s.service.approve('feed-1-2', 1)).rejects.toThrow('Not authorized'); expect(s.db.$transaction).not.toHaveBeenCalled();
  });
  it('rejects mixed identities and unresolved exact same names', async () => {
    const s = setup([{}, { mbid: null }]); await expect(s.service.approve('feed-1-2', 1)).rejects.toMatchObject({ code: 'INVALID_AGGREGATE' });
  });
  it('does not mutate missing identity or connection', async () => {
    const s = setup([{ mbid: null }]); await expect(s.service.approve('feed-1', 1)).rejects.toMatchObject({ code: 'IDENTITY_REQUIRED' });
    const noConnection = new FeedService(s.db as unknown as PrismaClient);
    s.rows()[0].mbid = mbid; await expect(noConnection.approve('feed-1', 1)).rejects.toMatchObject({ code: 'CONNECTION_REQUIRED' });
    expect(s.db.$transaction).not.toHaveBeenCalled();
  });
  it('awaits confirmation; deduplicates IDs and atomically finalizes every own claim', async () => {
    const s = setup([{}, {}]); let confirm!: () => void;
    s.lidarr.addArtistWithCacheWarm.mockImplementationOnce(() => new Promise(resolve => { confirm = () => resolve({ artist: { foreignArtistId: mbid } }); }));
    const operation = s.service.approve('feed-1-2-1', 1); await vi.waitFor(() => expect(confirm).toBeTypeOf('function'));
    expect(s.rows().map(r => r.status)).toEqual(['adding', 'adding']); expect(s.db.reviewItem.deleteMany).not.toHaveBeenCalled();
    await expect(s.service.approve('feed-1-2', 1)).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    await expect(s.service.dismiss('feed-1', 1)).rejects.toMatchObject({ code: 'IN_PROGRESS' });
    confirm(); expect((await operation).outcome.state).toBe('added'); expect(s.rows().map(r => r.status)).toEqual(['added', 'added']);
    expect(s.reviews.map(r => r.id)).toEqual([2, 3]);
    expect(s.lidarr.addArtistWithCacheWarm).toHaveBeenCalledWith(mbid, 2, 3, '/music', true, false, false, 'future', 'none', expect.any(AbortSignal));
  });
  it('uses exact existing membership without POST', async () => {
    const s = setup(); s.lidarr.getArtistByMbid.mockResolvedValue({ foreignArtistId: mbid });
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('already-in-library'); expect(s.lidarr.addArtistWithCacheWarm).not.toHaveBeenCalled();
  });
  it('retains sanitized definite failure for retry', async () => {
    const s = setup(); s.lidarr.addArtistWithCacheWarm.mockRejectedValue(Object.assign(new Error('Lidarr API error: 400 - secret=apikey'), { status: 400 }));
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('failed'); expect(s.rows()[0].status).toBe('failed'); expect(s.rows()[0].errorMessage).not.toContain('secret');
    expect(s.reviews).toHaveLength(3);
  });
  it('treats provider HTTP408 as uncertainty', async () => {
    const s = setup(); s.lidarr.addArtistWithCacheWarm.mockRejectedValue(Object.assign(new Error('Timeout'), { status: 408 }));
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('uncertain');
  });
  it('records uncertainty and reconciles membership before a retry can POST', async () => {
    const s = setup(); s.lidarr.addArtistWithCacheWarm.mockRejectedValueOnce(new Error('fetch failed'));
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('uncertain'); expect(s.rows()[0].skipReason).toBe('acquisition_uncertain');
    s.lidarr.getArtistByMbid.mockResolvedValue({ foreignArtistId: mbid });
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('already-in-library'); expect(s.lidarr.addArtistWithCacheWarm).toHaveBeenCalledTimes(1);
  });
  it('reconciles a stale claim and advances its revision', async () => {
    const old = new Date(Date.now() - 121_000); const s = setup([{ status: 'adding', processedAt: old }]); s.lidarr.getArtistByMbid.mockResolvedValue({ foreignArtistId: mbid });
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('already-in-library'); expect(s.rows()[0].processedAt!.getTime()).toBeGreaterThan(old.getTime());
  });
  it('rolls back partial aggregate claims on a competing writer', async () => {
    const s = setup([{}, {}]); const original = s.db.subscriptionResult.updateMany.getMockImplementation()!;
    s.db.subscriptionResult.updateMany.mockImplementation(async args => args.where.id === 2 ? { count: 0 } : original(args));
    await expect(s.service.approve('feed-1-2', 1)).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.rows().map(r => r.status)).toEqual(['pending', 'pending']); expect(s.lidarr.addArtistWithCacheWarm).not.toHaveBeenCalled();
  });
  it('keeps a newer local decision when provider succeeds after claim loss', async () => {
    const s = setup(); s.lidarr.addArtistWithCacheWarm.mockImplementation(async () => { s.rows()[0].status = 'rejected'; s.rows()[0].processedAt = new Date(Date.now() + 1_000); return { artist: {} }; });
    s.lidarr.getArtistByMbid.mockResolvedValueOnce(null).mockResolvedValue({ foreignArtistId: mbid });
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('already-in-library'); expect(s.rows()[0].status).toBe('rejected'); expect(s.db.reviewItem.deleteMany).not.toHaveBeenCalled();
  });
  it('invalidates provider cache when a lost uncertain claim is later reconciled', async () => {
    const s = setup(); vi.mocked(invalidateLidarrCache).mockClear();
    s.lidarr.addArtistWithCacheWarm.mockImplementation(async () => { s.rows()[0].status = 'rejected'; throw new Error('fetch failed'); });
    s.lidarr.getArtistByMbid.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ foreignArtistId: mbid });
    expect((await s.service.approve('feed-1', 1)).outcome.state).toBe('already-in-library');
    expect(invalidateLidarrCache).toHaveBeenCalledWith('http://lidarr.test');
  });
  it('allows different aggregates for one identity to reconcile duplicate errors', async () => {
    const s = setup([{}, {}]); s.lidarr.getArtistByMbid.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ foreignArtistId: mbid });
    s.lidarr.addArtistWithCacheWarm.mockRejectedValue(new Error('Lidarr API error: 400 - duplicate'));
    const outcomes = await Promise.all([s.service.approve('feed-1', 1), s.service.approve('feed-2', 1)]);
    expect(outcomes.map(o => o.outcome.state)).toEqual(['already-in-library', 'already-in-library']);
  });
  it('never starts provider work with an expired signal', async () => {
    const s = setup(); const controller = new AbortController(); controller.abort();
    await expect(s.service.approve('feed-1', 1, controller.signal)).rejects.toThrow(); expect(s.db.$transaction).not.toHaveBeenCalled(); expect(s.lidarr.getArtistByMbid).not.toHaveBeenCalled();
  });
  it('exposes an expired adding lease as unconfirmed so Retry is reachable', () => {
    const s = setup();
    const item = { id: 1, artistName: 'Artist', artistMbid: mbid, subscriptionId: 10, sources: [], createdAt: new Date(), status: 'adding', processedAt: new Date(Date.now() - 121_000) };
    expect(s.service.aggregateResults([item])[0].acquisitionState).toBe('uncertain');
    expect(s.service.aggregateResults([{ ...item, processedAt: new Date() }])[0].acquisitionState).toBe('adding');
  });
  it('keeps review evidence intact on a monotonic conditional dismissal', async () => {
    const s = setup(); await s.service.dismiss('feed-1', 1); expect(s.rows()[0].status).toBe('rejected'); expect(s.reviews).toHaveLength(3);
    await expect(s.service.dismiss('feed-1', 1)).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
  });
  it('binds an explicit identity to all owned unresolved records atomically and passes selected options', async () => {
    const s = setup([{ mbid: null }, { mbid: null }]); const signal = new AbortController().signal;
    s.lidarr.getQualityProfiles.mockResolvedValue([{ id: 9 }]); s.lidarr.getMetadataProfiles.mockResolvedValue([{ id: 8 }]); s.lidarr.getRootFolders.mockResolvedValue([{ path: '/archive' }]);
    const response = await s.service.approve('feed-1-2', 1, signal, { mbid, qualityProfileId: 9, metadataProfileId: 8, rootFolderPath: '/archive', monitorOption: 'missing', monitorNewItems: 'new', searchOnAdd: false });
    expect(response.outcome.state).toBe('added'); expect(s.rows().every(row => row.mbid === mbid && row.status === 'added')).toBe(true);
    expect(s.lidarr.addArtistWithCacheWarm).toHaveBeenCalledWith(mbid, 9, 8, '/archive', true, false, false, 'missing', 'new', signal);
    expect(s.lidarr.getQualityProfiles).toHaveBeenCalledWith(signal); expect(s.lidarr.getRootFolders).toHaveBeenCalledWith(signal);
    expect(s.db.subscriptionResult.updateMany.mock.calls[0][0].where).toMatchObject({ id: 1, status: 'pending', processedAt: null, mbid: null, subscription: { userId: 1 } });
  });
  it('rolls back all explicit identity assignments when an aggregate claim loses its revision', async () => {
    const s = setup([{ mbid: null }, { mbid: null }]);
    const write = s.db.subscriptionResult.updateMany.getMockImplementation()!;
    s.db.subscriptionResult.updateMany.mockImplementationOnce(write).mockResolvedValueOnce({ count: 0 });
    await expect(s.service.approve('feed-1-2', 1, new AbortController().signal, { mbid })).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.rows().every(row => row.mbid === null && row.status === 'pending')).toBe(true); expect(s.lidarr.addArtistWithCacheWarm).not.toHaveBeenCalled();
  });
  it('does not replace an existing identity or combine unrelated unresolved names', async () => {
    const s = setup(); await expect(s.service.approve('feed-1', 1, new AbortController().signal, { mbid: '22222222-2222-4222-8222-222222222222' })).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' });
    const unknown = setup([{ mbid: null }, { mbid: null, name: 'Other artist' }]);
    await expect(unknown.service.approve('feed-1-2', 1, new AbortController().signal, { mbid })).rejects.toMatchObject({ code: 'INVALID_AGGREGATE' });
    expect(s.db.$transaction).not.toHaveBeenCalled(); expect(unknown.db.$transaction).not.toHaveBeenCalled();
  });

});
