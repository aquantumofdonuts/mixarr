import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, CATALOG_USER, catalogFeed, catalogQueue } from '../apps/web/e2e/catalog-fixtures';

// Use fictional catalog fixtures to capture UI without provider activity.
const names = ['Harbor Signals', 'Cedar Lines', 'Paper Satellites', 'Quiet Atlas', 'Night Transit', 'Small Hours', 'Glass Fields', 'Northbound Orchestra'];
const timestamp = '2026-10-10T09:00:00.000Z';
const artwork = catalogFeed[0].imageUrl;
catalogFeed.splice(0, catalogFeed.length, ...names.map((artistName, index) => ({
  id: `feed-${index + 1}`, artistName, artistMbid: `11111111-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  imageUrl: artwork, score: 1, subscriptionCount: 1, sourceCount: 1, sources: ['lastfm'],
  createdAt: timestamp, status: 'pending' as const, tags: [index % 2 ? 'ambient' : 'jazz'], listeners: null,
  subscriptionName: 'Weekly discoveries', sourceRecordCount: 1,
  sourceRecords: [{ key: `subscription-result:${index + 1}`, kind: 'subscription-result' as const,
    label: 'Weekly discoveries', subscriptionId: 11, runId: 71, recordedAt: timestamp, recordStatus: 'pending', sourceUrl: null }],
})));
catalogQueue.splice(24);
catalogQueue.forEach((item, index) => { item.artistName = names[index % names.length]; item.mbid = catalogFeed[index % names.length].artistMbid; });

test('capture the current catalog for the GitHub Pages website', async ({ catalogPage: page }) => {
  test.setTimeout(120_000);
  const directory = resolve(__dirname, 'img');
  await mkdir(directory, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem('theme', 'light');
    localStorage.setItem('sidebar-collapsed', 'false');
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const captures: { file: string; route: string }[] = [];
  const capture = async (name: string) => {
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('link', { name: 'Mixarr home' }).locator('img')).toBeVisible();
    await expect.poll(() => page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
    await page.screenshot({ path: `${directory}/mixarr-${name}.png`, animations: 'disabled' });
    captures.push({ file: `img/mixarr-${name}.png`, route: new URL(page.url()).pathname + new URL(page.url()).search });
  };
  await page.route('**/api/subscriptions', route => route.fulfill({ json: { subscriptions: [
    { id: 11, name: 'Weekly discoveries', type: 'lastfm_similar', config: { artist: names[0] }, resultHandling: 'queue', resultLimit: 50, isActive: true, schedule: '0 0 * * 0', lastRun: timestamp, lastRunStatus: 'completed', lastRunCount: 8 },
    { id: 12, name: 'Fresh releases', type: 'listenbrainz_fresh_releases', config: {}, resultHandling: 'preview', resultLimit: 25, isActive: true, schedule: '0 8 * * *', lastRun: timestamp, lastRunStatus: 'completed', lastRunCount: 12 },
    { id: 13, name: 'Ambient selections', type: 'lastfm_tag', config: { tag: 'ambient' }, resultHandling: 'queue', resultLimit: 30, isActive: false, schedule: '0 9 * * 1', lastRun: null },
  ] } }));
  await page.route('**/api/connections', route => route.fulfill({ json: { connections: [
    ['lidarr', 'Music library'], ['lastfm', 'Listening history'], ['listenbrainz', 'ListenBrainz discoveries'], ['discogs', 'Record collection'],
  ].map(([type, name], index) => ({ id: index + 1, type, name, userId: CATALOG_USER.id, isActive: true, lastTest: null, createdAt: timestamp })) } }));
  await page.route('**/api/admin/users', route => route.fulfill({ json: { users: [
    { ...CATALOG_USER, isActive: true, lastLogin: timestamp, createdAt: timestamp },
    { id: 8, username: 'listener', displayName: 'Listener', role: 'user', isActive: true, lastLogin: timestamp, createdAt: timestamp },
  ] } }));
  await page.route('**/api/dashboard/stats', route => route.fulfill({ json: { stats: {
    activeSubscriptions: 2, pendingDiscoveryRecords: catalogFeed.length, subscriptionRecordsMarkedAdded: 0,
    pendingReviews: catalogQueue.length, runningJobs: 0, activeConnections: 4,
  } } }));
  await page.route('**/api/subscriptions/11/results?**', route => route.fulfill({ json: {
    results: catalogFeed.map(item => ({ id: Number(item.id.slice(5)), itemType: 'artist', name: item.artistName,
      artistName: null, mbid: item.artistMbid, status: 'pending', skipReason: null, createdAt: timestamp, runId: 71, imageUrl: artwork })),
    total: catalogFeed.length, statusCounts: { pending: catalogFeed.length }, offset: 0, limit: 50,
  } }));
  await page.route(`**/api/search/artist/${catalogFeed[0].artistMbid}/detail*`, route => route.fulfill({ json: {
    mbid: catalogFeed[0].artistMbid, name: names[0], imageUrl: artwork, membership: 'not-in-library',
    sources: catalogFeed[0].sourceRecords, sourcesNextCursor: null, unavailable: [],
  } }));
  await page.route('**/api/search/discover?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q')?.toLowerCase() || '';
    return route.fulfill({ json: { results: catalogFeed.filter(item => item.artistName.toLowerCase().includes(query))
      .map(item => ({ name: item.artistName, mbid: item.artistMbid, imageUrl: artwork, sources: ['deezer'], inLibrary: false })) } });
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true, level: 1 })).toBeVisible();
  await expect(page.locator('article[data-feed-id]')).toHaveCount(names.length);
  await capture('discover');
  // Capture the dashboard image embedded by the repository README.
  await capture('dashboard');
  await page.locator('article[data-feed-id="feed-1"]').getByRole('link', { name: names[0], exact: true }).click();
  await expect(page.getByRole('dialog', { name: names[0], exact: true })).toContainText('Release chronology');
  await expect(page.getByRole('link', { name: 'Catalog release 1', exact: true })).toBeVisible();
  await capture('artist-inspector');
  await page.keyboard.press('Escape');

  for (const [path, heading, name, ready] of [
    ['/subscriptions', 'Subscriptions', 'subscriptions', 'Ambient selections'],
    ['/subscriptions/11?tab=results', 'Weekly discoveries', 'subscription-results', names[0]],
    ['/connections', 'Connections', 'connections', 'Record collection'],
    ['/users', 'User Management', 'user-management', 'Listener'],
  ]) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(ready).first()).toBeVisible();
    await capture(name);
  }
  await page.goto('/search?q=Harbor&sources=deezer');
  await expect(page.getByRole('link', { name: names[0], exact: true })).toBeVisible();
  await capture('search');
  await page.goto('/queue');
  await expect(page.getByRole('heading', { name: 'Review Queue', exact: true, level: 1 })).toBeVisible();
  await expect(page.getByText(names[0], { exact: true }).first()).toBeVisible();
  await capture('review-queue');

  const people = names.map((displayName, index) => ({ personId: index + 1, displayName, genre: null, size: index ? 2 : 4, owned: index === 0 }));
  const edges = people.slice(1).map(person => ({ source: 1, target: person.personId, weight: 3, bridge: 0.75,
    bridgeConfident: true, roleBitmask: 6, sampleMasterId: 987, sharedMasterCount: 4 }));
  await page.route(/\/api\/constellation\//, route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/identity')) return route.fulfill({ json: { mbid: catalogFeed[0].artistMbid, personId: 1, displayName: names[0], needsManual: false } });
    if (path.endsWith('/seed')) return route.fulfill({ json: { focusId: 1, creditSource: 'index', subgraph: { focusId: 1, nodes: people, edges }, streamToken: { id: 'website-demo', generation: 1 } } });
    if (path.endsWith('/person/1/releases')) return route.fulfill({ json: { personId: 1, releases: [{ releaseId: 10, title: 'After the Last Train (demo)', year: 2024, master: 987 }] } });
    if (path.endsWith('/stream/website-demo')) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ generation: 1, nodes: [], edges: [] })}\n\n` });
    return route.fallback();
  });
  await page.goto(`/constellation?seed=${catalogFeed[0].artistMbid}&focus=1`);
  const panel = page.getByRole('dialog', { name: `${names[0]} details`, exact: true });
  await expect(panel.getByText('After the Last Train (demo)', { exact: true })).toBeVisible();
  await expect(panel.getByText('Producer · Composer', { exact: true }).first()).toBeVisible();
  await expect(page.locator('canvas').first()).toBeVisible();
  await panel.getByRole('button', { name: 'Close panel', exact: true }).click();
  await expect(panel).toHaveCount(0);
  await capture('constellation');
  expect(errors).toEqual([]);
  await writeFile(resolve(__dirname, 'screenshots.json'), JSON.stringify({
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    viewport: { width: 1440, height: 1000 }, theme: 'light',
    data: 'Fictional, intercepted API fixtures. UI presentation only; no provider authentication, connection tests or Lidarr writes.',
    captures,
  }, null, 2) + '\n');
});
