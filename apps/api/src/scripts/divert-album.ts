/**
 * divert-album.ts — standalone entry point, invoked via `node dist/scripts/divert-album.js`
 * from outside this container (Glen's playlist_sync.py, over SSH + docker exec — Mixarr's
 * own HTTP API requires an authenticated browser session, which isn't practical for a
 * service-to-service call, so this reuses the same "run inside the trusted container"
 * approach the original move_queue_to_soulseek.js ad-hoc script used).
 *
 * Reads one JSON object from stdin: {artistName, albumTitle, lidarrArtistId, lidarrAlbumId}.
 * See divert-lib.ts for what actually happens — this file is just the stdin/stdout wrapper.
 * Deliberately never touches Lidarr's monitored flag itself — that decision belongs
 * entirely to the existing 30-day sweep job, per the standing "don't push to Lidarr
 * until Soulseek has had 30 days" policy (see project_goj_soulseek_first_policy in
 * Jack's memory).
 *
 * Prints exactly one JSON line to stdout: {status, searchResultCount?, error?}.
 */
import { PrismaClient } from "@prisma/client";
import { divertAlbumToSoulseek, getActiveSlskdConnection } from "./divert-lib.js";

interface DivertRequest {
  artistName: string;
  albumTitle: string;
  lidarrArtistId: number;
  lidarrAlbumId: number;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const raw = await readStdin();
  const input: DivertRequest = JSON.parse(raw);

  const prisma = new PrismaClient();
  let processor: Awaited<ReturnType<typeof getActiveSlskdConnection>> = null;

  try {
    processor = await getActiveSlskdConnection(prisma);
    if (!processor) {
      console.log(JSON.stringify({ status: "error", error: "no active slskd connection configured" }));
      process.exitCode = 1;
      return;
    }

    const userId = parseInt(process.env.DIVERT_USER_ID || "1", 10);
    const result = await divertAlbumToSoulseek(
      prisma,
      processor.processor,
      processor.connectionId,
      userId,
      input.artistName,
      input.albumTitle,
      input.lidarrArtistId,
      input.lidarrAlbumId,
    );

    console.log(JSON.stringify(result));
  } catch (err) {
    console.log(JSON.stringify({ status: "error", error: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  } finally {
    if (processor) await processor.processor.close();
    await prisma.$disconnect();
  }
}

main();
