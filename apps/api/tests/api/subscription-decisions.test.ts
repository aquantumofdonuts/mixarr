import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  subscription: { findUnique: vi.fn() },
  subscriptionResult: { findFirst: vi.fn(), updateMany: vi.fn() },
  connection: { findFirst: vi.fn() },
  logEntry: { create: vi.fn() },
  transaction: vi.fn(),
  membership: vi.fn(), albums: vi.fn(), addArtist: vi.fn(), addAlbum: vi.fn(),
  profiles: vi.fn(), folders: vi.fn(), notify: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('../../src/lib/db.js', () => ({ default: {
  subscription: mocks.subscription, subscriptionResult: mocks.subscriptionResult,
  connection: mocks.connection, logEntry: mocks.logEntry, $transaction: mocks.transaction,
} }));
vi.mock('../../src/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.user = { id: 1, role: req.headers['x-admin'] ? 'admin' : 'user' }; next();
} }));
vi.mock('../../src/controllers/subscriptions.controller.js', () => ({ subscriptionController: {
  list: vi.fn(), getById: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), execute: vi.fn(),
  getRunHistory: vi.fn(), getRunDetails: vi.fn(),
} }));
vi.mock('../../src/services/artist-images.js', () => ({ getArtistImages: vi.fn() }));
vi.mock('../../src/services/notifications.js', () => ({ notificationService: { send: mocks.notify } }));
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class {
    getArtistByMbid = mocks.membership;
    getAlbums = mocks.albums;
    addArtistWithCacheWarm = mocks.addArtist;
    addAlbumWithCacheWarm = mocks.addAlbum;
    getQualityProfiles = mocks.profiles;
    getMetadataProfiles = mocks.profiles;
    getRootFolders = mocks.folders;
  },
  getSharedLidarrCache: vi.fn(), invalidateLidarrCache: mocks.invalidate,
}));
vi.mock('../../src/lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { subscriptionsRouter } from '../../src/routes/subscriptions.js';
const mbid = '11111111-1111-4111-8111-111111111111';
const otherMbid = '22222222-2222-4222-8222-222222222222';
const initialRevision = new Date('2026-10-08T00:00:00.000Z');
let row: { id: number; subscriptionId: number; status: string; processedAt: Date | null; mbid: string | null;
  name: string; itemType: string; albumMbid: string | null };
let ownerId: number;
let app: express.Application;
let writes: any[];

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(initialRevision.getTime());
  ownerId = 1;
  row = { id: 3, subscriptionId: 2, status: 'pending', processedAt: initialRevision, mbid,
    name: 'Same Name', itemType: 'artist', albumMbid: null };
  writes = [];
  mocks.subscription.findUnique.mockImplementation(async ({ where }) => where.id === 2 ? { id: 2, userId: ownerId, name: 'Daily' } : null);
  mocks.subscriptionResult.findFirst.mockImplementation(async ({ where }) =>
    where.id === row.id && where.subscriptionId === row.subscriptionId &&
    (!where.subscription || where.subscription.userId === ownerId) ? { ...row } : null);
  mocks.subscriptionResult.updateMany.mockImplementation(async ({ where, data }) => {
    writes.push({ where, data });
    if (where.id !== row.id || where.subscriptionId !== row.subscriptionId ||
      where.subscription.userId !== ownerId || where.status !== row.status ||
      (where.processedAt?.getTime() ?? null) !== (row.processedAt?.getTime() ?? null) ||
      ('mbid' in where && where.mbid !== row.mbid)) return { count: 0 };
    Object.assign(row, data);
    return { count: 1 };
  });
  mocks.transaction.mockImplementation(async callback => {
    const before = { ...row };
    try { return await callback({ subscriptionResult: mocks.subscriptionResult }); }
    catch (error) { row = before; throw error; }
  });
  mocks.connection.findFirst.mockResolvedValue({ config: {
    url: 'http://lidarr.test', apiKey: 'secret', qualityProfileId: 1, metadataProfileId: 2, rootFolderPath: '/music',
  } });
  mocks.membership.mockResolvedValue(null);
  mocks.albums.mockResolvedValue([]);
  mocks.addArtist.mockResolvedValue({ artist: { foreignArtistId: mbid } });
  mocks.addAlbum.mockResolvedValue({});
  mocks.logEntry.create.mockResolvedValue({});
  mocks.notify.mockResolvedValue(undefined);
  app = express(); app.use(express.json()); app.use('/api/subscriptions', subscriptionsRouter);
});
afterEach(() => vi.restoreAllMocks());
const approve = (body = {}) => request(app).post('/api/subscriptions/2/results/3/approve').send(body);
const reject = () => request(app).post('/api/subscriptions/2/results/3/reject').send({});

