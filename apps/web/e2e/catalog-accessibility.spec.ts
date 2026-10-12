import { test, expect, expectCatalogFits, keyboardActivate, catalogFeed } from './catalog-fixtures';

const subscriptionName = 'Weekly discoveries with extended artist and collaborator credits for the complete saved catalog';
const filename = `${'UnbrokenLongFilename'.repeat(12)}.flac`;
const routes = [
  ['/', 'Discovery', 'Unidentified Ensemble with a Very Long Name and Collaborator Credits'],
  ['/subscriptions', 'Subscriptions', subscriptionName],
  ['/search?q=Common+Name&tab=artist', 'Search', 'Unidentified Ensemble with a Very Long Name and Collaborator Credits'],
  ['/downloads', 'slskd Downloads', filename],
] as const;

test.beforeEach(async ({ catalogPage: page }) => {
  await page.route('**/api/subscriptions', route => route.fulfill({ json: { subscriptions: [{ id: 11, userId: 7, name: subscriptionName, type: 'lastfm_similar', config: { artist: 'Common Name' }, schedule: '0 0 * * 0', resultHandling: 'queue', isActive: true, lastRun: '2026-10-07T12:00:00.000Z', lastRunStatus: 'completed', lastRunCount: 3, nextRun: null }] } }));
  await page.route('**/api/slskd/downloads**', route => route.fulfill({ json: [{ id: 1, connectionId: 1, username: 'fixture-peer', artistName: 'Common Name', filename, fileSize: 1024, status: 'failed', error: 'Fixture transfer interrupted', createdAt: '2026-10-07T12:00:00.000Z', updatedAt: '2026-10-07T12:00:00.000Z' }] }));
});

for (const width of [320, 390]) test(`${width}px similar artist identity and provenance have a readable column`, async ({ catalogPage: page }) => {
  await page.setViewportSize({ width, height: 900 });
  const name = 'A recommendation with extended collaborator credits';
  const seedName = 'Seed Alpha with an extended catalog name';
  await page.route('**/api/discover/library?**', route => route.fulfill({ json: { artists: [{ id: 1, foreignArtistId: '33333333-3333-4333-8333-333333333333', name: seedName, monitored: true }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } } }));
  await page.route('**/api/discover/similar', route => route.fulfill({ json: { recommendations: [{ name, mbid: '11111111-1111-4111-8111-111111111111', matchCount: 1, matchedFrom: [seedName], inLibrary: false }], seedArtists: [seedName], total: 1, failedSeedArtists: [] } }));
  await page.goto('/discover?seed=33333333-3333-4333-8333-333333333333');
  const provenance = page.getByText(`Similar to: ${seedName} · 1 match`, { exact: true });
  await expect(provenance).toBeVisible();
  const identity = provenance.locator('..');
  const identityBounds = (await identity.boundingBox())!;
  const actionBounds = (await page.getByRole('button', { name: `Add artist ${name}`, exact: true }).boundingBox())!;
  console.log(JSON.stringify({ width, identity: identityBounds, action: actionBounds }));
  expect(identityBounds.width, 'Identity and seed provenance must not collapse to a one-word column').toBeGreaterThanOrEqual(140);
  expect(actionBounds.y).toBeGreaterThanOrEqual(identityBounds.y + identityBounds.height);
  await expectCatalogFits(page);
});

test('single-token recommendation names and seeds wrap across mobile and desktop widths', async ({ catalogPage: page }) => {
  const name = 'UnbrokenArtistName'.repeat(6), seedName = 'UnbrokenSeedName'.repeat(6);
  await page.route('**/api/discover/library?**', route => route.fulfill({ json: { artists: [{ id: 1, foreignArtistId: '33333333-3333-4333-8333-333333333333', name: seedName, monitored: true }], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } } }));
  await page.route('**/api/discover/similar', route => route.fulfill({ json: { recommendations: [{ name, mbid: '11111111-1111-4111-8111-111111111111', matchCount: 1, matchedFrom: [seedName], inLibrary: false }], seedArtists: [seedName], total: 1, failedSeedArtists: [] } }));
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/discover?seed=33333333-3333-4333-8333-333333333333');
    const provenance = page.getByText(`Similar to: ${seedName} · 1 match`, { exact: true });
    await expect(provenance).toBeVisible();
    expect((await provenance.locator('..').boundingBox())!.width).toBeGreaterThanOrEqual(140);
    await expectCatalogFits(page);
  }
});

