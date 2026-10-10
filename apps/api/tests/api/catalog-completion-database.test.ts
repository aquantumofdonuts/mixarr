import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import session from 'express-session';
import { Passport } from 'passport';
import request from 'supertest';

const adapter = vi.hoisted(() => ({ membership: vi.fn(), add: vi.fn(), exists: vi.fn(), discogs: vi.fn() }));
vi.mock('../../src/lib/db.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const target = process.env.CATALOG_REVIEW_TEST_DATABASE_URL;
  if (target && target !== 'mysql://root@127.0.0.1:13306/mixarr_catalog_test') throw new Error('Only the disposable catalog database is permitted');
  return { default: new PrismaClient({ datasources: { db: { url: target ?? 'mysql://root@127.0.0.1:13306/mixarr_catalog_test' } } }) };
});
vi.mock('../../src/lib/redis.js', () => ({ redis: { get: vi.fn(async () => null), set: vi.fn() } }));
vi.mock('../../src/jobs/scheduler.js', () => ({ addImportScheduledJob: vi.fn(), removeImportScheduledJob: vi.fn(), addScheduledJob: vi.fn(), removeScheduledJob: vi.fn() }));
vi.mock('../../src/jobs/queue.js', () => ({ scheduleSubscriptionJob: vi.fn() }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: vi.fn() }));
vi.mock('../../src/services/lastfm.js', () => ({ LastfmService: vi.fn() }));
vi.mock('../../src/services/ai.js', () => ({ AIService: vi.fn() }));
vi.mock('../../src/services/discogs.js', () => ({ DiscogsService: class {
  constructor(token?: string, options?: unknown) { adapter.discogs(token, options); }
  getArtistReleases = async () => [];
  getReleaseCredits = async () => [];
} }));
vi.mock('../../src/services/artist-images.js', () => ({ getArtistImages: vi.fn(async () => new Map()), normalizeArtistName: (name: string) => name.toLowerCase() }));
vi.mock('../../src/services/public-playlist.js', () => ({ parseSpotifyPlaylistUrl: vi.fn(), importPublicPlaylist: vi.fn() }));
vi.mock('../../src/services/notifications.js', () => ({ notificationService: { send: vi.fn() } }));
vi.mock('../../src/routes/logs.js', () => ({ addLogEntry: vi.fn() }));
vi.mock('../../src/services/lidarr.js', () => ({
  invalidateLidarrCache: vi.fn(),
  LidarrService: class {
    getArtistByMbid = adapter.membership; addArtistWithCacheWarm = adapter.add; addAlbumWithCacheWarm = adapter.add;
    getQualityProfiles = async () => [{ id: 2 }, { id: 9 }];
    getMetadataProfiles = async () => [{ id: 3 }, { id: 8 }];
    getRootFolders = async () => [{ path: '/music' }, { path: '/archive' }];
  },
  LidarrCache: class { refresh = vi.fn(); exists = adapter.exists; },
}));

import prisma from '../../src/lib/db.js';
import { feedRouter } from '../../src/routes/feed.js';
import { importsRouter } from '../../src/routes/imports.js';
import { settingsRouter } from '../../src/routes/settings.js';
import { subscriptionsRouter } from '../../src/routes/subscriptions.js';
import { FeedService } from '../../src/services/FeedService.js';
import { LidarrService } from '../../src/services/lidarr.js';
import { ArtistDetailService } from '../../src/services/artist-detail.js';
import { resolveConfiguredCreditSource } from '../../src/services/constellation/resolveCreditSource.js';

