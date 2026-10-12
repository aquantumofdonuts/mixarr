import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  exists: vi.fn(), addArtist: vi.fn(), addAlbum: vi.fn(),
  profiles: vi.fn(), folders: vi.fn(), log: vi.fn(), notify: vi.fn(),
}));
vi.mock('../../src/lib/db.js', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const target = process.env.CATALOG_REVIEW_TEST_DATABASE_URL;
  if (target && target !== 'mysql://root@127.0.0.1:13306/mixarr_catalog_test') {
    throw new Error('Review database tests require the disposable local catalog test database');
  }
  return { default: new PrismaClient({ datasources: { db: { url: target ?? 'mysql://root@127.0.0.1:13306/mixarr_catalog_test' } } }) };
});
vi.mock('../../src/middleware/auth.js', () => ({ requireAuth: (req: any, _res: any, next: any) => {
  req.user = { id: Number(req.headers['x-user'] || 1), role: req.headers['x-admin'] ? 'admin' : 'user' }; next();
} }));
vi.mock('../../src/jobs/scheduler.js', () => ({ addImportScheduledJob: vi.fn(), removeImportScheduledJob: vi.fn() }));
vi.mock('../../src/services/spotify.js', () => ({ SpotifyService: vi.fn() }));
vi.mock('../../src/services/lastfm.js', () => ({ LastfmService: vi.fn() }));
vi.mock('../../src/services/ai.js', () => ({ AIService: vi.fn() }));
vi.mock('../../src/services/musicbrainz.js', () => ({ MusicBrainzService: vi.fn() }));
vi.mock('../../src/services/artist-images.js', () => ({ getArtistImages: vi.fn(async () => new Map()) }));
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

