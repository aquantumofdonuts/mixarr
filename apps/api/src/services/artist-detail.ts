import type { PrismaClient } from '@prisma/client';
import type { ArtistDetail, ArtistSourceRecord } from '@mixarr/shared-types';
import { z } from 'zod';
import prisma from '../lib/db.js';
import { readBeforeDeadline } from '../lib/acquisition-deadline.js';
import type { LidarrService } from './lidarr.js';
import { MusicBrainzService } from './musicbrainz.js';

const identity = z.string().uuid();
const cursorSchema = z.object({
  v: z.literal(1),
  userId: z.number().int().positive().safe(),
  mbid: identity,
  createdAt: z.string().datetime(),
  kind: z.enum(['review-item', 'subscription-result']),
  id: z.number().int().positive().safe(),
}).strict();
type SourceCursor = z.infer<typeof cursorSchema>;

export class ArtistDetailInputError extends Error {
  readonly status = 400;
  constructor(public code: 'INVALID_CURSOR' | 'INVALID_IDENTITY' | 'INVALID_LIMIT', message: string) {
    super(message);
    this.name = 'ArtistDetailInputError';
  }
}

export interface ArtistDetailOptions {
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
}

function parseCursor(value: string | undefined, mbid: string, userId: number): SourceCursor | null {
  if (value === undefined) return null;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('encoding');
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) throw new Error('encoding');
    const cursor = cursorSchema.parse(JSON.parse(bytes.toString('utf8')));
    if (cursor.userId !== userId || cursor.mbid !== mbid || new Date(cursor.createdAt).toISOString() !== cursor.createdAt) {
      throw new Error('scope');
    }
    return cursor;
  } catch {
    throw new ArtistDetailInputError('INVALID_CURSOR', 'Invalid source cursor for this artist and user');
  }
}

