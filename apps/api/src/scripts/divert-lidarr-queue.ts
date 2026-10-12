/**
 * Sweep the current Lidarr download queue and try Soulseek for each album.
 * On a match, remove the queued download without blocklisting or redownloading
 * and unmonitor the album to prevent immediate re-grabs. Record every attempt
 * in soulseek_diversions for the scheduled sweep.
 *
 * Run node dist/scripts/divert-lidarr-queue.js with LIDARR_HOST and LIDARR_KEY.
 */
import { PrismaClient } from "@prisma/client";
import http from "http";
import { divertAlbumToSoulseek, getActiveSlskdConnection } from "./divert-lib.js";

const LIDARR_HOST = process.env.LIDARR_HOST || "";
const LIDARR_KEY = process.env.LIDARR_KEY || "";
const USER_ID = parseInt(process.env.DIVERT_USER_ID || "1", 10);

function lidarrRequest(method: string, path: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: LIDARR_HOST, port: 8686, path, method, headers: { "X-Api-Key": LIDARR_KEY } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  if (!LIDARR_HOST || !LIDARR_KEY) {
    console.error("LIDARR_HOST and LIDARR_KEY must be set");
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const conn = await getActiveSlskdConnection(prisma);
  if (!conn) {
    console.error("No active slskd connection configured");
    process.exit(1);
  }

  const queue = await lidarrRequest("GET", "/api/v1/queue?pageSize=1000&includeArtist=true&includeAlbum=true");
  const records: any[] = queue.records || [];
  console.log(`Fetched Lidarr queue: ${records.length} items`);

  const seenAlbums = new Set<number>();
  let moved = 0, noMatch = 0, errors = 0, skipped = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const albumId = rec.albumId;
    const artistId = rec.artistId;
    if (!albumId || !artistId || seenAlbums.has(albumId)) {
      skipped++;
      continue;
    }
    seenAlbums.add(albumId);

    const artistName = rec.artist?.artistName;
    const albumTitle = rec.album?.title;
    if (!artistName || !albumTitle) {
      skipped++;
      continue;
    }

    try {
      const result = await divertAlbumToSoulseek(
        prisma, conn.processor, conn.connectionId, USER_ID,
        artistName, albumTitle, artistId, albumId,
      );

      if (result.status === "queued") {
        await lidarrRequest("DELETE", `/api/v1/queue/${rec.id}?removeFromClient=true&blocklist=false&skipRedownload=true`);
        const album = await lidarrRequest("GET", `/api/v1/album/${albumId}`);
        album.monitored = false;
        await new Promise<void>((resolve, reject) => {
          const body = JSON.stringify(album);
          const req = http.request(
            { host: LIDARR_HOST, port: 8686, path: `/api/v1/album/${albumId}`, method: "PUT",
              headers: { "X-Api-Key": LIDARR_KEY, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } },
            (res) => { res.on("data", () => {}); res.on("end", resolve); },
          );
          req.on("error", reject);
          req.write(body);
          req.end();
        });
        moved++;
        console.log(`[${i + 1}/${records.length}] MOVED: ${artistName} - ${albumTitle}`);
      } else {
        noMatch++;
        console.log(`[${i + 1}/${records.length}] no soulseek match (${result.status}): ${artistName} - ${albumTitle}`);
      }
    } catch (err) {
      errors++;
      console.log(`[${i + 1}/${records.length}] ERROR: ${artistName} - ${albumTitle}: ${err instanceof Error ? err.message : err}`);
    }

    if ((i + 1) % 10 === 0) {
      console.log(`--- progress: ${i + 1}/${records.length} | moved=${moved} noMatch=${noMatch} errors=${errors} skipped=${skipped} ---`);
    }
  }

  console.log(`DONE. moved=${moved} noMatch=${noMatch} errors=${errors} skipped=${skipped}`);
  await conn.processor.close();
  await prisma.$disconnect();
}

main()
  .catch((err) => {
    console.error("FATAL:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Same lingering-connection issue as divert-album.ts — force exit
    // rather than chase down every BullMQ/Redis handle.
    process.exit(process.exitCode ?? 0);
  });
