import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  results: vi.fn(), reviews: vi.fn(), resultFirst: vi.fn(), reviewFirst: vi.fn(),
  artist: vi.fn(), releases: vi.fn(), membership: vi.fn(), connection: vi.fn(),
}));
vi.mock('../../src/lib/db.js', () => ({ default: {
  subscriptionResult: { findMany: mocks.results, findFirst: mocks.resultFirst },
  reviewItem: { findMany: mocks.reviews, findFirst: mocks.reviewFirst },
} }));
vi.mock('../../src/lib/connection-resolver.js', () => ({
  getLidarrService: mocks.connection, getLidarrServiceWithConfig: vi.fn(), getLastfmService: vi.fn(),
}));
vi.mock('../../src/services/musicbrainz.js', () => ({ MusicBrainzService: class {
  getArtist = mocks.artist;
  getArtistReleases = mocks.releases;
} }));
vi.mock('../../src/routes/logs.js', () => ({ addLogEntry: vi.fn() }));
vi.mock('../../src/services/artist-images.js', () => ({ getArtistImages: vi.fn() }));
vi.mock('../../src/services/notifications.js', () => ({ notificationService: { send: vi.fn() } }));
vi.mock('../../src/services/metadata-fix.js', () => ({ MetadataFixService: class {} }));
vi.mock('../../src/services/skyhook-cache-warmer.js', () => ({ skyhookWarmer: {} }));
vi.mock('../../src/middleware/auth.js', () => ({ requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const actor = req.header('x-test-user');
  if (!actor) { res.status(401).json({ error: 'Authentication required' }); return; }
  req.user = { id: Number(actor), username: 'actor', role: req.header('x-test-role') === 'admin' ? 'admin' : 'user' };
  next();
} }));
import { searchRouter } from '../../src/routes/search.js';
const app = express();
app.use('/api/search', searchRouter);
const mbid = 'df494a19-4657-4a77-92b6-80325c63510f';
const path = `/api/search/artist/${mbid}`;
const row = (id: number, userId = 1) => ({ id, mbid, userId, artistName: 'Artist', source: `Source ${id}`, status: 'pending', createdAt: new Date('2026-10-07T00:00:00.000Z') });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.results.mockResolvedValue([]); mocks.reviews.mockResolvedValue([]);
  mocks.resultFirst.mockResolvedValue(null); mocks.reviewFirst.mockResolvedValue(null);
  mocks.artist.mockResolvedValue({ id: mbid, name: 'Artist' });
  mocks.releases.mockResolvedValue({ releaseGroups: [{ id: 'release', title: 'Album' }], count: 30 });
  mocks.membership.mockResolvedValue(null);
  mocks.connection.mockResolvedValue({ getArtistByMbid: mocks.membership });
});

