import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import type { UndoDecisionResponse } from '@mixarr/shared-types';
import { DecisionError, nextRevision } from './decision.js';

const PREFIX = 'mixarr:decision-undo:v1:';
const MAX_TOKEN_LENGTH = 32 * 1024;
const itemSchema = z.discriminatedUnion('table', [
  z.object({ table: z.literal('subscription-result'), id: z.number().int().positive().safe(),
    originalStatus: z.enum(['pending', 'queued', 'failed']), revision: z.number().int().nonnegative().safe(),
  }).strict(),
  z.object({ table: z.literal('review-item'), id: z.number().int().positive().safe(),
    originalStatus: z.literal('pending'), revision: z.number().int().nonnegative().safe(),
  }).strict(),
]);
const payloadSchema = z.object({ version: z.literal(1), actorId: z.number().int().positive().safe(),
  kind: z.enum(['feed-dismiss', 'review-reject']), issuedAt: z.number().int().nonnegative().safe(),
  expiresAt: z.number().int().nonnegative().safe(), items: z.array(itemSchema).min(1).max(100),
}).strict();
export type UndoItem = z.infer<typeof itemSchema>;
export type UndoKind = z.infer<typeof payloadSchema>['kind'];
export const restoreDecisionSchema = z.object({ undoToken: z.string().min(1).max(MAX_TOKEN_LENGTH) }).strict();

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new DecisionError(503, 'UNDO_UNAVAILABLE', 'Decision restoration is unavailable');
  return value;
}
function signature(encoded: string): Buffer {
  return createHmac('sha256', secret()).update(PREFIX + encoded).digest();
}
function invalid(): never { throw new DecisionError(400, 'INVALID_UNDO_TOKEN', 'Invalid decision restoration token'); }

/** Sign before any decision write so an unavailable secret cannot create an irreversible decision. */
export function createDecisionUndo(actorId: number, kind: UndoKind, items: UndoItem[], now = Date.now()): UndoDecisionResponse {
  secret();
  const payload = payloadSchema.safeParse({ version: 1, actorId, kind, issuedAt: now, expiresAt: now + 120_000, items });
  if (!payload.success) invalid();
  const encoded = Buffer.from(JSON.stringify(payload.data)).toString('base64url');
  const undoToken = `${encoded}.${signature(encoded).toString('base64url')}`;
  if (undoToken.length > MAX_TOKEN_LENGTH) throw new DecisionError(413, 'UNDO_TOO_LARGE', 'Select fewer records for this decision');
  return { undoToken, undoExpiresAt: new Date(payload.data.expiresAt).toISOString() };
}

export function verifyDecisionUndo(token: string, actorId: number, kind: UndoKind, now = Date.now()) {
  secret();
  if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) invalid();
  const [encoded, signed] = token.split('.');
  const received = Buffer.from(signed, 'base64url');
  const expected = signature(encoded);
  if (received.length !== expected.length || received.toString('base64url') !== signed || !timingSafeEqual(received, expected)) invalid();
  let decoded: unknown;
  try {
    const bytes = Buffer.from(encoded, 'base64url');
    if (bytes.toString('base64url') !== encoded) invalid();
    decoded = JSON.parse(bytes.toString('utf8'));
  } catch { invalid(); }
  const parsed = payloadSchema.safeParse(decoded);
  if (!parsed.success) invalid();
  const payload = parsed.data;
  if (payload.actorId !== actorId || payload.kind !== kind) invalid();
  if (payload.issuedAt > now || payload.expiresAt <= now || payload.expiresAt <= payload.issuedAt || payload.expiresAt - payload.issuedAt > 120_000) {
    throw new DecisionError(409, 'UNDO_EXPIRED', 'Decision restoration has expired');
  }
  const keys = payload.items.map(item => `${item.table}:${item.id}`);
  if (new Set(keys).size !== keys.length || payload.items.some(item => kind === 'feed-dismiss'
    ? item.table !== 'subscription-result' : item.table !== 'review-item')) invalid();
  return payload;
}

export async function restoreDecision(db: PrismaClient, token: string, actorId: number, kind: UndoKind): Promise<{ restoredIds: number[] }> {
  const payload = verifyDecisionUndo(token, actorId, kind);
  return db.$transaction(async tx => {
    verifyDecisionUndo(token, actorId, kind);
    // Check every row before touching any; CAS still protects decisions made during validation.
    const records = await Promise.all(payload.items.map(async item => {
      if (item.table === 'subscription-result') {
        const row = await tx.subscriptionResult.findFirst({ where: { id: item.id, subscription: { userId: actorId } } });
        if (!row || row.status !== 'rejected' || row.processedAt?.getTime() !== item.revision) {
          throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected decision has changed');
        }
      } else {
        const row = await tx.reviewItem.findFirst({ where: { id: item.id, userId: actorId } });
        if (!row || row.status !== 'rejected' || row.updatedAt.getTime() !== item.revision) {
          throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected decision has changed');
        }
      }
      return item;
    }));
    const revision = nextRevision(records.map(item => new Date(item.revision)));
    for (const item of records) {
      verifyDecisionUndo(token, actorId, kind);
      const changed = item.table === 'subscription-result'
        ? await tx.subscriptionResult.updateMany({
          where: { id: item.id, subscription: { userId: actorId }, status: 'rejected', processedAt: new Date(item.revision) },
          data: { status: item.originalStatus, processedAt: revision },
        })
        : await tx.reviewItem.updateMany({
          where: { id: item.id, userId: actorId, status: 'rejected', updatedAt: new Date(item.revision) },
          data: { status: 'pending', updatedAt: revision },
        });
      if (changed.count !== 1) throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected decision has changed');
    }
    verifyDecisionUndo(token, actorId, kind);
    return { restoredIds: records.map(item => item.id) };
  }, { timeout: 5_000 });
}

/** Reject owned pending reviews atomically while retaining their evidence for Undo/provenance. */
export async function rejectReviews(db: PrismaClient, ids: number[], actorId: number): Promise<UndoDecisionResponse> {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100 || unique.some(id => !Number.isSafeInteger(id) || id <= 0)) invalid();
  secret();
  return db.$transaction(async tx => {
    const rows = await tx.reviewItem.findMany({ where: { id: { in: unique }, userId: actorId } });
    if (rows.length !== unique.length || rows.some(row => row.status !== 'pending')) {
      throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected review is unavailable or already processed');
    }
    const revision = nextRevision(rows.map(row => row.updatedAt));
    const undo = createDecisionUndo(actorId, 'review-reject', rows.map(row => ({
      table: 'review-item', id: row.id, originalStatus: 'pending', revision: revision.getTime(),
    })));
    for (const row of rows) {
      const changed = await tx.reviewItem.updateMany({
        where: { id: row.id, userId: actorId, status: 'pending', updatedAt: row.updatedAt },
        data: { status: 'rejected', updatedAt: revision },
      });
      if (changed.count !== 1) throw new DecisionError(409, 'DECISION_CONFLICT', 'A selected review has changed');
    }
    return undo;
  }, { timeout: 5_000 });
}
