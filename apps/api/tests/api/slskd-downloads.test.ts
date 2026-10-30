import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mocks = vi.hoisted(() => ({
  connection: { findFirst: vi.fn(), findMany: vi.fn() },
  download: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), create: vi.fn() },
  queueDownload: vi.fn(), search: vi.fn(), results: vi.fn(), deleteSearch: vi.fn(), enqueue: vi.fn(), rateLimited: vi.fn(),
}));
vi.mock('../../src/lib/db.js', () => ({ default: { connection: mocks.connection, slskdDownload: mocks.download } }));
vi.mock('../../src/services/slskd.js', () => ({ SlskdService: class {
  queueDownload = mocks.queueDownload; search = mocks.search; getSearchResults = mocks.results; deleteSearch = mocks.deleteSearch;
} }));
vi.mock('../../src/services/slskd-organizer.js', () => ({ SlskdOrganizerService: class {} }));
vi.mock('../../src/lib/settings.js', () => ({ isSlskdRateLimitingEnabled: mocks.rateLimited }));
vi.mock('../../src/jobs/slskd-operations-queue.js', () => ({ enqueueSlskdDownload: mocks.enqueue, SLSKD_QUEUE_NAME: 'test' }));
vi.mock('../../src/lib/redis.js', () => ({ createRedisConnection: vi.fn() }));
vi.mock('bullmq', () => ({ QueueEvents: class { close = vi.fn(); } }));
import router from '../../src/routes/slskd.js';

const connections = [
  { id: 11, userId: 1, type: 'slskd', isActive: true, config: { url: 'http://own', apiKey: 'test' } },
  { id: 12, userId: 2, type: 'slskd', isActive: true, config: { url: 'http://foreign', apiKey: 'test' } },
  { id: 13, userId: null, type: 'slskd', isActive: true, config: { url: 'http://global', apiKey: 'test' } },
  { id: 14, userId: 1, type: 'slskd', isActive: false, config: { url: 'http://inactive', apiKey: 'test' } },
];
const record = (id = 11, status = 'failed') => ({ id, connectionId: id, username: 'peer', artistName: 'Artist', filename: 'album/track.flac', fileSize: 50000000n, status });
const app = express(); app.use(express.json());
app.use((req, _res, next) => {
  const identity = req.header('x-test-user');
  if (identity) req.user = { id: Number(identity), role: req.header('x-test-role') || 'user' } as Express.User;
  req.isAuthenticated = (() => !!req.user) as typeof req.isAuthenticated;
  next();
});
app.use('/api/slskd', router);
const get = (path: string, role = 'user') => request(app).get(path).set('x-test-user', '1').set('x-test-role', role);
const post = (path: string, role = 'user') => request(app).post(path).set('x-test-user', '1').set('x-test-role', role);
const del = (path: string, role = 'user') => request(app).delete(path).set('x-test-user', '1').set('x-test-role', role);
beforeEach(() => {
  vi.clearAllMocks();
  const matches = (where: Record<string, unknown>) => connections.filter(connection => Object.entries(where).every(([key, value]) => connection[key as keyof typeof connection] === value));
  mocks.connection.findFirst.mockImplementation(({ where }) => Promise.resolve(matches(where)[0] || null));
  mocks.connection.findMany.mockImplementation(({ where }) => Promise.resolve(matches(where)));
  mocks.download.findMany.mockResolvedValue([record()]);
  mocks.download.findUnique.mockImplementation(({ where }) => Promise.resolve(connections.some(connection => connection.id === where.id) ? record(where.id) : null));
  mocks.download.update.mockImplementation(({ data }) => Promise.resolve({ ...record(), ...data }));
  mocks.download.create.mockImplementation(({ data }) => Promise.resolve({ id: 99, ...data }));
  mocks.queueDownload.mockResolvedValue({}); mocks.rateLimited.mockResolvedValue(false);
  mocks.enqueue.mockResolvedValue({ waitUntilFinished: vi.fn().mockResolvedValue({}) });
});

