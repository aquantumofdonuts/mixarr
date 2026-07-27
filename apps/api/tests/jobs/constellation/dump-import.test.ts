import { describe, it, expect, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { DumpIndexService } from '../../../src/services/constellation/DumpIndexService.js';
import { importDumpStream } from '../../../src/jobs/constellation/dump-import-worker.js';

// A small slice of the Discogs releases dump structure:
//  - release 100: master_id + genres + styles + released year + release-level
//    extraartist + a track with a per-track extraartist + a free-text credit
//    (id="0") that MUST be skipped.
//  - release 200: NO master_id and released="0" (year -> null), single credit.
const DUMP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<releases>
  <release id="100" status="Accepted">
    <artists>
      <artist>
        <id>999</id>
        <name>Main Band</name>
      </artist>
    </artists>
    <title>First Release</title>
    <extraartists>
      <artist>
        <id>10</id>
        <name>Producer Pete</name>
        <role>Producer</role>
      </artist>
      <artist>
        <id>0</id>
        <name>Free Text Credit</name>
        <role>Other</role>
      </artist>
    </extraartists>
    <genres>
      <genre>Rock</genre>
    </genres>
    <styles>
      <style>Alternative Rock</style>
    </styles>
    <released>1999-05-01</released>
    <master_id is_main_release="true">500</master_id>
    <tracklist>
      <track>
        <position>1</position>
        <title>Track One</title>
        <extraartists>
          <artist>
            <id>20</id>
            <name>Guitar Gary</name>
            <role>Guitar</role>
          </artist>
        </extraartists>
      </track>
    </tracklist>
  </release>
  <release id="200" status="Accepted">
    <title>Second Release</title>
    <extraartists>
      <artist>
        <id>30</id>
        <name>Solo Sue</name>
        <role>Written-By</role>
      </artist>
    </extraartists>
    <genres>
      <genre>Electronic</genre>
    </genres>
    <released>0</released>
  </release>
</releases>`;

describe('importDumpStream', () => {
  let index: DumpIndexService;

  afterEach(() => {
    index?.close();
  });

  it('streams the dump into the index with parsed meta and credits', async () => {
    index = new DumpIndexService(':memory:');

    const progress: number[] = [];
    const result = await importDumpStream(Readable.from(DUMP_XML), index, {
      onProgress: (n) => progress.push(n),
    });

    // Counts: 2 releases, 3 credits kept (10, 20 on release 100; 30 on release 200);
    // the id="0" free-text credit is skipped.
    expect(result.releases).toBe(2);
    expect(result.credits).toBe(3);

    // Release-level credit is linked to the release with parsed meta.
    const peteReleases = await index.getArtistReleases(10);
    expect(peteReleases).toEqual([
      { releaseId: 100, masterId: 500, year: 1999, genres: ['Rock', 'Alternative Rock'] },
    ]);

    // Per-track extraartist is merged into the same release.
    const garyReleases = await index.getArtistReleases(20);
    expect(garyReleases).toEqual([
      { releaseId: 100, masterId: 500, year: 1999, genres: ['Rock', 'Alternative Rock'] },
    ]);

    // No master_id -> null; released="0" -> null year.
    const sueReleases = await index.getArtistReleases(30);
    expect(sueReleases).toEqual([
      { releaseId: 200, masterId: null, year: null, genres: ['Electronic'] },
    ]);

    // The free-text (id 0) credit was skipped entirely.
    expect(await index.getArtistReleases(0)).toEqual([]);

    // Credits for release 100: release-level (Producer -> producer) and
    // per-track (Guitar -> performer) merged, id:0 absent.
    const credits100 = await index.getReleaseCredits(100);
    const byId = new Map(credits100.map((c) => [c.artistId, c]));
    expect([...byId.keys()].sort((a, b) => a - b)).toEqual([10, 20]);
    expect(byId.get(10)!.name).toBe('Producer Pete');
    expect(byId.get(10)!.roles).toEqual(['producer']);
    expect(byId.get(10)!.masterId).toBe(500);
    expect(byId.get(20)!.roles).toEqual(['performer']);

    // Release 200 credit: Written-By -> composer.
    const credits200 = await index.getReleaseCredits(200);
    expect(credits200).toHaveLength(1);
    expect(credits200[0].artistId).toBe(30);
    expect(credits200[0].roles).toEqual(['composer']);

    // Index version bumped from unset (null) to 1.
    expect(index.getIndexVersion()).toBe(1);
    expect(result.indexVersion).toBe(1);

    // Progress reported at least once.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toBe(2);
  });
});