describe('authenticated artist detail and releases', () => {
  it('rejects anonymous reads before providers or evidence', async () => {
    expect((await request(app).get(`${path}/detail`)).status).toBe(401);
    expect((await request(app).get(`${path}/releases`)).status).toBe(401);
    expect(mocks.artist).not.toHaveBeenCalled(); expect(mocks.results).not.toHaveBeenCalled();
  });
  it.each(['not-a-uuid', 'df494a19-4657-4a77-92b6-80325c63510'])('rejects invalid identity %s', async invalid => {
    expect((await request(app).get(`/api/search/artist/${invalid}/detail`).set('x-test-user', '1')).status).toBe(400);
    expect((await request(app).get(`/api/search/artist/${invalid}/releases`).set('x-test-user', '1')).status).toBe(400);
    expect(mocks.connection).not.toHaveBeenCalled(); expect(mocks.releases).not.toHaveBeenCalled();
  });
  it.each(['0', '101', '1.5', '2x', '-1', ''])('rejects source limit %s before connection resolution', async limit => {
    const res = await request(app).get(`${path}/detail`).query({ sourceLimit: limit }).set('x-test-user', '1');
    expect(res.status).toBe(400); expect(mocks.connection).not.toHaveBeenCalled();
  });
  it.each(['bad!', 'a'.repeat(1025), 'e30', Buffer.from(JSON.stringify({ v: 1, userId: 2, mbid, createdAt: '2026-10-07T00:00:00.000Z', kind: 'review-item', id: 1 })).toString('base64url')])('rejects invalid or foreign cursor', async cursor => {
    const res = await request(app).get(`${path}/detail`).query({ sourceCursor: cursor }).set('x-test-user', '1');
    expect(res.status).toBe(400); expect(mocks.artist).not.toHaveBeenCalled(); expect(mocks.results).not.toHaveBeenCalled();
  });
  it('passes only the authenticated actor even for admins and filters foreign evidence', async () => {
    mocks.reviews.mockResolvedValue([row(1), row(2, 2)]);
    const res = await request(app).get(`${path}/detail`).set('x-test-user', '2').set('x-test-role', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.sources.map((source: { key: string }) => source.key)).toEqual(['review-item:2']);
    expect(mocks.reviews).toHaveBeenCalledWith(expect.objectContaining({ where: { mbid, userId: 2 } }));
    expect(mocks.connection).toHaveBeenCalledWith(2, expect.any(AbortSignal));
    expect(mocks.membership).toHaveBeenCalledWith(mbid, expect.any(AbortSignal));
  });
  it.each([401, 403])('propagates connection authorization failure %i', async status => {
    mocks.connection.mockRejectedValue(Object.assign(new Error('Denied'), { status }));
    const res = await request(app).get(`${path}/detail`).set('x-test-user', '1');
    expect(res.status).toBe(status); expect(res.body).toEqual({ error: 'Artist detail access denied' });
  });
  it('maps public paging parameters to owned source cursors without repeats', async () => {
    mocks.reviews.mockImplementation(async ({ where }: { where: { OR?: unknown } }) => where.OR ? [row(2)] : [row(1), row(2)]);
    const first = await request(app).get(`${path}/detail`).query({ sourceLimit: 1 }).set('x-test-user', '1');
    expect(first.status).toBe(200); expect(first.body.sources.map((source: { key: string }) => source.key)).toEqual(['review-item:1']);
    const second = await request(app).get(`${path}/detail`).query({ sourceLimit: 1, sourceCursor: first.body.sourcesNextCursor }).set('x-test-user', '1');
    expect(second.status).toBe(200); expect(second.body.sources.map((source: { key: string }) => source.key)).toEqual(['review-item:2']);
    expect(second.body.sourcesNextCursor).toBeNull();
  });
  it('retains owned sources when metadata, connection resolution, and membership are unavailable', async () => {
    mocks.artist.mockRejectedValue(new Error('Provider offline'));
    mocks.connection.mockRejectedValue(new Error('Connection unavailable'));
    mocks.reviews.mockResolvedValue([row(1)]);
    const res = await request(app).get(`${path}/detail`).set('x-test-user', '1');
    expect(res.status).toBe(200); expect(res.body.sources).toHaveLength(1);
    expect(res.body.unavailable).toEqual(['metadata', 'membership']); expect(res.body.membership).toBe('unknown');
  });
  it.each([{ limit: '101' }, { limit: '0' }, { limit: '2x' }, { offset: '-1' }, { offset: '1.5' }, { offset: '9007199254740992' }, { offset: '1000001' }])('rejects unbounded release paging %j', async query => {
    expect((await request(app).get(`${path}/releases`).query(query).set('x-test-user', '1')).status).toBe(400);
    expect(mocks.releases).not.toHaveBeenCalled();
  });
  it('returns the existing release page contract for valid paging', async () => {
    const res = await request(app).get(`${path}/releases`).query({ limit: 25, offset: 25 }).set('x-test-user', '1');
    expect(res.status).toBe(200); expect(res.body).toEqual({ releaseGroups: [{ id: 'release', title: 'Album' }], count: 30 });
    expect(mocks.releases).toHaveBeenCalledWith(mbid, 25, 25);
  });
});