const mbid = '11111111-1111-4111-8111-111111111111';
const otherMbid = '22222222-2222-4222-8222-222222222222';
const config = { url: 'http://controlled-provider.test', apiKey: 'test-only', qualityProfileId: 2, metadataProfileId: 3, rootFolderPath: '/music' };
let actor: number, other: number, admin: number, subscription: number, foreignSubscription: number;
const app = express();
const passport = new Passport();
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id: number, done) => {
  try { done(null, await prisma.user.findUnique({ where: { id } })); } catch (error) { done(error); }
});
app.use(express.json());
app.use(session({ secret: 'catalog-disposable-session', resave: false, saveUninitialized: false }));
app.use(passport.initialize()); app.use(passport.session());
// Controlled authentication boundary: real session/Passport restoration follows;
// credential validation and deployed session-store compatibility are separate evidence.
app.post('/test/login/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (![actor, other, admin].includes(id)) { res.sendStatus(403); return; }
  const user = await prisma.user.findUniqueOrThrow({ where: { id } });
  req.login(user, error => error ? next(error) : res.sendStatus(204));
});
app.use('/api/feed', feedRouter()); app.use('/api/imports', importsRouter); app.use('/api/settings', settingsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
const login = async (id: number) => { const agent = request.agent(app); expect((await agent.post(`/test/login/${id}`)).status).toBe(204); return agent; };
const result = (data: object = {}, sub = subscription) => prisma.subscriptionResult.create({ data: {
  subscriptionId: sub, itemType: 'artist', name: 'Same Name', mbid, ...data,
} });
const connection = () => prisma.connection.create({ data: { userId: actor, type: 'lidarr', name: 'Controlled Provider', config } });

describe.skipIf(!process.env.CATALOG_REVIEW_TEST_DATABASE_URL)('catalog completion: real MySQL routers and Passport sessions with controlled provider adapters', () => {
  beforeAll(async () => {
    const stamp = `${Date.now()}-${process.pid}`;
    actor = (await prisma.user.create({ data: { username: `catalog-completion-owner-${stamp}`, displayName: 'Audit Owner' } })).id;
    other = (await prisma.user.create({ data: { username: `catalog-completion-other-${stamp}`, displayName: 'Audit Other' } })).id;
    admin = (await prisma.user.create({ data: { username: `catalog-completion-admin-${stamp}`, displayName: 'Audit Admin', role: 'admin' } })).id;
    subscription = (await prisma.subscription.create({ data: { userId: actor, type: 'lastfm_chart', name: 'Original Source', config: {} } })).id;
    foreignSubscription = (await prisma.subscription.create({ data: { userId: other, type: 'lastfm_chart', name: 'Foreign Source', config: {} } })).id;
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); adapter.membership.mockReset().mockResolvedValue(null); adapter.add.mockReset().mockResolvedValue({ artist: { foreignArtistId: mbid } }); adapter.exists.mockReset().mockResolvedValue(false); adapter.discogs.mockReset();
    await prisma.subscriptionResult.deleteMany({ where: { subscriptionId: { in: [subscription, foreignSubscription] } } });
    await prisma.reviewItem.deleteMany({ where: { userId: { in: [actor, other, admin] } } });
    await prisma.connection.deleteMany({ where: { userId: { in: [actor, other, admin] } } });
  });
  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { id: { in: [actor, other, admin].filter(Boolean) } } });
      expect(await prisma.user.count({ where: { username: { startsWith: 'catalog-completion-' } } })).toBe(0);
      expect(await prisma.subscriptionResult.count({ where: { subscriptionId: { in: [subscription, foreignSubscription].filter(Boolean) } } })).toBe(0);
      console.info('Catalog completion fixture cleanup: users=0 subscriptionResults=0');
    } finally { await prisma.$disconnect(); }
  });
  it('executes production authentication and admin guards after genuine Passport session restoration', async () => {
    expect((await request(app).get('/api/imports/review/queue')).status).toBe(401);
    expect((await request(app).get('/api/settings/constellation')).status).toBe(401);
    expect((await request(app).post('/api/feed/restore').send({ undoToken: 'invalid' })).status).toBe(401);
    const member = await login(actor), administrator = await login(admin);
    expect((await member.get('/api/imports/review/queue')).status).toBe(200);
    expect((await member.get('/api/settings/constellation')).status).toBe(403);
    expect((await administrator.get('/api/settings/constellation')).status).toBe(200);
  });
  it('keeps missing identity, missing connection, malformed and foreign aggregate rows unchanged', async () => {
    const own = await result(), unresolved = await result({ mbid: null }), foreign = await result({}, foreignSubscription);
    const member = await login(actor);
    expect((await member.post(`/api/feed/feed-${unresolved.id}/approve`).send({})).body.code).toBe('IDENTITY_REQUIRED');
    expect((await member.post(`/api/feed/feed-${own.id}/approve`).send({})).body.code).toBe('CONNECTION_REQUIRED');
    expect((await member.post(`/api/feed/feed-${own.id}-${foreign.id}/approve`).send({})).status).toBe(403);
    expect((await member.post('/api/feed/feed-1x/approve').send({})).body.code).toBe('INVALID_FEED_ID');
    expect((await prisma.subscriptionResult.findMany({ where: { subscriptionId: { in: [subscription, foreignSubscription] } } })).map(row => row.status)).toEqual(['pending', 'pending', 'pending']);
    expect(adapter.add).not.toHaveBeenCalled(); expect(adapter.membership).not.toHaveBeenCalled();
  });
  it('commits all deduplicated claims before provider work, rejects concurrent approval and confirms exact-owner cleanup', async () => {
    await connection(); const a = await result(), b = await result();
    await prisma.reviewItem.createMany({ data: [{ userId: actor, artistName: 'Exact', mbid, source: 'audit' }, { userId: other, artistName: 'Foreign', mbid, source: 'audit' }, { userId: actor, artistName: 'Same Name', mbid: otherMbid, source: 'audit' }] });
    let release!: () => void;
    adapter.add.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ artist: { foreignArtistId: mbid } }); }));
    const member = await login(actor);
    const operation = member.post(`/api/feed/feed-${a.id}-${b.id}-${a.id}/approve`).send({}).then(response => response);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    let completed;
    try {
      expect((await prisma.subscriptionResult.findMany({ where: { subscriptionId: { in: [subscription, foreignSubscription] } } })).map(row => row.status)).toEqual(['adding', 'adding']);
      expect(await prisma.reviewItem.count({ where: { userId: { in: [actor, other, admin] } } })).toBe(3);
      expect((await member.post(`/api/feed/feed-${a.id}-${b.id}/approve`).send({})).body.code).toBe('IN_PROGRESS');
    } finally { release(); completed = await operation; }
    expect(completed.body.outcome.state).toBe('added');
    const rows = await prisma.subscriptionResult.findMany({ where: { subscriptionId: { in: [subscription, foreignSubscription] } } }); expect(rows.every(row => row.status === 'added' && row.processedAt)).toBe(true);
    expect(await prisma.reviewItem.findMany({ where: { userId: { in: [actor, other, admin] } } })).toEqual(expect.arrayContaining([expect.objectContaining({ userId: other, mbid }), expect.objectContaining({ userId: actor, mbid: otherMbid })]));
    expect(await prisma.reviewItem.count({ where: { userId: { in: [actor, other, admin] } } })).toBe(2); expect(adapter.add).toHaveBeenCalledTimes(1);
  });
  it('reconciles stale claims before reclaim and preserves a concurrently newer local decision on finalization', async () => {
    await connection(); const old = new Date(Date.now() - 121_000); const row = await result({ status: 'adding', processedAt: old });
    adapter.membership.mockResolvedValue({ foreignArtistId: mbid }); const member = await login(actor);
    expect((await member.post(`/api/feed/feed-${row.id}/approve`).send({})).body.outcome.state).toBe('already-in-library');
    expect((await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).processedAt!.getTime()).toBeGreaterThan(old.getTime()); expect(adapter.add).not.toHaveBeenCalled();
    const newer = await result(); const revision = new Date(Date.now() + 1000);
    adapter.membership.mockResolvedValueOnce(null).mockResolvedValue({ foreignArtistId: mbid });
    adapter.add.mockImplementationOnce(async () => { await prisma.subscriptionResult.update({ where: { id: newer.id }, data: { status: 'rejected', processedAt: revision } }); return {}; });
    expect((await member.post(`/api/feed/feed-${newer.id}/approve`).send({})).body.outcome.state).toBe('already-in-library');
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: newer.id } })).toMatchObject({ status: 'rejected', processedAt: revision });
  });
  it('rolls back the first aggregate claim when a database revision changes before the second conditional claim', async () => {
    await connection(); const old = new Date(Date.now() - 121_000);
    const first = await result({ status: 'adding', processedAt: old }), second = await result();
    const changedAt = new Date(Date.now() + 1000);
    adapter.membership.mockImplementationOnce(async () => {
      await prisma.subscriptionResult.update({ where: { id: second.id }, data: { status: 'rejected', processedAt: changedAt } });
      return null;
    });
    const member = await login(actor);
    const response = await member.post(`/api/feed/feed-${first.id}-${second.id}/approve`).send({});
    expect(response.status).toBe(409); expect(response.body.code).toBe('DECISION_CONFLICT');
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ status: 'adding', processedAt: old });
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: second.id } })).toMatchObject({ status: 'rejected', processedAt: changedAt });
    expect(adapter.add).not.toHaveBeenCalled();
  });
  it('retains definite failure and uncertain timeout, then reconciles retry without a second provider POST', async () => {
    await connection(); const row = await result(); const member = await login(actor);
    adapter.add.mockRejectedValueOnce(Object.assign(new Error('Provider rejected secret=not-for-clients'), { status: 400 }));
    expect((await member.post(`/api/feed/feed-${row.id}/approve`).send({})).body.outcome.state).toBe('failed');
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'failed', skipReason: null });
    adapter.add.mockRejectedValueOnce(Object.assign(new Error('Provider timeout'), { status: 408 }));
    expect((await member.post(`/api/feed/feed-${row.id}/approve`).send({})).body.outcome.state).toBe('uncertain');
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'failed', skipReason: 'acquisition_uncertain' });
    adapter.membership.mockResolvedValue({ foreignArtistId: mbid });
    expect((await member.post(`/api/feed/feed-${row.id}/approve`).send({})).body.outcome.state).toBe('already-in-library'); expect(adapter.add).toHaveBeenCalledTimes(2);
  });
  it('propagates a real AbortSignal deadline through the controlled adapter and persists recoverable uncertainty', async () => {
    const row = await result(); const signal = AbortSignal.timeout(100);
    adapter.add.mockImplementationOnce((...args: unknown[]) => new Promise((_resolve, reject) => {
      const received = args.at(-1) as AbortSignal; expect(received).toBe(signal);
      received.addEventListener('abort', () => reject(received.reason), { once: true });
    }));
    const service = new FeedService(prisma, new LidarrService(config), config);
    expect((await service.approve(`feed-${row.id}`, actor, signal)).outcome.state).toBe('uncertain');
    expect(signal.aborted).toBe(true); expect(adapter.add).toHaveBeenCalledTimes(1);
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ status: 'failed', skipReason: 'acquisition_uncertain' });
  });
  it('validates explicit identity/options and forwards chosen values only after owned identity persistence', async () => {
    await connection(); const row = await result({ mbid: null }); const member = await login(actor);
    adapter.add.mockImplementationOnce(async (...args: unknown[]) => {
      expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ mbid, status: 'adding' });
      expect(args.slice(0, 9)).toEqual([mbid, 9, 8, '/archive', true, false, false, 'future', 'none']); return {};
    });
    const response = await member.post(`/api/feed/feed-${row.id}/approve`).send({ mbid, qualityProfileId: 9, metadataProfileId: 8, rootFolderPath: '/archive', searchOnAdd: false, monitorOption: 'future', monitorNewItems: 'none' });
    expect(response.body.outcome.state).toBe('added');
    const invalid = await result();
    expect((await member.post(`/api/feed/feed-${invalid.id}/approve`).send({ qualityProfileId: 999 })).body.outcome.state).toBe('failed'); expect(adapter.add).toHaveBeenCalledTimes(1);
  });
  it('restores every feed dismissal atomically, rejects cross-user/replay and rolls back a stale aggregate token', async () => {
    const a = await result({ status: 'failed', errorMessage: 'Original failure', skipReason: 'acquisition_uncertain' }), b = await result({ status: 'queued' });
    const member = await login(actor), foreign = await login(other);
    const first = await member.post(`/api/feed/feed-${a.id}-${b.id}/dismiss`); expect(first.status).toBe(200);
    expect((await foreign.post('/api/feed/restore').send({ undoToken: first.body.undoToken })).status).toBe(400);
    expect((await member.post('/api/feed/restore').send({ undoToken: first.body.undoToken })).status).toBe(200);
    expect(await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ status: 'failed', errorMessage: 'Original failure', skipReason: 'acquisition_uncertain' });
    const second = await member.post(`/api/feed/feed-${a.id}-${b.id}/dismiss`);
    expect((await member.post('/api/feed/restore').send({ undoToken: first.body.undoToken })).status).toBe(409);
    await prisma.subscriptionResult.update({ where: { id: b.id }, data: { status: 'added', processedAt: new Date(Date.now() + 1000) } });
    expect((await member.post('/api/feed/restore').send({ undoToken: second.body.undoToken })).status).toBe(409);
    expect((await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('rejected');
  });
  it('fails before dismissal without signing and rejects malformed or tampered tokens without writes', async () => {
    const row = await result(); const member = await login(actor); const secret = process.env.SESSION_SECRET;
    try { process.env.SESSION_SECRET = ''; expect((await member.post(`/api/feed/feed-${row.id}/dismiss`)).status).toBe(503); }
    finally { process.env.SESSION_SECRET = secret; }
    expect((await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('pending');
    const response = await member.post(`/api/feed/feed-${row.id}/dismiss`); const token = response.body.undoToken as string;
    expect((await member.post('/api/feed/restore').send({ undoToken: `${token.slice(0, -1)}?` })).status).toBe(400);
    expect((await member.post('/api/feed/restore').send({ undoToken: 'a'.repeat(32_769) })).status).toBe(400);
    expect((await prisma.subscriptionResult.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('rejected');
  });
  it('keeps review search and numeric decisions actor-scoped with same-name identities and atomic Undo', async () => {
    const rows = await Promise.all([prisma.reviewItem.create({ data: { userId: actor, artistName: 'Same Name', mbid, source: 'audit' } }), prisma.reviewItem.create({ data: { userId: actor, artistName: 'Same Name', mbid: otherMbid, source: 'audit' } }), prisma.reviewItem.create({ data: { userId: other, artistName: 'Same Name', mbid, source: 'audit' } })]);
    const member = await login(actor);
    const administrator = await login(admin);
    expect((await member.get('/api/imports/review/queue').query({ q: 'Same Name' })).body.items.map((row: { id: number }) => row.id).sort()).toEqual(rows.slice(0, 2).map(row => row.id).sort());
    expect((await member.put(`/api/imports/review/${rows[2].id}`).send({ status: 'rejected' })).status).toBe(404);
    expect((await administrator.put(`/api/imports/review/${rows[0].id}`).send({ status: 'rejected' })).status).toBe(404);
    const rejected = await member.post('/api/imports/review/bulk').send({ ids: rows.slice(0, 2).map(row => row.id), status: 'rejected' }); expect(rejected.status).toBe(200);
    expect((await member.post('/api/imports/review/restore').send({ undoToken: rejected.body.undoToken })).status).toBe(200);
    expect((await prisma.reviewItem.findMany({ where: { userId: { in: [actor, other, admin] } } })).every(row => row.status === 'pending')).toBe(true);
  });
  it('persists mixed same-name bulk outcomes by numeric ID while keeping failure and unresolved identities pending', async () => {
    await connection(); const member = await login(actor);
    const rows = await Promise.all([mbid, otherMbid, null].map(identity => prisma.reviewItem.create({ data: { userId: actor, artistName: 'Same Name', mbid: identity, source: 'audit' } })));
    adapter.exists.mockImplementation(async ({ mbid: identity }) => identity === mbid);
    adapter.add.mockRejectedValueOnce(Object.assign(new Error('Controlled timeout'), { status: 408 }));
    const response = await member.post('/api/imports/review/bulk').send({ ids: rows.map(row => row.id), status: 'approved' });
    expect(response.status).toBe(200);
    expect(response.body.outcomes.map((outcome: { id: number; state: string }) => [outcome.id, outcome.state])).toEqual([[rows[0].id, 'already-in-library'], [rows[1].id, 'uncertain'], [rows[2].id, 'identity-required']]);
    const saved = await prisma.reviewItem.findMany({ where: { id: { in: rows.map(row => row.id) } } });
    expect(rows.map(row => saved.find(item => item.id === row.id)!.status)).toEqual(['approved', 'pending', 'pending']);
    expect(adapter.add).toHaveBeenCalledTimes(1); expect(adapter.add.mock.calls[0][0]).toBe(otherMbid);
  });
  it('reads original exact-identity source rows from MySQL with bounded chronology and foreign-user cursor rejection', async () => {
    const early = new Date('2026-10-07T00:00:00Z'), late = new Date('2026-10-08T00:00:00Z');
    const own = await result({ createdAt: early, sourceUrl: 'javascript:alert(1)', runId: 71 });
    const review = await prisma.reviewItem.create({ data: { userId: actor, artistName: 'Stored Artist', mbid, source: 'Original Review Label', createdAt: late } });
    await result({ createdAt: early }, foreignSubscription); await result({ mbid: otherMbid, name: 'Same Name' });
    const service = new ArtistDetailService(prisma, { getArtistByMbid: async () => null }, { getArtist: async () => { throw new Error('Controlled metadata outage'); } });
    const first = await service.getArtistDetail(mbid, actor, { limit: 1 });
    expect(first.sources).toEqual([{ key: `subscription-result:${own.id}`, kind: 'subscription-result', label: 'Original Source', subscriptionId: subscription, runId: 71, recordedAt: early.toISOString(), recordStatus: 'pending', sourceUrl: null }]);
    expect(first.unavailable).toContain('metadata'); expect(first.membership).toBe('not-in-library');
    const second = await service.getArtistDetail(mbid, actor, { limit: 1, cursor: first.sourcesNextCursor! });
    expect(second.sources.map(source => source.key)).toEqual([`review-item:${review.id}`]); expect(second.sourcesNextCursor).toBe(null);
    await expect(service.getArtistDetail(mbid, other, { cursor: first.sourcesNextCursor! })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('requires the registered PUT update contract and persists owned pause/resume while rejecting foreign sessions', async () => {
    const member = await login(actor), foreign = await login(other);
    expect((await member.patch(`/api/subscriptions/${subscription}`).send({ isActive: false })).status).toBe(404);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription } })).isActive).toBe(true);
    for (const isActive of [false, true]) {
      const response = await member.put(`/api/subscriptions/${subscription}`).send({ isActive });
      expect(response.status).toBe(200); expect(response.body.subscription.isActive).toBe(isActive);
      expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription } })).isActive).toBe(isActive);
    }
    expect((await foreign.put(`/api/subscriptions/${subscription}`).send({ isActive: false })).status).toBe(404);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: subscription } })).isActive).toBe(true);
  });
  it('composes real database settings with global-only worker credentials and exact-actor owned/global fallback', async () => {
    const original = await prisma.globalSetting.findUnique({ where: { key: 'constellation' } });
    let globalId: number | undefined;
    try {
      await prisma.globalSetting.upsert({ where: { key: 'constellation' }, create: { key: 'constellation', value: { constellationIndexEnabled: false, dailyApiBudget: 3 } }, update: { value: { constellationIndexEnabled: false, dailyApiBudget: 3 } } });
      const owned = await prisma.connection.create({ data: { userId: actor, type: 'discogs', name: 'Owned audit Discogs', config: { token: 'audit-own-token' } } });
      await prisma.connection.create({ data: { userId: other, type: 'discogs', name: 'Foreign audit Discogs', config: { token: 'audit-foreign-token' } } });
      await resolveConfiguredCreditSource();
      expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBeUndefined();
      expect(adapter.discogs.mock.calls.at(-1)?.[1]).toEqual({ onRequest: expect.any(Function) });
      const global = await prisma.connection.create({ data: { userId: null, type: 'discogs', name: 'Global audit Discogs', config: { token: 'audit-global-token' } } }); globalId = global.id;
      await resolveConfiguredCreditSource(); expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBe('audit-global-token');
      await resolveConfiguredCreditSource(actor); expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBe('audit-own-token');
      await prisma.connection.update({ where: { id: owned.id }, data: { isActive: false } });
      await resolveConfiguredCreditSource(actor); expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBe('audit-global-token');
      await prisma.connection.delete({ where: { id: global.id } }); globalId = undefined;
      await resolveConfiguredCreditSource(actor); expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBeUndefined();
      await resolveConfiguredCreditSource(); expect(adapter.discogs.mock.calls.at(-1)?.[0]).toBeUndefined();
      expect(adapter.discogs.mock.calls.some(([token]) => token === 'audit-foreign-token')).toBe(false);
    } finally {
      if (globalId !== undefined) await prisma.connection.delete({ where: { id: globalId } });
      if (original) await prisma.globalSetting.update({ where: { key: original.key }, data: { value: original.value } });
      else await prisma.globalSetting.deleteMany({ where: { key: 'constellation' } });
    }
  });
});