function afterCursor(cursor: SourceCursor | null, kind: ArtistSourceRecord['kind']) {
  if (!cursor) return {};
  const createdAt = new Date(cursor.createdAt);
  if (kind === cursor.kind) {
    return { OR: [{ createdAt: { gt: createdAt } }, { createdAt, id: { gt: cursor.id } }] };
  }
  return { createdAt: kind > cursor.kind ? { gte: createdAt } : { gt: createdAt } };
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function text(value: string | null | undefined): string | null {
  // eslint-disable-next-line no-control-regex -- Remove control characters from provider text before display.
  return value?.replace(/<[^<>]*>|[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, '').trim() || null;
}

export class ArtistDetailService {
  constructor(
    private prismaClient: PrismaClient = prisma,
    private lidarrService?: Pick<LidarrService, 'getArtistByMbid'>,
    private metadataService: Pick<MusicBrainzService, 'getArtist'> = new MusicBrainzService(),
  ) {}

  async getArtistDetail(mbidInput: string, userId: number, options: ArtistDetailOptions = {}): Promise<ArtistDetail> {
    if (!identity.safeParse(mbidInput).success || !Number.isSafeInteger(userId) || userId <= 0) {
      throw new ArtistDetailInputError('INVALID_IDENTITY', 'A valid artist identity and user are required');
    }
    const mbid = mbidInput.toLowerCase();
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ArtistDetailInputError('INVALID_LIMIT', 'Source limit must be an integer from 1 to 100');
    }
    const cursor = parseCursor(options.cursor, mbid, userId);
    const timeoutSignal = AbortSignal.timeout(20_000);
    const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;
    signal.throwIfAborted();
    const [evidence, metadata, membership] = await Promise.allSettled([
      readBeforeDeadline(this.getSources(mbid, userId, cursor, limit, signal), signal),
      readBeforeDeadline(Promise.resolve().then(() => {
        signal.throwIfAborted();
        return this.metadataService.getArtist(mbid);
      }), signal),
      readBeforeDeadline(Promise.resolve().then(() => {
        signal.throwIfAborted();
        if (!this.lidarrService) throw new Error('No Lidarr connection');
        return this.lidarrService.getArtistByMbid(mbid, signal);
      }), signal),
    ]);
    for (const result of [evidence, metadata, membership]) {
      if (result.status === 'rejected' && result.reason && (result.reason.status === 401 || result.reason.status === 403)) {
        throw result.reason;
      }
    }
    const unavailable: ArtistDetail['unavailable'] = [];
    const sourceData = evidence.status === 'fulfilled' ? evidence.value : null;
    if (!sourceData) unavailable.push('sources');
    const providerArtist = metadata.status === 'fulfilled' && metadata.value?.id?.toLowerCase() === mbid && text(metadata.value.name)
      ? metadata.value : null;
    if (!providerArtist) unavailable.push('metadata');
    const libraryArtist = membership.status === 'fulfilled' && membership.value?.foreignArtistId?.toLowerCase() === mbid
      ? membership.value : null;
    const membershipKnown = membership.status === 'fulfilled' && (membership.value === null || libraryArtist !== null);
    if (!membershipKnown) unavailable.push('membership');
    const sources = sourceData?.rows.slice(0, limit) ?? [];
    const last = sources.at(-1);
    const sourcesNextCursor = sourceData && sourceData.rows.length > limit && last
      ? Buffer.from(JSON.stringify({ v: 1, userId, mbid, createdAt: last.recordedAt, kind: last.kind, id: Number(last.key.split(':')[1]) })).toString('base64url')
      : null;
    const libraryImage = libraryArtist?.images?.map(image => httpUrl(image.remoteUrl) ?? httpUrl(image.url)).find(Boolean);
    return {
      mbid,
      name: text(providerArtist?.name) ?? text(libraryArtist?.artistName) ?? sourceData?.name ?? mbid,
      imageUrl: libraryImage ?? sourceData?.imageUrl ?? null,
      disambiguation: text(providerArtist?.disambiguation) ?? text(libraryArtist?.disambiguation),
      membership: membershipKnown ? (libraryArtist ? 'in-library' : 'not-in-library') : 'unknown',
      sources,
      sourcesNextCursor,
      unavailable,
    };
  }

  private async getSources(mbid: string, userId: number, cursor: SourceCursor | null, limit: number, signal: AbortSignal) {
    signal.throwIfAborted();
    const [results, reviews] = await Promise.all([
      this.prismaClient.subscriptionResult.findMany({
        where: { mbid, subscription: { userId }, ...afterCursor(cursor, 'subscription-result') },
        select: { id: true, mbid: true, name: true, artistName: true, itemType: true, subscriptionId: true, runId: true, createdAt: true, status: true, sourceUrl: true, imageUrl: true, subscription: { select: { userId: true, name: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
      this.prismaClient.reviewItem.findMany({
        where: { mbid, userId, ...afterCursor(cursor, 'review-item') },
        select: { id: true, mbid: true, userId: true, artistName: true, source: true, status: true, createdAt: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
      }),
    ]);
    signal.throwIfAborted();
    const ownedResults = results.filter(row => row.subscription.userId === userId && row.mbid?.toLowerCase() === mbid);
    const ownedReviews = reviews.filter(row => row.userId === userId && row.mbid?.toLowerCase() === mbid);
    const records: ArtistSourceRecord[] = [
      ...ownedResults.map(row => ({
        key: `subscription-result:${row.id}`,
        kind: 'subscription-result' as const,
        label: row.subscription.name,
        subscriptionId: row.subscriptionId,
        runId: row.runId,
        recordedAt: row.createdAt.toISOString(),
        recordStatus: row.status,
        sourceUrl: httpUrl(row.sourceUrl),
      })),
      ...ownedReviews.map(row => ({
        key: `review-item:${row.id}`,
        kind: 'review-item' as const,
        label: row.source,
        subscriptionId: null,
        runId: null,
        recordedAt: row.createdAt.toISOString(),
        recordStatus: row.status,
        sourceUrl: null,
      })),
    ];
    const rows = [...new Map(records.map(row => [row.key, row])).values()].sort((a, b) =>
      a.recordedAt.localeCompare(b.recordedAt) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || Number(a.key.split(':')[1]) - Number(b.key.split(':')[1]));
    let name = ownedReviews.map(row => text(row.artistName)).find(Boolean)
      ?? ownedResults.map(row => text(row.itemType === 'album' ? row.artistName : row.name)).find(Boolean);
    if (!name && cursor) {
      const first = await this.prismaClient.subscriptionResult.findFirst({
        where: { mbid, subscription: { userId } },
        select: { name: true, artistName: true, itemType: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      signal.throwIfAborted();
      name = text(first?.itemType === 'album' ? first.artistName : first?.name);
      if (!name) {
        const review = await this.prismaClient.reviewItem.findFirst({ where: { mbid, userId }, select: { artistName: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        signal.throwIfAborted();
        name = text(review?.artistName);
      }
    }
    return { rows, name: name ?? null, imageUrl: ownedResults.map(row => httpUrl(row.imageUrl)).find(Boolean) ?? null };
  }
}
