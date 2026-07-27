/**
 * Constellation Dump Import Worker
 *
 * Stream-parses the Discogs CC0 releases dump (tens of GB gzipped) into the
 * local {@link DumpIndexService} index that powers the "Setting-ON" data source.
 *
 * Memory stays flat: the XML is fed through a SAX parser (never buffered whole),
 * and index writes are committed in batches inside a single transaction each, so
 * at most ~`batchSize` releases are held in memory at once.
 *
 * The unit-testable CORE is {@link importDumpStream}, which takes a `Readable` of
 * decompressed XML and a `DumpIndexService`. The gzip + BullMQ + socket.io wiring
 * ({@link runDumpImport}, {@link registerDumpImportWorker}) is a thin shell around
 * it and never runs at import time (no Redis connection until `register*` is
 * called at app startup).
 */

import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import type { Readable } from 'node:stream';
import * as sax from 'sax';
import type { Server as SocketIOServer } from 'socket.io';
import type { DumpIndexService } from '../../services/constellation/DumpIndexService.js';
import { createLogger } from '../../lib/logger.js';

const logger = createLogger('DumpImportWorker');

/** Commit this many parsed releases per transaction (throughput vs. memory). */
const DEFAULT_BATCH_SIZE = 500;

interface ParsedCredit {
  artistId: number;
  name: string;
  role: string;
}

interface ParsedRelease {
  id: number;
  masterId: number | null;
  year: number | null;
  genres: string[];
  credits: ParsedCredit[];
}

export interface ImportDumpResult {
  releases: number;
  credits: number;
  indexVersion: number;
}

export interface ImportDumpOptions {
  onProgress?: (releasesDone: number) => void;
  /** Override the per-transaction batch size (mainly for tests). */
  batchSize?: number;
}

/**
 * Parse the leading 4-digit year from a Discogs `<released>` value.
 * "1999" / "1999-05-01" -> 1999; "0" / "" / absent -> null.
 */
