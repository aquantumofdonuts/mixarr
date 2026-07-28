/**
 * lidarr-webhook.ts — receives Lidarr's native "On Grab" Connect notification so
 * the Soulseek-first policy (see divert-lib.ts / project_goj_soulseek_first_policy
 * in Jack's memory) applies to EVERY grab, not just ones added via Glen's
 * playlist_sync.py. Confirmed 2026-07-27: Lidarr's own RSS sync / missing-album
 * auto-search / manual UI search / retry-after-import-failure all go straight to
 * qBittorrent today, since only the playlist_sync-triggered path was ever wired
 * to check Soulseek first. This is the other half — a single event hook that
 * catches every grab regardless of what triggered it.
 *
 * Not protected by session auth (Lidarr's Connect notification can't carry a
 * browser session) -- uses a shared-secret header instead, checked against
 * LIDARR_WEBHOOK_SECRET. Not exposed outside the Docker network.
 *
 * Deliberately logs the full raw payload on every call. Lidarr's webhook JSON
 * shape is documented but not verified against this specific Lidarr version
 * live yet -- first real call's logged payload is the source of truth if the
 * expected-field parsing below needs adjusting.
 */
import { Router } from 'express';
import http from 'http';
import prisma from '../lib/db.js';
import { createLogger } from '../lib/logger.js';
import { divertAlbumToSoulseek, getActiveSlskdConnection } from '../scripts/divert-lib.js';

export const lidarrWebhookRouter = Router();
const log = createLogger('LidarrWebhook');

const LIDARR_HOST = process.env.LIDARR_HOST || '';
const LIDARR_KEY = process.env.LIDARR_KEY || '';
const USER_ID = parseInt(process.env.DIVERT_USER_ID || '1', 10);

function lidarrRequest(method: string, path: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { 'X-Api-Key': LIDARR_KEY };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }
    const req = http.request({ host: LIDARR_HOST, port: 8686, path, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

interface GrabAlbum {
  id: number;
  title: string;
}

async function handleGrabAsync(artistId: number, artistName: string, albums: GrabAlbum[], downloadId: string) {
  const conn = await getActiveSlskdConnection(prisma);
  if (!conn) {
    log.warn('No active slskd connection configured, skipping Soulseek check for this grab', { artistName, downloadId });
    return;
  }

  for (const album of albums) {
    try {
      const result = await divertAlbumToSoulseek(
        prisma, conn.processor, conn.connectionId, USER_ID,
        artistName, album.title, artistId, album.id,
      );

      if (result.status === 'queued') {
        log.info('Soulseek found this album -- cancelling the qBittorrent grab and unmonitoring', {
          artistName, albumTitle: album.title, albumId: album.id, downloadId,
        });

        const queue = await lidarrRequest('GET', '/api/v1/queue?pageSize=1000');
        const queueRecord = (queue.records || []).find((r: any) => r.downloadId === downloadId && r.albumId === album.id);
        if (queueRecord) {
          await lidarrRequest('DELETE', `/api/v1/queue/${queueRecord.id}?removeFromClient=true&blocklist=false&skipRedownload=true`);
        } else {
          log.warn('Soulseek diversion succeeded but no matching Lidarr queue item found to remove -- the qBittorrent download will proceed alongside it', {
            artistName, albumTitle: album.title, downloadId,
          });
        }

        const albumRecord = await lidarrRequest('GET', `/api/v1/album/${album.id}`);
        albumRecord.monitored = false;
        await lidarrRequest('PUT', `/api/v1/album/${album.id}`, albumRecord);
      } else {
        log.info('No Soulseek match for this grab, leaving the qBittorrent download in place', {
          artistName, albumTitle: album.title, status: result.status,
        });
      }
    } catch (err) {
      log.error('Error processing grab for Soulseek diversion', {
        artistName, albumTitle: album.title,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await conn.processor.close();
}

lidarrWebhookRouter.post('/lidarr-grab', (req, res) => {
  const expectedSecret = process.env.LIDARR_WEBHOOK_SECRET;
  if (expectedSecret) {
    const provided = req.header('X-Webhook-Secret');
    if (provided !== expectedSecret) {
      res.status(401).json({ error: 'invalid webhook secret' });
      return;
    }
  }

  log.info('Received Lidarr webhook payload', { body: req.body });

  const eventType = req.body?.eventType;
  if (eventType !== 'Grab') {
    res.status(200).json({ status: 'ignored', reason: `eventType ${eventType} is not Grab` });
    return;
  }

  const artist = req.body?.artist;
  const albums = req.body?.albums;
  const downloadId = req.body?.downloadId ?? req.body?.release?.downloadId;

  if (!artist?.id || !artist?.name || !Array.isArray(albums) || albums.length === 0 || !downloadId) {
    log.error('Grab webhook payload missing expected fields -- check the logged raw payload above and adjust parsing', {
      hasArtist: !!artist, hasAlbums: Array.isArray(albums), downloadId,
    });
    res.status(200).json({ status: 'error', reason: 'payload missing expected fields, see logs' });
    return;
  }

  // Respond immediately -- Soulseek search + Lidarr queue calls take real time,
  // and Lidarr's own grab flow shouldn't be blocked waiting on this.
  res.status(200).json({ status: 'accepted' });

  void handleGrabAsync(artist.id, artist.name, albums, downloadId).catch((err) => {
    log.error('handleGrabAsync failed', { error: err instanceof Error ? err.message : String(err) });
  });
});