describe('scoped slskd downloads and provider operations with real requireAuth', () => {
  it.each([['get', '/downloads'], ['post', '/downloads/11/retry'], ['delete', '/downloads/11'], ['post', '/search'], ['get', '/search/test'], ['delete', '/search/test'], ['post', '/download']] as const)('rejects anonymous %s %s before any DB/provider call', async (method, path) => {
    const response = await request(app)[method](`/api/slskd${path}`).send({ query: 'Artist' });
    expect(response.status).toBe(401); expect(mocks.connection.findFirst).not.toHaveBeenCalled(); expect(mocks.download.findUnique).not.toHaveBeenCalled();
  });
  it('bounds the list, scopes to own connections including inactive history, and serializes bigint', async () => {
    const response = await get('/api/slskd/downloads'); expect(response.status).toBe(200); expect(response.body[0].fileSize).toBe('50000000');
    expect(mocks.download.findMany).toHaveBeenCalledWith({ where: { connectionId: { in: [11,14] } }, orderBy: { createdAt: 'desc' }, take: 100 });
  });
  it('retains admin access to all slskd histories and server filters', async () => {
    await get('/api/slskd/downloads?status=pending,downloading&limit=25', 'admin');
    expect(mocks.download.findMany).toHaveBeenCalledWith({ where: { connectionId: { in: [11,12,13,14] }, status: { in: ['pending','downloading'] } }, orderBy: { createdAt: 'desc' }, take: 25 });
  });
  it('accepts the real queued_locally status emitted by subscription downloads', async () => {
    expect((await get('/api/slskd/downloads?status=queued_locally')).status).toBe(200);
    expect(mocks.download.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { connectionId: { in: [11,14] }, status: 'queued_locally' } }));
  });
  it.each([0,501])('rejects invalid result limit %i', async limit => { expect((await get(`/api/slskd/downloads?limit=${limit}`)).status).toBe(400); });
  it.each([12,13,999])('denies foreign/global/unknown record %i without mutation or provider effects', async id => {
    expect((await post(`/api/slskd/downloads/${id}/retry`)).status).toBe(404);
    expect((await del(`/api/slskd/downloads/${id}`)).status).toBe(404);
    expect((await del(`/api/slskd/downloads/${id}?remove=true`)).status).toBe(404);
    expect(mocks.download.update).not.toHaveBeenCalled(); expect(mocks.download.delete).not.toHaveBeenCalled(); expect(mocks.queueDownload).not.toHaveBeenCalled(); expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it.each([false,true])('retries on the exact active connection for queue=%s', async queued => {
    mocks.rateLimited.mockResolvedValue(queued);
    const response = await post('/api/slskd/downloads/12/retry','admin'); expect(response.status).toBe(200);
    expect(mocks.connection.findFirst).toHaveBeenLastCalledWith({ where: { id: 12, type: 'slskd', isActive: true } });
    if (queued) expect(mocks.enqueue).toHaveBeenCalledWith({ connectionId: 12, username: 'peer', filename: 'album/track.flac' });
    else expect(mocks.queueDownload).toHaveBeenCalledWith('peer', [{ filename: 'album/track.flac', size: 50000000 }]);
    expect(mocks.download.update).toHaveBeenCalledWith({ where: { id: 12 }, data: { status: 'pending', error: null } });
  });
  it('does not route an inactive record retry through another connection', async () => {
    expect((await post('/api/slskd/downloads/14/retry')).status).toBe(400); expect(mocks.queueDownload).not.toHaveBeenCalled(); expect(mocks.download.update).not.toHaveBeenCalled();
  });
  it('rejects retrying a completed record', async () => { mocks.download.findUnique.mockResolvedValue(record(11,'completed')); expect((await post('/api/slskd/downloads/11/retry')).status).toBe(400); });
  it('marks own tracking cancelled and separately removes the record without promising remote abort', async () => {
    expect((await del('/api/slskd/downloads/11')).status).toBe(200); expect(mocks.download.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { status: 'cancelled' } });
    expect((await del('/api/slskd/downloads/11?remove=true')).status).toBe(200); expect(mocks.download.delete).toHaveBeenCalledWith({ where: { id: 11 } }); expect(mocks.queueDownload).not.toHaveBeenCalled();
  });
  it('allows admin management of global tracking', async () => { expect((await del('/api/slskd/downloads/13?remove=true','admin')).status).toBe(200); });
  it('scopes search, results, search deletion, and new downloads to the actor', async () => {
    await post('/api/slskd/search').send({ query: 'Artist' }); await get('/api/slskd/search/search-id'); await del('/api/slskd/search/search-id');
    await post('/api/slskd/download').send({ username: 'peer', files: [{ filename:'track.flac',size:10 }] });
    expect(mocks.connection.findFirst).toHaveBeenCalledTimes(4);
    expect(mocks.connection.findFirst.mock.calls.every(([args]) => args.where.userId===1)).toBe(true);
    expect(mocks.download.create).toHaveBeenCalledWith({ data: expect.objectContaining({ connectionId: 11 }) });
  });
  it('denies provider operations for an actor with no owned active connection', async () => {
    mocks.connection.findFirst.mockResolvedValue(null);
    expect((await post('/api/slskd/search').send({query:'Artist'})).status).toBe(400);
    expect((await post('/api/slskd/download').send({username:'peer',files:[{filename:'track',size:1}]})).status).toBe(400);
    expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.queueDownload).not.toHaveBeenCalled(); expect(mocks.download.create).not.toHaveBeenCalled();
  });
});
