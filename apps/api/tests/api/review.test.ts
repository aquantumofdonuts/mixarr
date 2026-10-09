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
const bulk = (ids: number[], status = 'rejected') => request(app).post('/api/imports/review/bulk').send({ ids, status });

describe('review acquisitions through the actual Express router', () => {
  it('returns ID-keyed mixed outcomes for equal names and keeps failed identities pending', async () => {
    rows.push({ ...rows[0], id: 3, mbid: null as never }, { ...rows[0], id: 4 }, { ...rows[0], id: 5 });
    mocks.exists.mockResolvedValueOnce(true).mockResolvedValue(false);
    mocks.addArtist.mockResolvedValueOnce({}).mockRejectedValueOnce(Object.assign(new Error('secret provider payload'), { status: 400 }))
      .mockRejectedValueOnce(new Error('socket disconnected'));
    const response = await bulk([1, 2, 3, 4, 5], 'approved');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ added: 1, alreadyInLibrary: 1, failed: 3, addedIds: [1, 2], failedIds: [3, 4, 5] });
    expect(response.body.outcomes.map((o: any) => [o.id, o.state])).toEqual([[1, 'already-in-library'], [2, 'added'], [3, 'identity-required'], [4, 'failed'], [5, 'uncertain']]);
    expect(rows.map(row => row.status)).toEqual(['approved', 'approved', 'pending', 'pending', 'pending']);
    expect(JSON.stringify(response.body)).not.toContain('secret provider payload');
  });
  it.each([408, 429, 500, 503])('keeps HTTP %i provider outcomes uncertain and pending', async status => {
    mocks.addArtist.mockRejectedValue(Object.assign(new Error('raw error'), { status }));
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(200); expect(response.body.success).toBe(false);
    expect(response.body.outcomes[0]).toMatchObject({ id: 1, state: 'uncertain' });
    expect(rows[0].status).toBe('pending'); expect(updates).toHaveLength(0);
  });
  it('requires a single explicit artist choice and rejects a conflicting identity', async () => {
    rows[0].mbid = null as never;
    let response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(422); expect(response.body.outcomes[0].state).toBe('identity-required');
    response = await request(app).put('/api/imports/review/1').send({ status: 'approved', mbid });
    expect(response.body.outcomes[0].state).toBe('added'); expect(rows[0].mbid).toBe(mbid);
    response = await request(app).put('/api/imports/review/2').send({ status: 'approved', mbid: '22222222-2222-4222-8222-222222222222' });
    expect(response.status).toBe(409); expect(response.body.code).toBe('IDENTITY_CONFLICT'); expect(rows[1].status).toBe('pending');
  });
  it('refuses foreign single and bulk acquisitions even for administrators', async () => {
    rows[1].userId = 2;
    expect((await request(app).put('/api/imports/review/2').set('x-admin', '1').send({ status: 'approved', mbid })).status).toBe(404);
    expect((await request(app).post('/api/imports/review/bulk').set('x-admin', '1').send({ ids: [1, 2], status: 'approved' })).status).toBe(409);
    expect(mocks.addArtist).not.toHaveBeenCalled(); expect(updates).toHaveLength(0);
  });
  it('preserves false options and original IDs for explicit identity retries', async () => {
    rows[0].mbid = null as never;
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved', mbid, searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' });
    expect(response.body.outcomes[0]).toMatchObject({ id: 1, state: 'added' });
    expect(mocks.addArtist).toHaveBeenCalledWith(mbid, 1, 1, '/music', true, false, false, 'future', 'none');
  });
  it('distinguishes a confirmed membership race from a cache warming result', async () => {
    mocks.addArtist.mockResolvedValueOnce({ alreadyInLibrary: true, cacheWarmed: false }).mockResolvedValueOnce({ cacheWarmed: false });
    const response = await bulk([1, 2], 'approved');
    expect(response.body).toMatchObject({ added: 1, alreadyInLibrary: 1, failed: 0 });
    expect(response.body.outcomes.map((o: any) => o.state)).toEqual(['already-in-library', 'added']);
  });
  it('keeps a provider-success/CAS-conflict uncertain and preserves the newer decision', async () => {
    mocks.addArtist.mockImplementation(async () => { rows[0].status = 'rejected'; rows[0].updatedAt = new Date(now + 10); });
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.status).toBe(409); expect(response.body.outcomes[0].state).toBe('uncertain'); expect(rows[0].status).toBe('rejected');
  });
  it('does not announce an existing artist as a new addition', async () => {
    mocks.addArtist.mockResolvedValue({ alreadyInLibrary: true });
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.body.outcomes[0].state).toBe('already-in-library'); expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.log.mock.calls[0][2]).toContain('already in Lidarr');
  });
  it('normalizes a stored canonical artist identity before provider acquisition', async () => {
    const lower = 'abcdefab-1234-4234-8234-123456abcdef'; rows[0].mbid = lower.toUpperCase();
    const response = await request(app).put('/api/imports/review/1').send({ status: 'approved' });
    expect(response.body.outcomes[0].state).toBe('added'); expect(mocks.addArtist.mock.calls[0][0]).toBe(lower); expect(rows[0].mbid).toBe(lower);
  });
  it('keeps successful acquisition truthful when logging fails', async () => {
    mocks.log.mockRejectedValue(new Error('logs unavailable'));
    const response = await bulk([1, 2], 'approved');
    expect(response.body).toMatchObject({ added: 2, failed: 0 });
    expect(rows.every(row => row.status === 'approved')).toBe(true);
  });
});