for (const width of [320, 390, 768, 1024, 1440]) {
  for (const theme of ['light', 'dark', 'system'] as const) {
    test(`${width}px ${theme}: data, long text and missing artwork fit the real main`, async ({ catalogPage: page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      for (const [path, heading, content] of routes) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
        await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'system' ? 'dark' : theme);
        await expectCatalogFits(page);
        if (path === '/') {
          await expect(page.getByTestId('image-placeholder')).toHaveCount(catalogFeed.filter(item => !item.imageUrl).length);
        }
        if (path.startsWith('/search')) {
          const input = await page.getByRole('textbox', { name: 'Search query', exact: true }).boundingBox();
          expect(input!.width).toBeGreaterThan(100);
        }
        if (path === '/downloads') {
          await expect(page.getByRole('combobox', { name: 'Download status', exact: true })).toHaveValue('all');
        }
      }
    });
  }
}

test('320px error recovery and reduced motion retain visible controls', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('theme', 'system'));
  let unavailable = true;
  await page.route('**/api/search/discover?**', route => unavailable
    ? route.fulfill({ status: 503, json: { error: 'Stored search source temporarily unavailable' } }) : route.fallback());
  await page.goto('/search?q=Common+Name&tab=artist');
  const retry = page.getByRole('button', { name: 'Retry search', exact: true });
  await expect(retry).toBeVisible();
  await expectCatalogFits(page);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  unavailable = false;
  await keyboardActivate(page, retry);
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expectCatalogFits(page);
  const animationDurations = await page.locator('main').evaluate(element => [element, ...element.querySelectorAll('*')]
    .map(node => getComputedStyle(node).animationDuration).filter(value => value !== '0s'));
  expect(animationDurations.every(value => value.split(',').every(duration => parseFloat(duration) <= 0.01))).toBe(true);
});

test('320px subscription and download failures remain readable and offer keyboard retry', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  for (const [path, endpoint, message, retryName] of [
    ['/subscriptions', '**/api/subscriptions', 'Failed to load subscriptions', 'Retry'],
    ['/downloads', '**/api/slskd/downloads**', 'Could not load downloads.', 'Retry loading downloads'],
  ]) {
    let unavailable = true;
    await page.route(endpoint, route => unavailable ? route.fulfill({ status: 503, json: { error: 'Stored catalog source unavailable' } }) : route.fallback());
    await page.goto(path);
    await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 15000 });
    await expectCatalogFits(page);
    unavailable = false;
    await keyboardActivate(page, page.getByRole('button', { name: retryName, exact: true }));
    await expect(page.getByText(message, { exact: true })).toHaveCount(0);
    await expect(page.getByText(path === '/subscriptions' ? subscriptionName : filename, { exact: true })).toBeVisible();
    await expectCatalogFits(page);
  }
});

test('genuine empty subscriptions and downloads remain distinct from read failures at 320px', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.route('**/api/subscriptions', route => route.fulfill({ json: { subscriptions: [] } }));
  await page.route('**/api/slskd/downloads**', route => route.fulfill({ json: [] }));
  await page.goto('/subscriptions');
  await expect(page.getByText('No subscriptions yet', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert', { name: 'Results unavailable', exact: true })).toHaveCount(0);
  await expectCatalogFits(page);
  await page.goto('/downloads');
  await expect(page.getByText('No downloads yet. Soulseek downloads will appear here.', { exact: true })).toBeVisible();
  await expect(page.getByText('Could not load downloads.', { exact: true })).toHaveCount(0);
  await expectCatalogFits(page);
});

test('640px reflow approximation is labeled separately from native browser zoom', async ({ catalogPage: page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Discovery', exact: true, level: 1 })).toBeVisible();
  const metrics = () => page.evaluate(() => ({ innerWidth, devicePixelRatio, visualScale: visualViewport?.scale }));
  const before = await metrics();
  const attempts = [];
  for (let index = 0; index < 6; index++) {
    await page.keyboard.press('Control+=');
    attempts.push(await metrics());
    if (before.innerWidth / attempts.at(-1)!.innerWidth >= 1.9) break;
  }
  const nativeZoom = { before, attempts };
  await testInfo.attach('native-keyboard-zoom-probe.json', { body: JSON.stringify(nativeZoom, null, 2), contentType: 'application/json' });
  console.log(`${testInfo.project.name} native keyboard zoom probe: ${JSON.stringify(nativeZoom)}`);
  if (before.innerWidth / attempts.at(-1)!.innerWidth >= 1.9) {
    await expectCatalogFits(page);
  } else {
    testInfo.annotations.push({ type: 'coverage-limit', description: 'Native Control+= browser zoom did not produce 200% layout zoom in this automated engine; manual native zoom acceptance is pending. The following 640px viewport is reflow approximation only.' });
  }
  await page.keyboard.press('Control+0');
  // A CSS viewport checks reflow; device scale or CSS zoom cannot prove native zoom.
  await page.setViewportSize({ width: 640, height: 450 });
  for (const [path, heading, content] of routes) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByText(content, { exact: true }).first()).toBeVisible();
    await expectCatalogFits(page);
  }
});
