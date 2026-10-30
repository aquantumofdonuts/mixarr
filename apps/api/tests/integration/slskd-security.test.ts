/** Isolated router integration: real auth and validation, no external services or database. */
import { beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
const mocks = vi.hoisted(() => ({ connection: vi.fn(), find: vi.fn(), update: vi.fn(), organize: vi.fn(), organizer: vi.fn() }));
vi.mock('../../src/lib/db.js', () => ({ default: {
  connection: { findFirst: mocks.connection }, slskdDownload: { findFirst: mocks.find, updateMany: mocks.update },
} }));
vi.mock('../../src/services/slskd.js', () => ({ SlskdService: class {} }));
vi.mock('../../src/services/slskd-organizer.js', () => ({ SlskdOrganizerService: class {
  constructor(options: unknown) { mocks.organizer(options); } organizeFile = mocks.organize;
} }));
vi.mock('../../src/jobs/slskd-operations-queue.js', () => ({ SLSKD_QUEUE_NAME: 'test', enqueueSlskdDownload: vi.fn() }));
vi.mock('../../src/lib/redis.js', () => ({ createRedisConnection: vi.fn() }));
vi.mock('bullmq', () => ({ QueueEvents: class { close = vi.fn(); } }));
import router from '../../src/routes/slskd.js';
const app = express(); app.use(express.json());
app.use((req, _res, next) => {
  if (req.header('x-test-session')) req.user = { id: 1, role: 'admin' } as Express.User;
  req.isAuthenticated = (() => !!req.user) as typeof req.isAuthenticated; next();
});
app.use('/api/slskd', router);
const body = { event: 'DownloadComplete', username: 'peer', directory: 'album', filename: 'song.flac' };
const webhook = (payload = body) => request(app).post('/api/slskd/webhook').set('x-test-session','authenticated').send(payload);
beforeEach(() => {
  vi.clearAllMocks(); mocks.connection.mockResolvedValue({ id: 11, config: { downloadDir: '/downloads', musicLibraryDir: '/music' } });
  mocks.find.mockResolvedValue({ id: 42 }); mocks.update.mockResolvedValue({ count: 1 }); mocks.organize.mockResolvedValue('/music/album/song.flac');
});
it('requires a session for the webhook and performs no effects without it', async () => {
  expect((await request(app).post('/api/slskd/webhook').send(body)).status).toBe(401);
  expect(mocks.connection).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
it.each([
  { username: '../../../etc' }, { username: 'peer\0' }, { directory: '..' }, { directory: 'album..hidden' },
  { filename: '..' }, { filename: 'song.flac\0' },
])('rejects unsafe username or basename %j before database/provider effects', async attack => {
  const response = await webhook({ ...body, ...attack }); expect(response.status).toBe(400); expect(response.body.error).toMatch(/invalid.*path/i);
  expect(mocks.connection).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.organize).not.toHaveBeenCalled();
});
it.each([
  { directory: 'C:\\Shared\\Album', filename: 'C:\\Shared\\Album\\song.flac' },
  { directory: '/shared/Album', filename: '/shared/Album/song.flac' },
  { directory: '../../Album', filename: '../../../etc/song.flac' },
])('reduces remote paths to safe leaf names before organization: %j', async remote => {
  const response = await webhook({ ...body, ...remote }); expect(response.status).toBe(200);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'organizing', downloadPath: '/downloads/Album/song.flac' } }));
  expect(mocks.organizer).toHaveBeenCalledWith({ downloadDir: '/downloads', musicLibraryDir: '/music' }); expect(mocks.organize).toHaveBeenCalledWith(42);
});
it('keeps authenticated webhook requests subject to the existing router rate limit', async () => {
  // router's existing 60/minute limit precedes the webhook's 100/minute limit.
  const responses = await Promise.all(Array.from({length:101}, () => webhook({ ...body, event: 'OtherEvent' })));
  expect(responses.some(response => response.status === 429 && /too many.*requests/i.test(response.body.error))).toBe(true);
});
