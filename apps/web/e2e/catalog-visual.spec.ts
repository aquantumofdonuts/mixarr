import { mkdir, writeFile } from 'node:fs/promises';
import { test, expect, ARTIST_IDS, catalogFeed, expectCatalogFits } from './catalog-fixtures';

const recordedAt = '2026-10-07T12:00:00.000Z';
const originalResult = { id: 103, mbid: ARTIST_IDS[0], name: 'Result Artist 3', runId: 71, status: 'pending', createdAt: recordedAt };
const source = { key: `subscription-result:${originalResult.id}`, kind: 'subscription-result', label: 'Weekly discoveries', subscriptionId: 11, runId: 71, recordedAt, recordStatus: 'pending', sourceUrl: null };
const seed = { id: 1, foreignArtistId: '33333333-3333-4333-8333-333333333333', name: 'Seed Alpha', monitored: true };
const people = [
  { personId: 1, displayName: 'Common Name — British solo artist', genre: 'Rock', size: 4, owned: true },
  { personId: 42, displayName: 'Credited collaborator', genre: null, size: 2, owned: false },
];
const credit = { source: 1, target: 42, weight: 3, bridge: 0.75, bridgeConfident: true, roleBitmask: 6, sampleMasterId: 987, sharedMasterCount: 4 };
const creditedRelease = { releaseId: 10, title: 'Actual fixture credited release', year: 1994, master: 987 };
const releases = [2015, 1994].map((year, index) => ({ id: `00000000-0000-4000-8000-00000000000${index + 1}`, title: `Recorded release ${year}`, 'first-release-date': String(year), 'primary-type': 'Album' }));

for (const [theme, width] of [['light', 1440], ['dark', 390]] as const) {
  test(`five stored-evidence signatures: ${theme} ${width}px`, async ({ catalogPage: page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    const directory = `${process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence'}/${testInfo.project.name}`;
    await mkdir(directory, { recursive: true });
    const capture = async (signature: string) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectCatalogFits(page);
      await page.screenshot({ path: `${directory}/${signature}-${theme}-${width}.png`, animations: 'disabled' });
    };
    await page.route('**/api/feed?**', route => route.fulfill({ json: { items: catalogFeed.map((item, index) => index === 0 ? { ...item, id: `feed-${originalResult.id}`, score: 1, subscriptionCount: 1, sourceCount: 1, sources: ['lastfm'], sourceRecords: [source], sourceRecordCount: 1 } : item), total: catalogFeed.length, stats: { pending: 3, addedToday: 0 } } }));
    await page.route('**/api/dashboard/stats', route => route.fulfill({ json: { stats: { activeSubscriptions: 1, pendingDiscoveryRecords: 3, subscriptionRecordsMarkedAdded: 0, pendingReviews: 520, runningJobs: 0, activeConnections: 1 } } }));
    await page.route(`**/api/search/artist/${ARTIST_IDS[0]}/detail*`, route => route.fulfill({ json: { mbid: ARTIST_IDS[0], name: 'Common Name', imageUrl: catalogFeed[0].imageUrl, disambiguation: 'British solo artist', membership: 'not-in-library', sources: [source], sourcesNextCursor: null, unavailable: [] } }));
    await page.route(`**/api/search/artist/${ARTIST_IDS[0]}/releases*`, route => route.fulfill({ json: { releaseGroups: releases, count: releases.length } }));
    await page.goto('/');
    const feedRow = page.locator('article[data-feed-id="feed-103"]');
    await expect(feedRow).toContainText('Discovered through Weekly discoveries');
    await expect(feedRow.getByRole('link', { name: 'Weekly discoveries', exact: true })).toHaveAttribute('href', '/subscriptions/11?tab=results');
    await expect(feedRow.locator('img')).toBeVisible();
    await capture('feed-source');

    await feedRow.getByRole('link', { name: 'Common Name', exact: true }).press('Enter');
    const inspector = page.getByRole('dialog', { name: 'Common Name', exact: true });
    await expect(inspector.getByRole('link', { name: 'Run 71', exact: true })).toHaveAttribute('href', '/subscriptions/11?tab=runs&run=71');
    await expect(inspector.locator('time').first()).toHaveAttribute('datetime', source.recordedAt);
    await expect(inspector.getByRole('region', { name: 'Release chronology' }).getByRole('link')).toHaveText(releases.map(release => release.title));
    await capture('inspector-original-source-chronology');
    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect(page).toHaveURL('/');

    await page.goto('/subscriptions/11?tab=results');
    const result = page.getByRole('article', { name: `Result ${originalResult.id}`, exact: true });
    await expect(result.getByRole('link', { name: 'Run 71', exact: true })).toHaveAttribute('href', '/subscriptions/11?tab=runs&run=71');
    await expect(result.getByRole('link', { name: originalResult.name, exact: true })).toHaveAttribute('href', expect.stringContaining(`artist=${originalResult.mbid}`));
    await capture('subscription-result-run');

    await page.route('**/api/discover/library?**', route => route.fulfill({ json: { artists: [seed], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } } }));
    await page.route('**/api/discover/similar', route => {
      expect(route.request().postDataJSON()).toEqual({ artistNames: [seed.name], limit: 100 });
      return route.fulfill({ json: { recommendations: [{ name: 'Common Name', mbid: ARTIST_IDS[0], matchCount: 1, matchedFrom: [seed.name], inLibrary: false }], seedArtists: [seed.name], total: 1, failedSeedArtists: [] } });
    });
    await page.goto(`/discover?seed=${seed.foreignArtistId}`);
    await expect(page.getByText('Similar to: Seed Alpha · 1 match', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Use Seed Alpha as seed', exact: true })).toBeChecked();
    await capture('similar-artists-matched-seed');

    await page.route(/\/api\/constellation\//, route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/identity')) return route.fulfill({ json: { mbid: ARTIST_IDS[0], personId: 1, displayName: people[0].displayName, needsManual: false } });
      if (url.pathname.endsWith('/seed')) return route.fulfill({ json: { focusId: 1, creditSource: 'index', subgraph: { focusId: 1, nodes: people, edges: [credit] }, streamToken: { id: 'visual-seed', generation: 1 } } });
      if (url.pathname.endsWith('/person/1/releases')) return route.fulfill({ json: { personId: 1, releases: [creditedRelease] } });
      if (url.pathname.endsWith('/stream/visual-seed')) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ generation: 1, nodes: [], edges: [] })}\n\n` });
      throw new Error(`Unexpected signature request: ${url.pathname}`);
    });
    await page.goto(`/constellation?seed=${ARTIST_IDS[0]}&focus=1`);
    const panel = page.getByRole('dialog', { name: `${people[0].displayName} details`, exact: true });
    await expect(panel.getByText('Producer · Composer', { exact: true })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Shared release on Discogs' })).toHaveAttribute('href', `https://www.discogs.com/master/${credit.sampleMasterId}`);
    await expect(panel.getByText(creditedRelease.title, { exact: true })).toBeVisible();
    await panel.scrollIntoViewIfNeeded();
    await capture('constellation-person-role-release');
    await writeFile(`${directory}/stored-evidence-${theme}-${width}.json`, JSON.stringify({ evidence: 'Deterministic intercepted fixtures; UI proof only, human screenshot approval pending', originalResult, source, artistMbid: ARTIST_IDS[0], releases, seed, people, creditSource: 'index', credit, creditedRelease }, null, 2));
    testInfo.annotations.push({ type: 'human-acceptance', description: 'Screenshot approval is an explicit human acceptance step, not implied by test pass.' });
  });
}
