import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), transaction: vi.fn() }));
vi.mock('../../src/lib/db.js', () => ({ default: { subscriptionResult: mocks, $transaction: mocks.transaction } }));
vi.mock('../../src/services/lidarr.js', () => ({ invalidateLidarrCache: vi.fn() }));
vi.mock('../../src/lib/connection-resolver.js', () => ({ getLidarrServiceWithConfig: vi.fn().mockResolvedValue(null), getLastfmService: vi.fn().mockResolvedValue(null) }));
import { feedRouter } from '../../src/routes/feed.js';

let rows: { id: number; name: string; itemType: string; mbid: string; subscriptionId: number; subscription: { userId: number }; status: string; processedAt: Date | null; errorMessage: string | null; skipReason: string | null }[];
const app = express(); app.use(express.json()); app.use((req, _res, next) => { (req as any).user = req.headers['x-anonymous'] ? undefined : { id: Number(req.headers['x-user'] || 1), role: 'user' }; next(); }); app.use('/api/feed', feedRouter());
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T12:00:00Z'));
  rows = [1, 2].map(id => ({ id, name: 'Artist', itemType: 'artist', mbid: '11111111-1111-4111-8111-111111111111', subscriptionId: 3, subscription: { userId: 1 }, status: id === 1 ? 'failed' : 'queued', processedAt: null, errorMessage: id === 1 ? 'Retry' : null, skipReason: id === 1 ? 'acquisition_uncertain' : null }));
  mocks.findMany.mockImplementation(async ({ where }) => rows.filter(row => where.id.in.includes(row.id)));
  mocks.findFirst.mockImplementation(async ({ where }) => rows.find(row => row.id === where.id && row.subscription.userId === where.subscription.userId) ?? null);
  mocks.updateMany.mockImplementation(async ({ where, data }) => {
    const found = rows.filter(row => row.id === where.id && row.subscription.userId === where.subscription.userId && row.status === where.status && row.processedAt?.getTime() === where.processedAt?.getTime());
    found.forEach(row => Object.assign(row, data)); return { count: found.length };
  });
  const tx = { subscriptionResult: mocks };
  mocks.transaction.mockImplementation(async fn => { const original = structuredClone(rows); try { return await fn(tx); } catch (error) { rows = original; throw error; } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('feed signed restoration router', () => {
  it('dismisses immediately and restores original states through the authenticated static route', async () => {
    const dismissed = await request(app).post('/api/feed/feed-1-2/dismiss');
    expect(dismissed.status).toBe(200); expect(dismissed.body.undoToken).toEqual(expect.any(String)); expect(rows.map(row => row.status)).toEqual(['rejected', 'rejected']);
    const revision = rows[0].processedAt!.getTime();
    const restored = await request(app).post('/api/feed/restore').send({ undoToken: dismissed.body.undoToken });
    expect(restored.status).toBe(200); expect(restored.body.restoredIds).toEqual([1, 2]); expect(rows.map(row => row.status)).toEqual(['failed', 'queued']);
    expect(rows[0].errorMessage).toBe('Retry'); expect(rows[0].processedAt!.getTime()).toBeGreaterThan(revision);
  });
  it('refuses foreign actors, replay and old tokens after a frozen-clock decision cycle', async () => {
    const first = await request(app).post('/api/feed/feed-1/dismiss');
    expect((await request(app).post('/api/feed/restore').set('x-user', '2').send({ undoToken: first.body.undoToken })).status).toBe(400);
    expect((await request(app).post('/api/feed/restore').send({ undoToken: first.body.undoToken })).status).toBe(200);
    const second = await request(app).post('/api/feed/feed-1/dismiss');
    expect((await request(app).post('/api/feed/restore').send({ undoToken: first.body.undoToken })).status).toBe(409);
    expect((await request(app).post('/api/feed/restore').send({ undoToken: second.body.undoToken })).status).toBe(200);
  });
  it('fails before mutation when signing is unavailable', async () => {
    vi.stubEnv('SESSION_SECRET', ''); const response = await request(app).post('/api/feed/feed-1/dismiss');
    expect(response.status).toBe(503); expect(rows[0].status).toBe('failed'); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated and oversized requests', async () => {
    expect((await request(app).post('/api/feed/restore').set('x-anonymous', '1').send({ undoToken: 'a.b' })).status).toBe(401);
    expect((await request(app).post('/api/feed/restore').send({ undoToken: 'x'.repeat(32_769) })).status).toBe(400);
  });
  it('does not partially restore when one linked decision has changed', async () => {
    const response = await request(app).post('/api/feed/feed-1-2/dismiss'); rows[1].status = 'added';
    expect((await request(app).post('/api/feed/restore').send({ undoToken: response.body.undoToken })).status).toBe(409);
    expect(rows.map(row => row.status)).toEqual(['rejected', 'added']);
  });
});