function parseYear(raw: string): number | null {
  const m = raw.match(/^(\d{4})/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  return y > 0 ? y : null;
}

/** Parse a positive integer, returning null for 0/NaN/empty. */
function parsePositiveInt(raw: string): number | null {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Stream a decompressed Discogs releases-dump XML through a SAX parser and write
 * every release's metadata and extraartist credits into `index`.
 *
 * @param input Readable of decompressed XML (the caller gunzips if needed).
 * @param index The (open) DumpIndexService to write into. The caller owns its
 *   lifecycle and must `close()` it.
 */
export function importDumpStream(
  input: Readable,
  index: DumpIndexService,
  opts: ImportDumpOptions = {},
): Promise<ImportDumpResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;

  return new Promise<ImportDumpResult>((resolve, reject) => {
    // strict=true: the Discogs dump is well-formed XML; tag names are preserved.
    const saxStream = sax.createStream(true, { trim: false, position: false });

    // Parse state ------------------------------------------------------------
    const stack: string[] = []; // open-element names, for parent-context checks
    let text = ''; // char buffer for the current element's text content
    let release: ParsedRelease | null = null;
    let artist: ParsedCredit | null = null; // pending extraartist credit
    let inExtra = false; // inside an <extraartists> element (release- or track-level)

    // Batch state ------------------------------------------------------------
    let batch: ParsedRelease[] = [];
    let releasesDone = 0;
    let creditsDone = 0;
    let settled = false;

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    /** Commit the current batch inside one transaction, then clear it. */
    const flushBatch = () => {
      if (batch.length === 0) return;
      const pending = batch;
      batch = [];
      index.transaction((idx) => {
        for (const rel of pending) {
          idx.setReleaseMeta({
            releaseId: rel.id,
            masterId: rel.masterId,
            year: rel.year,
            genres: rel.genres,
          });
          for (const c of rel.credits) {
            idx.upsertArtist(c.artistId, c.name);
            idx.addCredit({
              releaseId: rel.id,
              artistId: c.artistId,
              role: c.role,
              masterId: rel.masterId,
            });
          }
        }
      });
      releasesDone += pending.length;
      for (const rel of pending) creditsDone += rel.credits.length;
      opts.onProgress?.(releasesDone);
    };

    saxStream.on('opentag', (node) => {
      const name = node.name;
      if (name === 'release') {
        const attrs = (node as sax.Tag).attributes ?? {};
        release = {
          id: parseInt(String(attrs.id ?? ''), 10) || 0,
          masterId: null,
          year: null,
          genres: [],
          credits: [],
        };
      } else if (name === 'extraartists') {
        inExtra = true;
      } else if (name === 'artist' && inExtra) {
        artist = { artistId: 0, name: '', role: '' };
      }
      stack.push(name);
      text = '';
    });

    saxStream.on('text', (t) => {
      text += t;
    });

    saxStream.on('closetag', (name) => {
      stack.pop();
      const parent = stack[stack.length - 1];
      const val = text.trim();
      text = '';

      switch (name) {
        case 'release': {
          if (release && release.id > 0) {
            batch.push(release);
            if (batch.length >= batchSize) flushBatch();
          }
          release = null;
          break;
        }
        case 'extraartists': {
          inExtra = false;
          break;
        }
        case 'artist': {
          // Close an extraartist credit; skip free-text (id 0/missing) entries.
          if (inExtra && artist && release && parent === 'extraartists') {
            if (artist.artistId > 0) {
              release.credits.push(artist);
            }
          }
          artist = null;
          break;
        }
        case 'id': {
          if (artist && parent === 'artist') artist.artistId = parsePositiveInt(val) ?? 0;
          break;
        }
        case 'name': {
          if (artist && parent === 'artist') artist.name = val;
          break;
        }
        case 'role': {
          if (artist && parent === 'artist') artist.role = val;
          break;
        }
        case 'master_id': {
          if (release && parent === 'release') release.masterId = parsePositiveInt(val);
          break;
        }
        case 'released': {
          if (release && parent === 'release') release.year = parseYear(val);
          break;
        }
        case 'genre': {
          if (release && parent === 'genres' && val) release.genres.push(val);
          break;
        }
        case 'style': {
          if (release && parent === 'styles' && val) release.genres.push(val);
          break;
        }
        default:
          break;
      }
    });

    saxStream.on('error', (err) => {
      logger.error('SAX parse error during dump import', { error: err });
      fail(err);
    });

    saxStream.on('end', () => {
      if (settled) return;
      try {
        flushBatch();
        const nextVersion = (index.getIndexVersion() ?? 0) + 1;
        index.setIndexVersion(nextVersion);
        settled = true;
        resolve({ releases: releasesDone, credits: creditsDone, indexVersion: nextVersion });
      } catch (err) {
        fail(err as Error);
      }
    });

    input.on('error', fail);
    input.pipe(saxStream);
  });
}

/**
 * Thin wrapper: open a gzipped Discogs releases dump, gunzip it, and stream it
 * into the index via {@link importDumpStream}. Kept separate so the core stays
 * unit-testable without gzip.
 */
export async function runDumpImport(
  filePath: string,
  index: DumpIndexService,
  opts: ImportDumpOptions = {},
): Promise<ImportDumpResult> {
  const fileStream = createReadStream(filePath);
  const gunzip = createGunzip();
  fileStream.on('error', (err) => gunzip.destroy(err));
  const xmlStream = fileStream.pipe(gunzip);
  logger.info('Starting Discogs dump import', { filePath });
  const result = await importDumpStream(xmlStream, index, opts);
  logger.info('Discogs dump import complete', result);
  return result;
}

/**
 * Register the BullMQ worker for the `constellation-import` queue. Called at app
 * startup — NOT at module import time — so tests never open a Redis connection.
 *
 * The heavy lifting is dynamically imported here to keep BullMQ/Redis and the
 * DumpIndexService out of the module graph until the app actually wires workers.
 */
export async function registerDumpImportWorker(io?: SocketIOServer): Promise<void> {
  const { Worker } = await import('bullmq');
  const { createRedisConnection } = await import('../../lib/redis.js');
  const { CONSTELLATION_QUEUE_NAMES } = await import('./queue.js');
  const { DumpIndexService } = await import('../../services/constellation/DumpIndexService.js');

  const worker = new Worker(
    CONSTELLATION_QUEUE_NAMES.IMPORT,
    async (job) => {
      const { filePath } = job.data as { filePath: string };
      // The on-disk index path is supplied by the settings layer (Task 16); until
      // then it comes from the environment.
      const indexPath = process.env.CONSTELLATION_INDEX_PATH ?? '';
      if (!indexPath) throw new Error('Constellation index path is not configured');

      const index = new DumpIndexService(indexPath);
      try {
        return await runDumpImport(filePath, index, {
          onProgress: (releasesDone) => {
            void job.updateProgress({ phase: 'importing', releasesDone });
          },
        });
      } finally {
        index.close();
      }
    },
    { connection: createRedisConnection(), concurrency: 1 },
  );

  worker.on('completed', (job) => {
    logger.info(`Dump import job ${job.id} completed`);
    io?.emit('constellation:import:completed', { jobId: job.id });
  });
  worker.on('failed', (job, error) => {
    logger.error(`Dump import job ${job?.id} failed`, { error });
    io?.emit('constellation:import:failed', { jobId: job?.id, error: error?.message });
  });
}
