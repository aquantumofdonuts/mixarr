import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = vi.hoisted(() => ({
  subscription: { count: vi.fn() }, subscriptionResult: { count: vi.fn() },
  reviewItem: { count: vi.fn() }, subscriptionRun: { count: vi.fn(), findMany: vi.fn() },
  connection: { count: vi.fn(), findMany: vi.fn() },
}));
vi.mock('../../src/lib/db.js', () => ({ default: db }));
import { dashboardRouter } from '../../src/routes/dashboard.js';
const app = express();
app.use((req, _res, next) => {
  req.isAuthenticated = (() => !req.headers['x-anonymous']) as typeof req.isAuthenticated;
  (req as any).user = req.headers['x-anonymous'] ? undefined : { id: Number(req.headers['x-user'] || 1), role: req.headers['x-role'] || 'user' }; next();
});
app.use('/api/dashboard', dashboardRouter);
beforeEach(() => {
  vi.resetAllMocks(); db.subscription.count.mockResolvedValue(2); db.subscriptionResult.count.mockResolvedValue(4);
  db.reviewItem.count.mockResolvedValue(3); db.subscriptionRun.count.mockResolvedValue(1); db.connection.count.mockResolvedValue(5);
  db.subscriptionRun.findMany.mockResolvedValue([]); db.connection.findMany.mockResolvedValue([]);
});
describe('authenticated dashboard stats router', () => {
  it('returns separately named record counts and never sums review decisions into artist additions', async () => {
    const response = await request(app).get('/api/dashboard/stats');
    expect(response.status).toBe(200);
    expect(response.body.stats).toEqual({ activeSubscriptions: 2, subscriptionRecordsMarkedAdded: 4, pendingDiscoveryRecords: 4, pendingReviews: 3, runningJobs: 1, activeConnections: 5 });
    expect(db.reviewItem.count).toHaveBeenCalledExactlyOnceWith({ where: { userId: 1, status: 'pending' } });
  });
  it.each(['user', 'admin'])('scopes every stats query to the requesting %s', async role => {
    await request(app).get('/api/dashboard/stats').set('x-user', '7').set('x-role', role);
    expect(db.subscription.count).toHaveBeenCalledWith({ where: { userId: 7, isActive: true } });
    expect(db.subscriptionResult.count).toHaveBeenCalledWith({ where: { subscription: { userId: 7 }, status: 'added', processedAt: { gte: expect.any(Date) } } });
    expect(db.subscriptionResult.count).toHaveBeenCalledWith({ where: { subscription: { userId: 7 }, itemType: 'artist', status: { in: ['pending', 'queued'] } } });
    expect(db.reviewItem.count).toHaveBeenCalledWith({ where: { userId: 7, status: 'pending' } });
    expect(db.subscriptionRun.count).toHaveBeenCalledWith({ where: { subscription: { userId: 7 }, status: 'running' } });
    expect(db.connection.count).toHaveBeenCalledWith({ where: { userId: 7, isActive: true } });
  });
  it('bounds added-result record counts to the preceding 30 days', async () => {
    const before = Date.now(); await request(app).get('/api/dashboard/stats'); const after = Date.now();
    const since = db.subscriptionResult.count.mock.calls[0][0].where.processedAt.gte.getTime();
    const days = 30 * 24 * 60 * 60 * 1000; expect(since).toBeGreaterThanOrEqual(before - days); expect(since).toBeLessThanOrEqual(after - days);
  });
  it('returns actual zeroes for an empty actor', async () => {
    for (const model of [db.subscription, db.subscriptionResult, db.reviewItem, db.subscriptionRun, db.connection]) model.count.mockResolvedValue(0);
    const response = await request(app).get('/api/dashboard/stats'); expect(Object.values(response.body.stats)).toEqual([0, 0, 0, 0, 0, 0]);
  });
  it('rejects an anonymous actor before reading counts', async () => {
    expect((await request(app).get('/api/dashboard/stats').set('x-anonymous', '1')).status).toBe(401);
    expect(db.subscription.count).not.toHaveBeenCalled();
  });
  it('reports count failures without exposing database errors or manufacturing a zero summary', async () => {
    db.subscription.count.mockRejectedValue(new Error('private database details'));
    const response = await request(app).get('/api/dashboard/stats'); expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to fetch stats' });
  });
});
describe('other dashboard reads', () => {
  it('scopes activity to its actor and passes the requested limit', async () => {
    db.subscriptionRun.findMany.mockResolvedValue([{ id: 1, status: 'running', subscription: { name: 'Source' }, startedAt: new Date() }]);
    const response = await request(app).get('/api/dashboard/activity?limit=5').set('x-user', '7');
    expect(response.body.activities[0].title).toBe('Source');
    expect(db.subscriptionRun.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { subscription: { userId: 7 } }, take: 5 }));
  });
  it('counts only returned actor connections', async () => {
    db.connection.findMany.mockResolvedValue([{ name: 'Lidarr', type: 'lidarr', isActive: true }, { name: 'Other', type: 'lastfm', isActive: false }]);
    const response = await request(app).get('/api/dashboard/connections/summary').set('x-user', '7');
    expect(response.body.summary).toMatchObject({ total: 2, active: 1 });
    expect(db.connection.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 7 } }));
  });
});