import prisma from '../../src/lib/db.js';
import { importsRouter } from '../../src/routes/imports.js';
import { getArtistImages } from '../../src/services/artist-images.js';
const app = express(); app.use(express.json()); app.use('/api/imports', importsRouter);
const at = new Date('2026-10-08T00:00:00.000Z');
let actor: number, other: number;
const queue = (params: Record<string, string | number> = {}, user = actor, admin = false) => {
  const req = request(app).get('/api/imports/review/queue').query(params).set('x-user', String(user));
  return admin ? req.set('x-admin', '1') : req;
};
describe.skipIf(!process.env.CATALOG_REVIEW_TEST_DATABASE_URL)('review queue against disposable real MySQL', () => {
  beforeAll(async () => {
    actor = (await prisma.user.create({ data: { username: `catalog-review-${Date.now()}`, displayName: 'Catalog Test' } })).id;
    other = (await prisma.user.create({ data: { username: `catalog-other-${Date.now()}`, displayName: 'Other Test' } })).id;
    await prisma.reviewItem.createMany({ data: [
      ...Array.from({ length: 520 }, (_, i) => ({ userId: actor, artistName: `Artist ${String(i + 1).padStart(3, '0')}`, source: 'catalog-test', createdAt: at })),
      ...['Literal 100% real', 'Literal under_score', 'Literal back\\slash', 'Literal 100X real', 'Literal underXscore', 'Literal backslash'].map(artistName => ({ userId: actor, artistName, source: 'catalog-test', createdAt: at })),
      { userId: actor, artistName: 'Album Artist', albumName: 'Find This Album', itemType: 'album', source: 'catalog-test', createdAt: at },
      { userId: actor, artistName: 'Reviewed Artist', status: 'approved', source: 'catalog-test', createdAt: at },
      { userId: other, artistName: 'Foreign Artist', source: 'catalog-test', createdAt: at },
    ] });
  });
  afterAll(async () => {
    try { await prisma.user.deleteMany({ where: { id: { in: [actor, other].filter(Boolean) } } }); }
    finally { await prisma.$disconnect(); }
  });
  beforeEach(() => vi.clearAllMocks());
  it('reaches every scoped record beyond 500 with stable timestamp ties and a matching total', async () => {
    const seen: number[] = []; let cursor: string | undefined;
    do {
      const response = await queue({ limit: 100, ...(cursor ? { cursor } : {}) });
      expect(response.status).toBe(200); expect(response.body.total).toBe(527);
      expect(response.body.items.length).toBeLessThanOrEqual(100);
      seen.push(...response.body.items.map((item: any) => item.id));
      cursor = response.body.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(527); expect(new Set(seen).size).toBe(527);
    expect(seen).toEqual([...seen].sort((a, b) => b - a));
    expect(vi.mocked(getArtistImages).mock.calls.at(-1)?.[0]).toHaveLength(27);
  });
  it('searches artist and album names in MySQL using its actual case-insensitive collation', async () => {
    let response = await queue({ q: '  aRtIsT 520  ', limit: 1 });
    expect(response.status).toBe(200); expect(response.body.total).toBe(1); expect(response.body.items[0].artistName).toBe('Artist 520');
    response = await queue({ q: 'find this album', itemType: 'album' });
    expect(response.body.total).toBe(1); expect(response.body.items[0].albumName).toBe('Find This Album');
    response = await queue({ q: 'does not exist' }); expect(response.body).toMatchObject({ items: [], total: 0, nextCursor: null });
    response = await queue({ status: 'approved' }); expect(response.body.total).toBe(1); expect(response.body.items[0].artistName).toBe('Reviewed Artist');
  });
  it.each([['%', 'Literal 100% real'], ['_', 'Literal under_score'], ['\\', 'Literal back\\slash']])('treats %s literally without SQL wildcard expansion', async (q, name) => {
    const response = await queue({ q }); expect(response.status).toBe(200);
    expect(response.body.total).toBe(1); expect(response.body.items.map((item: any) => item.artistName)).toEqual([name]);
  });
  it('keeps reads scoped and refuses a valid cursor from another actor, role, or filter', async () => {
    const member = await queue({ limit: 1 }); const cursor = member.body.nextCursor;
    expect((await queue({}, other)).body.total).toBe(1);
    expect((await queue({}, actor, true)).body.total).toBe(528);
    for (const [params, user, admin] of [[{ cursor }, other, false], [{ cursor }, actor, true], [{ cursor, q: 'Artist' }, actor, false], [{ cursor, status: 'approved' }, actor, false], [{ cursor, itemType: 'album' }, actor, false]] as const) {
      const response = await queue(params, user, admin); expect(response.status).toBe(400); expect(response.body.code).toBe('INVALID_CURSOR');
    }
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cursor, 'base64url').toString()), actor: other })).toString('base64url');
    const response = await queue({ cursor: forged }, other); expect(response.status).toBe(200);
    expect(response.body.items.every((item: any) => item.userId === other)).toBe(true);
  });
  it('bounds input and rejects malformed cursor structures before database work', async () => {
    for (const params of [{ limit: 0 }, { limit: 101 }, { limit: 1.5 }, { q: 'a'.repeat(121) }, { cursor: '?' }, { cursor: Buffer.from('{}').toString('base64url') }]) {
      expect((await queue(params)).status).toBe(400);
    }
    const first = await queue({ limit: 1 }); const parsed = JSON.parse(Buffer.from(first.body.nextCursor, 'base64url').toString());
    for (const patch of [{ id: 0 }, { id: 2147483648 }, { createdAt: 'not-a-date' }, { createdAt: '2026-02-31T00:00:00.000Z' }, { unexpected: true }]) {
      expect((await queue({ cursor: Buffer.from(JSON.stringify({ ...parsed, ...patch })).toString('base64url') })).status).toBe(400);
    }
    expect((await queue()).body.items).toHaveLength(50);
  });
  it('uses a strict older-timestamp bound when records span multiple times', async () => {
    const newer = await prisma.reviewItem.create({ data: { userId: actor, artistName: 'Newest', source: 'catalog-test', createdAt: new Date(at.getTime() + 1000) } });
    try {
      const first = await queue({ limit: 1 }); expect(first.body.items[0].id).toBe(newer.id);
      const second = await queue({ limit: 1, cursor: first.body.nextCursor });
      expect(second.body.items[0].createdAt).toBe(at.toISOString()); expect(second.body.total).toBe(528);
    } finally { await prisma.reviewItem.delete({ where: { id: newer.id } }); }
  });
  it('persists the owned canonical choice in MySQL before acquisition and retains it on uncertain failure', async () => {
    const mbid = '11111111-1111-4111-8111-111111111111';
    const row = await prisma.reviewItem.create({ data: { userId: actor, artistName: 'Chosen Artist', source: 'catalog-test' } });
    const connection = await prisma.connection.create({ data: { userId: actor, type: 'lidarr', name: 'Test Lidarr',
      config: { url: 'http://lidarr.test', apiKey: 'test', qualityProfileId: 1, metadataProfileId: 1, rootFolderPath: '/music' } } });
    mocks.exists.mockResolvedValue(false); mocks.log.mockResolvedValue(undefined); mocks.notify.mockResolvedValue(undefined);
    mocks.addArtist.mockImplementationOnce(async () => {
      const persisted = await prisma.reviewItem.findUniqueOrThrow({ where: { id: row.id } });
      expect(persisted.mbid).toBe(mbid); expect(persisted.status).toBe('pending');
      expect(persisted.updatedAt.getTime()).toBeGreaterThan(row.updatedAt.getTime());
      throw new Error('connection lost');
    }).mockResolvedValueOnce({});
    const approve = (body: object) => request(app).put(`/api/imports/review/${row.id}`).set('x-user', String(actor)).send({ status: 'approved', ...body });
    try {
      const first = await approve({ mbid }); expect(first.body.outcomes[0].state).toBe('uncertain');
      const saved = await prisma.reviewItem.findUniqueOrThrow({ where: { id: row.id } });
      expect(saved).toMatchObject({ mbid, status: 'pending' });
      const second = await approve({}); expect(second.body.outcomes[0].state).toBe('added');
      const approved = await prisma.reviewItem.findUniqueOrThrow({ where: { id: row.id } });
      expect(approved.status).toBe('approved'); expect(approved.updatedAt.getTime()).toBeGreaterThan(saved.updatedAt.getTime());
      expect(mocks.addArtist.mock.calls[1][0]).toBe(mbid);
    } finally {
      await prisma.reviewItem.delete({ where: { id: row.id } });
      await prisma.connection.delete({ where: { id: connection.id } });
    }
  });
});
