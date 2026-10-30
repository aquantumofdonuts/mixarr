/**
 * One-shot CLI: node dist/scripts/divert-album.js.
 * Read { artistName, albumTitle, lidarrArtistId, lidarrAlbumId } from stdin
 * and try Soulseek through divert-lib. Leave monitoring changes to the sweep.
 * Print one JSON line: { status, searchResultCount?, error? }.
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

main().finally(() => {
  // Exit after cleanup so lingering BullMQ/Redis handles cannot keep CLI stdout open.
  process.exit(process.exitCode ?? 0);
});
