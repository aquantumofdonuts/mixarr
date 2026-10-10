import { createHmac } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createDecisionUndo, verifyDecisionUndo, restoreDecision, rejectReviews, type UndoItem } from '../../src/lib/decision-undo.js';

const clock = 1_800_000_000_000;
const feedItem: UndoItem = { table: 'subscription-result', id: 1, originalStatus: 'failed', revision: clock + 1 };
function sign(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', process.env.SESSION_SECRET!).update('mixarr:decision-undo:v1:' + encoded).digest('base64url')}`;
}
function fixture() {
  let feed = [{ id: 1, userId: 1, status: 'rejected', processedAt: new Date(clock + 1), skipReason: 'acquisition_uncertain' as string | null, errorMessage: 'Retry membership lookup' as string | null }];
  let review = [1, 2].map(id => ({ id, userId: 1, status: 'pending', updatedAt: new Date(clock) }));
  const tables = (name: 'feed' | 'review') => ({
    findFirst: vi.fn(async ({ where }) => (name === 'feed' ? feed : review).find(row => row.id === where.id && row.userId === (where.userId ?? where.subscription.userId)) ?? null),
    findMany: vi.fn(async ({ where }) => (name === 'feed' ? feed : review).filter(row => where.id.in.includes(row.id) && row.userId === where.userId)),
    updateMany: vi.fn(async ({ where, data }) => {
      const rows = name === 'feed' ? feed : review;
      const matched = rows.filter(row => row.id === where.id && row.userId === (where.userId ?? where.subscription.userId)
        && row.status === where.status && (name === 'feed' ? (row as typeof feed[number]).processedAt : (row as typeof review[number]).updatedAt).getTime() === (where.processedAt ?? where.updatedAt).getTime());
      matched.forEach(row => Object.assign(row, data)); return { count: matched.length };
    }),
  });
  const db = { subscriptionResult: tables('feed'), reviewItem: tables('review'), $transaction: vi.fn(async fn => {
    const originalFeed = structuredClone(feed), originalReview = structuredClone(review);
    try { return await fn(db); } catch (error) { feed = originalFeed; review = originalReview; throw error; }
  }) };
  return { db: db as unknown as PrismaClient, mock: db, feed: () => feed, review: () => review };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(clock + 10); vi.stubEnv('SESSION_SECRET', 'undo-test-secret-32-characters-long'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('signed decision restoration', () => {
  it('authenticates the full nested payload and exact encoded bytes', () => {
    const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem]);
    expect(verifyDecisionUndo(undoToken, 1, 'feed-dismiss').items).toEqual([feedItem]);
    expect(Buffer.from(undoToken.split('.')[0], 'base64url').toString()).not.toContain('errorMessage');
    const [encoded, signature] = undoToken.split('.'); const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()); payload.items[0].originalStatus = 'queued';
    const tampered = Buffer.from(JSON.stringify(payload)).toString('base64url');
    expect(() => verifyDecisionUndo(`${tampered}.${signature}`, 1, 'feed-dismiss')).toThrow('Invalid decision');
    expect(() => verifyDecisionUndo(`${encoded}.A`, 1, 'feed-dismiss')).toThrow('Invalid decision');
  });
  it.each([[2, 'feed-dismiss'], [1, 'review-reject']] as const)('rejects wrong actor or action %s/%s', (actor, kind) => {
    const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem]); expect(() => verifyDecisionUndo(undoToken, actor, kind)).toThrow('Invalid decision');
  });
  it('rejects expired and future-issued tokens', () => {
    const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem], clock);
    expect(() => verifyDecisionUndo(undoToken, 1, 'feed-dismiss', clock + 120_000)).toThrow('expired');
    expect(() => verifyDecisionUndo(undoToken, 1, 'feed-dismiss', clock - 1)).toThrow('expired');
  });
  it('requires the configured secret before any decision write', async () => {
    const s = fixture(); vi.stubEnv('SESSION_SECRET', '');
    expect(() => createDecisionUndo(1, 'feed-dismiss', [feedItem])).toThrow('unavailable');
    await expect(rejectReviews(s.db, [1], 1)).rejects.toThrow('unavailable'); expect(s.mock.$transaction).not.toHaveBeenCalled();
  });
  it('rejects oversized token, oversize selection and invalid nested schema', () => {
    expect(() => verifyDecisionUndo('x'.repeat(32_769), 1, 'feed-dismiss')).toThrow('Invalid');
    expect(() => createDecisionUndo(1, 'feed-dismiss', Array.from({ length: 101 }, () => feedItem))).toThrow('Invalid');
    const payload = { version: 1, actorId: 1, kind: 'feed-dismiss', issuedAt: clock, expiresAt: clock + 120_000, items: [{ ...feedItem, originalStatus: 'added' }] };
    expect(() => verifyDecisionUndo(sign(payload), 1, 'feed-dismiss')).toThrow('Invalid');
    expect(() => verifyDecisionUndo(sign({ ...payload, items: [feedItem, feedItem] }), 1, 'feed-dismiss')).toThrow('Invalid');
    expect(() => verifyDecisionUndo(sign({ ...payload, expiresAt: clock + 120_001, items: [feedItem] }), 1, 'feed-dismiss')).toThrow('expired');
  });
  it('restores failed feed state without resetting revision or metadata', async () => {
    const s = fixture(); const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem]);
    expect(await restoreDecision(s.db, undoToken, 1, 'feed-dismiss')).toEqual({ restoredIds: [1] });
    expect(s.feed()[0]).toMatchObject({ status: 'failed', errorMessage: 'Retry membership lookup', skipReason: 'acquisition_uncertain' });
    expect(s.feed()[0].processedAt.getTime()).toBeGreaterThan(feedItem.revision);
    await expect(restoreDecision(s.db, undoToken, 1, 'feed-dismiss')).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
  });
  it.each(['foreign', 'missing', 'revision', 'status'])('rejects %s records without mutation', async problem => {
    const s = fixture(); const row = s.feed()[0];
    if (problem === 'foreign') row.userId = 2;
    if (problem === 'missing') s.feed().pop();
    if (problem === 'revision') row.processedAt = new Date(clock + 2);
    if (problem === 'status') row.status = 'added';
    const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem]);
    await expect(restoreDecision(s.db, undoToken, 1, 'feed-dismiss')).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.mock.subscriptionResult.updateMany).not.toHaveBeenCalled();
  });
  it('rejects mixed eligible and foreign reviews before any write', async () => {
    const s = fixture(); s.review()[1].userId = 2; await expect(rejectReviews(s.db, [1, 2], 1)).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.mock.reviewItem.updateMany).not.toHaveBeenCalled();
  });
  it('rechecks expiry inside the transaction before writes', async () => {
    const s = fixture(); const { undoToken } = createDecisionUndo(1, 'feed-dismiss', [feedItem]);
    const read = s.mock.subscriptionResult.findFirst.getMockImplementation()!;
    s.mock.subscriptionResult.findFirst.mockImplementation(async args => { const row = await read(args); vi.setSystemTime(clock + 120_011); return row; });
    await expect(restoreDecision(s.db, undoToken, 1, 'feed-dismiss')).rejects.toMatchObject({ code: 'UNDO_EXPIRED' });
    expect(s.mock.subscriptionResult.updateMany).not.toHaveBeenCalled();
  });
  it('blocks frozen-clock ABA replay after reject→restore→reject', async () => {
    const s = fixture(); const first = await rejectReviews(s.db, [1, 2], 1);
    await restoreDecision(s.db, first.undoToken, 1, 'review-reject');
    const second = await rejectReviews(s.db, [1, 2], 1);
    await expect(restoreDecision(s.db, first.undoToken, 1, 'review-reject')).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.review().map(row => row.status)).toEqual(['rejected', 'rejected']);
    await restoreDecision(s.db, second.undoToken, 1, 'review-reject'); expect(s.review().map(row => row.status)).toEqual(['pending', 'pending']);
  });
  it('rolls back all rows when conditional restoration loses a race', async () => {
    const s = fixture(); const { undoToken } = await rejectReviews(s.db, [1, 2], 1);
    const update = s.mock.reviewItem.updateMany.getMockImplementation()!;
    s.mock.reviewItem.updateMany.mockImplementation(async args => args.where.id === 2 ? { count: 0 } : update(args));
    await expect(restoreDecision(s.db, undoToken, 1, 'review-reject')).rejects.toMatchObject({ code: 'DECISION_CONFLICT' });
    expect(s.review().map(row => row.status)).toEqual(['rejected', 'rejected']);
  });
});