describe('owned subscription result decisions through the actual router', () => {
  it('requires explicit identity for same-name unresolved candidates without mutating', async () => {
    row.mbid = null;
    const response = await approve();
    expect(response.status).toBe(422); expect(response.body.code).toBe('IDENTITY_REQUIRED');
    expect(writes).toHaveLength(0); expect(mocks.membership).not.toHaveBeenCalled();
    expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('requires a valid stored MBID and treats an unknown adding lease as a conflict', async () => {
    row.mbid = 'legacy-name';
    expect((await approve()).body.code).toBe('IDENTITY_REQUIRED');
    row.mbid = mbid; row.status = 'adding'; row.processedAt = null;
    expect((await approve()).body.code).toBe('IN_PROGRESS');
    expect(writes).toHaveLength(0); expect(mocks.membership).not.toHaveBeenCalled();
  });
  it('persists the explicitly selected canonical identity before claiming and adding', async () => {
    row.mbid = null;
    const response = await approve({ mbid: otherMbid });
    expect(response.status).toBe(200); expect(row.mbid).toBe(otherMbid); expect(row.status).toBe('added');
    expect(writes[0].where.mbid).toBeNull(); expect(writes[0].data.status).toBeUndefined();
    expect(mocks.addArtist.mock.calls[0][0]).toBe(otherMbid);
    expect(mocks.addArtist.mock.calls[0][9]).toBeInstanceOf(AbortSignal);
    expect(writes.map(write => write.data.processedAt.getTime())).toEqual([
      initialRevision.getTime() + 1, initialRevision.getTime() + 2, initialRevision.getTime() + 3,
    ]);
  });
  it('normalizes UUID case without guessing artist identity', async () => {
    row.mbid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    expect((await approve()).status).toBe(200);
    expect(row.mbid).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(mocks.addArtist.mock.calls[0][0]).toBe(row.mbid);
  });
  it('reports uncertain state if the final database write fails after provider success', async () => {
    mocks.subscriptionResult.updateMany.mockImplementationOnce(async ({ data }) => {
      Object.assign(row, data); return { count: 1 };
    }).mockRejectedValueOnce(new Error('database connection lost'));
    const response = await approve();
    expect(response.status).toBe(503); expect(response.body.outcome).toBe('uncertain');
    expect(row.status).toBe('adding'); expect(mocks.addArtist).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed identity and cannot replace an existing identity', async () => {
    expect((await approve({ mbid: 'guessed-name' })).status).toBe(400);
    expect((await approve({ mbid: otherMbid })).status).toBe(409);
    expect(writes).toHaveLength(0);
  });
  it('honors the effective search-on-add setting for artist approval', async () => {
    mocks.connection.findFirst.mockResolvedValue({ config: {
      url: 'http://lidarr.test', apiKey: 'secret', qualityProfileId: 1, metadataProfileId: 2,
      rootFolderPath: '/music', searchOnAdd: false,
    } });
    expect((await approve()).status).toBe(200);
    expect(mocks.addArtist.mock.calls[0][5]).toBe(false);
  });
  it.each(['album', 'unknown'])('requires valid item identity for %s before claiming', async itemType => {
    row.itemType = itemType; row.albumMbid = null;
    const response = await approve(); expect(response.status).toBe(422); expect(response.body.code).toBe('IDENTITY_REQUIRED');
    expect(mocks.subscriptionResult.updateMany).not.toHaveBeenCalled();
  });
  it('does not mutate when no Lidarr connection exists', async () => {
    mocks.connection.findFirst.mockResolvedValue(null);
    const response = await approve();
    expect(response.status).toBe(409); expect(response.body.code).toBe('CONNECTION_REQUIRED');
    expect(writes).toHaveLength(0);
  });
  it('refuses foreign owners even for an admin and foreign result route bindings', async () => {
    ownerId = 2;
    expect((await approve()).status).toBe(404);
    expect((await request(app).post('/api/subscriptions/2/results/3/approve').set('x-admin', '1').send({})).status).toBe(404);
    expect((await reject()).status).toBe(404);
    ownerId = 1;
    expect((await request(app).post('/api/subscriptions/2/results/999/reject').send({})).status).toBe(404);
    expect(writes).toHaveLength(0);
  });
  it('refuses a fresh adding lease on approvals and rejections', async () => {
    row.status = 'adding';
    expect((await approve()).body.code).toBe('IN_PROGRESS');
    expect((await reject()).body.code).toBe('IN_PROGRESS');
    expect(mocks.membership).not.toHaveBeenCalled(); expect(writes).toHaveLength(0);
  });
  it('claims only once under simultaneous approval requests', async () => {
    const responses = await Promise.all([approve(), approve()]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(mocks.addArtist).toHaveBeenCalledTimes(1);
  });
  it('reconciles stale claims before reclaiming without repeating an existing add', async () => {
    row.status = 'adding'; row.processedAt = new Date(initialRevision.getTime() - 120_001);
    mocks.membership.mockImplementation(async () => {
      expect(writes).toHaveLength(0); return { id: 1, foreignArtistId: mbid };
    });
    const response = await approve();
    expect(response.body.outcome).toBe('already-in-library'); expect(row.status).toBe('added');
    expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('retries failed results by reconciling canonical membership first', async () => {
    row.status = 'failed'; mocks.membership.mockResolvedValue({ id: 1, foreignArtistId: mbid });
    const response = await approve();
    expect(response.body.outcome).toBe('already-in-library'); expect(row.status).toBe('added');
    expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('never trusts duplicate error strings without exact membership', async () => {
    mocks.addArtist.mockRejectedValue(Object.assign(new Error('secret already exists'), { status: 400 }));
    const response = await approve();
    expect(response.status).toBe(502); expect(row.status).toBe('failed');
    expect(response.body.code).toBe('PROVIDER_REJECTED'); expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('reconciles duplicate provider effects before confirming success', async () => {
    mocks.membership.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 1, foreignArtistId: mbid });
    mocks.addArtist.mockRejectedValue(Object.assign(new Error('duplicate'), { status: 400 }));
    expect((await approve()).body.outcome).toBe('already-in-library'); expect(row.status).toBe('added');
  });
  it('stores an uncertain machine reason for unreachable outcomes', async () => {
    mocks.addArtist.mockRejectedValue(new Error('connection secret failed'));
    const response = await approve();
    expect(response.status).toBe(503); expect(response.body.outcome).toBe('uncertain');
    expect(row.status).toBe('failed'); expect(writes.at(-1).data.errorMessage).toContain('ACQUISITION_UNCERTAIN');
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
  it('preserves a newer decision when finalization conflicts after a real side effect', async () => {
    mocks.addArtist.mockImplementation(async () => {
      row.status = 'rejected'; row.processedAt = new Date(initialRevision.getTime() + 5);
      mocks.membership.mockResolvedValue({ id: 1, foreignArtistId: mbid });
    });
    const response = await approve();
    expect(response.status).toBe(409); expect(response.body.outcome).toBe('already-in-library');
    expect(row.status).toBe('rejected'); expect(mocks.invalidate).toHaveBeenCalled();
  });
  it('invalidates membership cache when a lost uncertain claim reconciles as confirmed', async () => {
    mocks.addArtist.mockImplementation(async () => { row.status = 'rejected'; row.processedAt = new Date(Date.now() + 100); throw new Error('fetch failed'); });
    mocks.membership.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ id: 10, foreignArtistId: mbid });
    const response = await approve(); expect(response.status).toBe(409); expect(response.body.outcome).toBe('already-in-library');
    expect(row.status).toBe('rejected'); expect(mocks.invalidate).toHaveBeenCalled();
  });
  it('does not convert confirmed success into failure when notifications fail', async () => {
    mocks.notify.mockRejectedValue(new Error('notification failed'));
    expect((await approve()).status).toBe(200); expect(row.status).toBe('added'); expect(writes).toHaveLength(2);
  });
  it('preserves targeted album acquisition when only its artist exists', async () => {
    row.itemType = 'album'; row.albumMbid = otherMbid;
    mocks.membership.mockResolvedValue({ id: 10, foreignArtistId: mbid });
    expect((await approve()).status).toBe(200);
    expect(mocks.addArtist).not.toHaveBeenCalled();
    expect(mocks.addAlbum).toHaveBeenCalledWith(mbid, otherMbid, 1, 2, '/music', expect.any(AbortSignal));
  });
  it('monitors and searches an existing unmonitored album through targeted acquisition', async () => {
    row.itemType = 'album'; row.albumMbid = otherMbid;
    mocks.membership.mockResolvedValue({ id: 10, foreignArtistId: mbid });
    mocks.albums.mockResolvedValue([{ foreignAlbumId: otherMbid, monitored: false }]);
    const response = await approve();
    expect(response.status).toBe(200); expect(response.body.outcome).toBe('added');
    expect(mocks.addAlbum).toHaveBeenCalledWith(mbid, otherMbid, 1, 2, '/music', expect.any(AbortSignal));
    expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('reconciles an existing monitored album without repeating targeted acquisition', async () => {
    row.itemType = 'album'; row.albumMbid = otherMbid;
    mocks.membership.mockResolvedValue({ id: 10, foreignArtistId: mbid });
    mocks.albums.mockResolvedValue([{ foreignAlbumId: otherMbid, monitored: true }]);
    const response = await approve();
    expect(response.status).toBe(200); expect(response.body.outcome).toBe('already-in-library');
    expect(mocks.addAlbum).not.toHaveBeenCalled();
  });
  it('advances reject revisions under a frozen clock and refuses no-op decisions', async () => {
    expect((await reject()).status).toBe(200); expect(row.processedAt?.getTime()).toBe(initialRevision.getTime() + 1);
    expect((await reject()).status).toBe(409); expect(writes).toHaveLength(1);
  });
  it('does not start a claim or provider operation when config lookup exhausts its deadline', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    mocks.connection.findFirst.mockImplementation(async () => { controller.abort(); return { config: {} }; });
    const response = await approve();
    expect(response.status).toBe(503); expect(writes).toHaveLength(0);
    expect(mocks.membership).not.toHaveBeenCalled(); expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('ends a stalled read when its deadline aborts without acquiring', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    mocks.connection.findFirst.mockImplementation(() => {
      queueMicrotask(() => controller.abort()); return new Promise(() => {});
    });
    expect((await approve()).status).toBe(503); expect(writes).toHaveLength(0);
    expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('returns confirmed success without waiting for notification delivery', async () => {
    mocks.notify.mockImplementation(() => new Promise(() => {}));
    expect((await approve()).status).toBe(200); expect(row.status).toBe('added');
  });
  it('stops after an aborted provider lookup and retains an uncertain retryable result', async () => {
    const controller = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    mocks.membership.mockImplementation(async (_mbid, signal) => {
      expect(signal).toBe(controller.signal); controller.abort(); signal.throwIfAborted();
    });
    expect((await approve()).body.code).toBe('ACQUISITION_UNCERTAIN');
    expect(row.status).toBe('failed'); expect(mocks.addArtist).not.toHaveBeenCalled();
  });
  it('shares the operation signal with fallback options and acquisition', async () => {
    mocks.connection.findFirst.mockResolvedValue({ config: { url: 'http://lidarr.test', apiKey: 'secret' } });
    mocks.profiles.mockResolvedValue([{ id: 10 }]); mocks.folders.mockResolvedValue([{ path: '/fallback' }]);
    expect((await approve()).status).toBe(200);
    const signal = mocks.addArtist.mock.calls[0][9];
    expect(mocks.membership.mock.calls[0][1]).toBe(signal);
    expect(mocks.profiles.mock.calls.every(call => call[0] === signal)).toBe(true);
    expect(mocks.folders).toHaveBeenCalledWith(signal);
  });
  it('refuses rejection while an acquisition is actually running', async () => {
    let release!: () => void;
    let started!: () => void;
    const start = new Promise<void>(resolve => { started = resolve; });
    mocks.addArtist.mockImplementation(async () => { started(); await new Promise<void>(resolve => { release = resolve; }); });
    const approval = approve().then(response => response);
    await start;
    const rejection = await reject();
    expect(rejection.status).toBe(409); expect(rejection.body.code).toBe('IN_PROGRESS');
    release(); expect((await approval).status).toBe(200); expect(row.status).toBe('added');
  });
  it('does not treat existing artist membership as confirmation of a failed album acquisition', async () => {
    row.itemType = 'album'; row.albumMbid = otherMbid;
    mocks.membership.mockResolvedValue({ id: 10, foreignArtistId: mbid });
    mocks.addAlbum.mockRejectedValue(Object.assign(new Error('album failed'), { status: 400 }));
    expect((await approve()).status).toBe(502); expect(row.status).toBe('failed');
  });
  it('returns conflict when a competing decision wins the rejection CAS', async () => {
    mocks.subscriptionResult.updateMany.mockResolvedValue({ count: 0 });
    expect((await reject()).status).toBe(409); expect(row.status).toBe('pending');
  });
});
