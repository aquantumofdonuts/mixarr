import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), transaction: vi.fn(),
  connection: vi.fn(), exists: vi.fn(), addArtist: vi.fn(), addAlbum: vi.fn(),
  profiles: vi.fn(), folders: vi.fn(), log: vi.fn(), notify: vi.fn(),
}));
vi.mock('../../src/lib/db.js', () => ({ default: {
  reviewItem: { findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany },
  connection: { findFirst: mocks.connection }, $transaction: mocks.transaction,
} }));
vi.mock('../../src/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.user = { id: Number(req.headers['x-user'] || 1), role: req.headers['x-admin'] ? 'admin' : 'user' }; next();
} }));
vi.mock('../../src/jobs/scheduler.js', () => ({ addImportScheduledJob: vi.fn(), removeImportScheduledJob: vi.fn() }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: vi.fn() }));
vi.mock('../../src/services/lastfm.js', () => ({ LastfmService: vi.fn() }));
vi.mock('../../src/services/ai.js', () => ({ AIService: vi.fn() }));
vi.mock('../../src/services/musicbrainz.js', () => ({ MusicBrainzService: vi.fn() }));
vi.mock('../../src/services/artist-images.js', () => ({ getArtistImages: vi.fn() }));
vi.mock('../../src/services/public-playlist.js', () => ({ parseSpotifyPlaylistUrl: vi.fn(), importPublicPlaylist: vi.fn() }));
vi.mock('../../src/services/notifications.js', () => ({ notificationService: { send: mocks.notify } }));
vi.mock('../../src/routes/logs.js', () => ({ addLogEntry: mocks.log }));
vi.mock('../../src/services/lidarr.js', () => ({
  LidarrService: class {
    addArtistWithCacheWarm = mocks.addArtist; addAlbumWithCacheWarm = mocks.addAlbum;
    getQualityProfiles = mocks.profiles; getMetadataProfiles = mocks.profiles; getRootFolders = mocks.folders;
  },
  LidarrCache: class { refresh = vi.fn(); exists = mocks.exists; },
}));
vi.mock('../../src/lib/logger.js', () => ({ createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { importsRouter } from '../../src/routes/imports.js';
import { createDecisionUndo } from '../../src/lib/decision-undo.js';
const now = new Date('2026-10-08T00:00:00.000Z').getTime();
const mbid = '11111111-1111-4111-8111-111111111111';
let rows: Array<{ id: number; userId: number; status: string; updatedAt: Date; source: string;
  artistName: string; mbid: string; itemType: string; albumMbid: string | null }>;
let app: express.Application;
let updates: any[];

beforeEach(() => {
  vi.resetAllMocks(); vi.spyOn(Date, 'now').mockReturnValue(now);
  process.env.SESSION_SECRET = 'test-review-undo-secret';
  rows = [1, 2].map(id => ({ id, userId: 1, status: 'pending', updatedAt: new Date(now), source: 'subscription:one',
    artistName: 'Same Name', mbid, itemType: 'artist', albumMbid: null }));
  updates = [];
  const matches = (row: typeof rows[number], where: any) =>
    (where.id === undefined || typeof where.id === 'number' && where.id === row.id || where.id?.in?.includes(row.id)) &&
    (where.userId === undefined || where.userId === row.userId) &&
    (where.status === undefined || where.status === row.status) &&
    (where.updatedAt === undefined || where.updatedAt.getTime() === row.updatedAt.getTime());
  mocks.findFirst.mockImplementation(async ({ where }) => {
    const row = rows.find(row => matches(row, where)); return row ? { ...row } : null;
  });
  mocks.findMany.mockImplementation(async ({ where }) => rows.filter(row => matches(row, where)).map(row => ({ ...row })));
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    updates.push({ where, data });
    const matching = rows.filter(row => matches(row, where)); matching.forEach(row => Object.assign(row, data));
    return { count: matching.length };
  });
  mocks.transaction.mockImplementation(async callback => {
    const snapshot = rows.map(row => ({ ...row }));
    try { return await callback({ reviewItem: { findFirst: mocks.findFirst, findMany: mocks.findMany, updateMany: mocks.updateMany } }); }
    catch (error) { rows = snapshot; throw error; }
  });
  mocks.connection.mockResolvedValue({ config: { url: 'http://lidarr.test', apiKey: 'secret' } });
  mocks.exists.mockResolvedValue(false); mocks.addArtist.mockResolvedValue({}); mocks.addAlbum.mockResolvedValue({});
  mocks.profiles.mockResolvedValue([{ id: 1 }]); mocks.folders.mockResolvedValue([{ path: '/music' }]);
  mocks.log.mockResolvedValue(undefined); mocks.notify.mockResolvedValue(undefined);
  app = express(); app.use(express.json()); app.use('/api/imports', importsRouter);
});
afterEach(() => vi.restoreAllMocks());
const reject = (id = 1) => request(app).put(`/api/imports/review/${id}`).send({ status: 'rejected' });
const restore = (undoToken: string) => request(app).post('/api/imports/review/restore').send({ undoToken });
const bulk = (ids: number[], status = 'rejected') => request(app).post('/api/imports/review/bulk').send({ ids, status });

describe('review decisions through the real router and signed Undo helper', () => {
  it('retains rejected rows and restores them through the authenticated static route', async () => {
    const decision = await reject();
    expect(decision.status).toBe(200); expect(decision.body.undoToken).toBeTypeOf('string');
    expect(rows[0].status).toBe('rejected'); expect(rows).toHaveLength(2);
    expect(rows[0].updatedAt.getTime()).toBe(now + 1);
    const response = await restore(decision.body.undoToken);
    expect(response.status).toBe(200); expect(response.body.restoredIds).toEqual([1]);
    expect(rows[0].status).toBe('pending'); expect(rows[0].updatedAt.getTime()).toBe(now + 2);
  });
  it('preserves source metadata when restoring a decision', async () => {
    const decision = await reject(); rows[0].source = 'subscription:one, discovered:later';
    expect((await restore(decision.body.undoToken)).status).toBe(200);
    expect(rows[0].source).toBe('subscription:one, discovered:later');
  });
  it('rejects legacy tokenless pending transitions for both mutation paths', async () => {
    rows[0].status = 'rejected';
    expect((await request(app).put('/api/imports/review/1').send({ status: 'pending' })).status).toBe(400);
    expect((await bulk([1], 'pending')).status).toBe(400); expect(updates).toHaveLength(0);
  });
  it('rejects processed no-op decisions before provider calls or token generation', async () => {
    rows[0].status = 'approved';
    expect((await reject()).status).toBe(409);
    expect((await request(app).put('/api/imports/review/1').send({ status: 'approved' })).status).toBe(409);
    expect(mocks.connection).not.toHaveBeenCalled(); expect(updates).toHaveLength(0);
  });
  it('requires strict ownership for single decisions including admin mutations', async () => {
    rows[0].userId = 2;
    expect((await reject()).status).toBe(404);
    expect((await request(app).put('/api/imports/review/1').set('x-admin', '1').send({ status: 'rejected' })).status).toBe(404);
    expect(updates).toHaveLength(0);
  });
  it('atomically rejects all owned pending selected rows and restores all of them', async () => {
    const decision = await bulk([1, 2, 2]);
    expect(decision.status).toBe(200); expect(rows.every(row => row.status === 'rejected')).toBe(true);
    expect((await restore(decision.body.undoToken)).body.restoredIds).toEqual([1, 2]);
    expect(rows.every(row => row.status === 'pending')).toBe(true);
  });
  it('refuses bulk decisions with missing, foreign, or already processed IDs without changing owned rows', async () => {
    expect((await bulk([1, 999])).status).toBe(409);
    rows[1].userId = 2; expect((await bulk([1, 2])).status).toBe(409);
    rows[1].userId = 1; rows[1].status = 'rejected'; expect((await bulk([1, 2])).status).toBe(409);
    expect(rows[0].status).toBe('pending'); expect(updates).toHaveLength(0);
  });
  it('bounds selected IDs and encoded restoration tokens at the route boundary', async () => {
    expect((await bulk(Array.from({ length: 101 }, (_, i) => i + 1))).status).toBe(400);
    expect((await restore('a'.repeat(32 * 1024 + 1))).status).toBe(400);
    expect((await restore('')).status).toBe(400); expect(updates).toHaveLength(0);
  });
  it('does not mutate when the configured signing secret is unavailable', async () => {
    delete process.env.SESSION_SECRET;
    expect((await reject()).status).toBe(503); expect((await bulk([1, 2])).status).toBe(503);
    expect(updates).toHaveLength(0); expect(rows.every(row => row.status === 'pending')).toBe(true);
  });
  it('rejects tampered and actor-mismatched tokens', async () => {
    const decision = await reject(); const token = decision.body.undoToken as string;
    const last = token.at(-1); const tampered = token.slice(0, -1) + (last === 'A' ? 'B' : 'A');
    expect((await restore(tampered)).status).toBe(400);
    expect((await request(app).post('/api/imports/review/restore').set('x-user', '2').send({ undoToken: token })).status).toBe(400);
    expect(rows[0].status).toBe('rejected');
  });
  it('rejects signed tokens referencing foreign-owned records and the wrong decision kind', async () => {
    rows[1].userId = 2; rows[1].status = 'rejected';
    const foreign = createDecisionUndo(1, 'review-reject', [{ table: 'review-item', id: 2, originalStatus: 'pending', revision: now }]);
    expect((await restore(foreign.undoToken)).status).toBe(409);
    const wrongKind = createDecisionUndo(1, 'feed-dismiss', [{ table: 'subscription-result', id: 1,
      originalStatus: 'pending', revision: now }]);
    expect((await restore(wrongKind.undoToken)).status).toBe(400);
  });
  it('refuses expired tokens and current revision changes', async () => {
    const decision = await reject(); rows[0].updatedAt = new Date(now + 10);
    expect((await restore(decision.body.undoToken)).status).toBe(409);
    vi.mocked(Date.now).mockReturnValue(now + 120_000);
    expect((await restore(decision.body.undoToken)).body.code).toBe('UNDO_EXPIRED');
  });
  it('prevents frozen-clock replay after reject, restore, and a second reject', async () => {
    const first = await reject(); expect((await restore(first.body.undoToken)).status).toBe(200);
    const second = await reject(); expect(rows[0].updatedAt.getTime()).toBe(now + 3);
    expect(second.body.undoToken).not.toBe(first.body.undoToken);
    expect((await restore(first.body.undoToken)).status).toBe(409); expect(rows[0].status).toBe('rejected');
  });
  it('rolls back the whole rejection if any selected row loses its CAS', async () => {
    const write = mocks.updateMany.getMockImplementation()!;
    mocks.updateMany.mockImplementationOnce(write).mockResolvedValueOnce({ count: 0 });
    expect((await bulk([1, 2])).status).toBe(409);
    expect(rows.every(row => row.status === 'pending')).toBe(true);
  });
  it('rolls back the whole restoration if any selected row loses its CAS', async () => {
    const decision = await bulk([1, 2]);
    const write = mocks.updateMany.getMockImplementation()!;
    mocks.updateMany.mockImplementationOnce(write).mockResolvedValueOnce({ count: 0 });
    expect((await restore(decision.body.undoToken)).status).toBe(409);
    expect(rows.every(row => row.status === 'rejected')).toBe(true);
  });
  it('does not overwrite a newer rejection after an awaited provider side effect', async () => {
    mocks.addArtist.mockImplementation(async () => { rows[0].status = 'rejected'; rows[0].updatedAt = new Date(now + 2); });
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(409); expect(response.body.code).toBe('DECISION_CONFLICT');
    expect(rows[0].status).toBe('rejected'); expect(rows[0].updatedAt.getTime()).toBe(now + 2);
  });
  it('CAS finalizes already-in-library and targeted album approvals with advancing revisions', async () => {
    mocks.exists.mockResolvedValueOnce(true);
    expect((await request(app).put('/api/imports/review/1').send({ status: 'approved' })).status).toBe(200);
    expect(rows[0].status).toBe('approved'); expect(rows[0].updatedAt.getTime()).toBe(now + 1);
    rows[1].itemType = 'album'; rows[1].albumMbid = mbid;
    expect((await request(app).put('/api/imports/review/2').send({ status: 'approved' })).status).toBe(200);
    expect(mocks.addAlbum).toHaveBeenCalledTimes(1); expect(rows[1].updatedAt.getTime()).toBe(now + 1);
  });
  it('does not report a confirmed approval as failure when notification delivery fails', async () => {
    mocks.notify.mockRejectedValue(new Error('notification unavailable'));
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(200); expect(response.body.added).toBe(1);
    expect(rows[0].status).toBe('approved');
  });
  it('does not blindly reject a newer decision after bulk provider failure', async () => {
    mocks.addArtist.mockImplementation(async () => {
      rows[0].status = 'approved'; rows[0].updatedAt = new Date(now + 4); throw new Error('provider failure');
    });
    const response = await bulk([1], 'approved');
    expect(response.status).toBe(200); expect(response.body.failed).toBe(1);
    expect(rows[0].status).toBe('approved'); expect(rows[0].updatedAt.getTime()).toBe(now + 4);
  });
  it('passes effective options to targeted album approval even when the artist already exists', async () => {
    rows[0].itemType = 'album'; rows[0].albumMbid = mbid;
    mocks.exists.mockResolvedValue(true); mocks.profiles.mockResolvedValue([{ id: 8 }, { id: 9 }]); mocks.folders.mockResolvedValue([{ path: '/archive' }]);
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved', qualityProfileId: 9, metadataProfileId: 8, rootFolderPath: '/archive', searchOnAdd: false });
    expect(response.status).toBe(200);
    expect(mocks.addAlbum).toHaveBeenCalledWith(mbid, mbid, 9, 8, '/archive', undefined, false);
    expect(mocks.exists).not.toHaveBeenCalled(); expect(rows[0].status).toBe('approved');
  });
  it('requires an explicit canonical choice for an unidentified review without acquiring', async () => {
    rows[0].mbid = null as never;
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(422); expect(response.body.code).toBe('IDENTITY_REQUIRED');
    expect(mocks.addArtist).not.toHaveBeenCalled(); expect(rows[0].status).toBe('pending');
  });
  it('reports original successful and failed IDs and retains failed review items for option retries', async () => {
    mocks.addArtist.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Provider unavailable'));
    const response = await bulk([1, 2], 'approved');
    expect(response.status).toBe(200); expect(response.body.success).toBe(false);
    expect(response.body.addedIds).toEqual([1]); expect(response.body.failedIds).toEqual([2]);
    expect(rows[0].status).toBe('approved'); expect(rows[1].status).toBe('pending');
  });

  it('does not turn an unidentified album review into a whole artist addition', async () => {
    rows[0].itemType = 'album'; rows[0].albumMbid = null;
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(422); expect(mocks.addArtist).not.toHaveBeenCalled(); expect(mocks.addAlbum).not.toHaveBeenCalled(); expect(rows[0].status).toBe('pending');
  });

});
