import { mkdir } from 'node:fs/promises';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

test('selected import settings reach the original artist action and survive a failed attempt', async ({ catalogPage: page }) => {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/search/artists/add', async route => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.fulfill({ status: 503, json: { error: 'Provider temporarily unavailable' } });
    return route.fallback();
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  const row = page.locator('article').filter({ has: page.locator(`a[href*="artist=${ARTIST_IDS[0]}"]`) });
  await row.getByRole('button', { name: 'Add artist Common Name', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toHaveValue('/music');
  await expect(options.getByRole('combobox', { name: 'Quality profile', exact: true })).toHaveValue('1');
  await expect(options.getByLabel('Search on add', { exact: true })).toBeChecked();
  expect(bodies).toEqual([]);
  await options.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive');
  await options.getByRole('combobox', { name: 'Quality profile', exact: true }).selectOption('2');
  await options.getByRole('combobox', { name: 'Monitor albums', exact: true }).selectOption('future');
  await options.getByRole('combobox', { name: 'Monitor new albums', exact: true }).selectOption('none');
  await options.getByLabel('Search on add', { exact: true }).uncheck();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options.getByText('Provider temporarily unavailable', { exact: true })).toBeVisible();
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toHaveValue('/archive');
  await expect(options.getByRole('combobox', { name: 'Quality profile', exact: true })).toHaveValue('2');
  await expect(options.getByLabel('Search on add', { exact: true })).not.toBeChecked();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(row.getByText('In Lidarr', { exact: true })).toBeVisible();
  const expected = { foreignArtistId: ARTIST_IDS[0], mbid: ARTIST_IDS[0], qualityProfileId: 2, metadataProfileId: 1, rootFolderPath: '/archive', monitorOption: 'future', monitorNewItems: 'none', searchOnAdd: false };
  expect(bodies).toEqual([expected, expected]);
});

test('unidentified search artist requires an explicit canonical candidate before any acquisition', async ({ catalogPage: page }) => {
  const acquired: { path: string; body: unknown }[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/add')) acquired.push({ path, body: request.postDataJSON() });
  });
  await page.route('**/api/search/discover/add', route => route.fulfill({ json: { success: true, artist: { foreignArtistId: route.request().postDataJSON().mbid } } }));
  await page.goto('/search?q=Common+Name&tab=artist');
  const trigger = page.getByRole('button', { name: /Add artist Unidentified Ensemble/ });
  await trigger.click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  const choice = options.getByRole('radio', { name: /Canadian ensemble/ });
  await expect(choice).toBeVisible();
  expect(acquired).toEqual([]);
  await options.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toBeFocused();
  expect(acquired).toEqual([]);
  await trigger.click();
  await options.getByRole('radio', { name: /Canadian ensemble/ }).check();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options).toHaveCount(0);
  expect(acquired).toHaveLength(1);
  expect(acquired[0].path).toBe('/api/search/discover/add');
  expect(acquired[0].body).toMatchObject({ mbid: ARTIST_IDS[1], rootFolderPath: '/music', qualityProfileId: 1, searchOnAdd: true });
});

test('mobile add options keep fields and confirmation inside the viewport', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/search?q=Common+Name&tab=artist');
  await page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first().click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toBeVisible();
  await expect(options.getByRole('button', { name: 'Confirm add', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir('/tmp/mixarr-catalog-evidence/add-options', { recursive: true });
  await page.screenshot({ path: '/tmp/mixarr-catalog-evidence/add-options/mobile.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(options).toHaveCount(0);
});

test('feed options keep the aggregate source ID when confirming acquisition', async ({ catalogPage: page }) => {
  const approvals: { path: string; body: unknown }[] = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.startsWith('/api/feed/') && path.endsWith('/approve')) approvals.push({ path, body: request.postDataJSON() });
  });
  await page.goto('/');
  await page.getByTestId('feed-grid').getByRole('button', { name: 'Add artist Common Name', exact: true }).first().click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toHaveValue('/music');
  expect(approvals).toEqual([]);
  await options.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive');
  await options.getByLabel('Search on add', { exact: true }).uncheck();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options).toHaveCount(0);
  expect(approvals).toHaveLength(1);
  expect(approvals[0].path).toBe('/api/feed/feed-1-2/approve');
  expect(approvals[0].body).toMatchObject({ rootFolderPath: '/archive', searchOnAdd: false, qualityProfileId: 1 });
});

test('a partial bulk retry retains options and sends only the failed identities', async ({ catalogPage: page }) => {
  const bodies: { artistIds: string[]; rootFolderPath: string; searchOnAdd: boolean }[] = [];
  await page.route('**/api/search/batch', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: bodies.length === 1
      ? { added: [ARTIST_IDS[0]], skipped: [], failed: [{ id: ARTIST_IDS[1], error: 'Provider temporarily unavailable' }] }
      : { added: [ARTIST_IDS[1]], skipped: [], failed: [] } });
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  const selections = page.getByRole('checkbox', { name: 'Select Common Name', exact: true });
  await expect(selections).toHaveCount(2);
  await selections.nth(0).check();
  await selections.nth(1).check();
  await page.getByRole('button', { name: 'Add selected artists', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await options.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive');
  await options.getByLabel('Search on add', { exact: true }).uncheck();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options.getByRole('alert')).toBeVisible();
  await expect(page.getByText('In Lidarr', { exact: true })).toHaveCount(1);
  await expect(selections).toHaveCount(1);
  await expect(selections).toBeChecked();
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toHaveValue('/archive');
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(page.getByText('In Lidarr', { exact: true })).toHaveCount(2);
  expect(bodies.map(body => body.artistIds)).toEqual([ARTIST_IDS, [ARTIST_IDS[1]]]);
  expect(bodies.every(body => body.rootFolderPath === '/archive' && body.searchOnAdd === false)).toBe(true);
});

test('an unavailable required option focuses its field without making an acquisition request', async ({ catalogPage: page }) => {
  let acquisitions = 0;
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/add')) acquisitions++; });
  await page.route('**/api/discover/profiles', route => route.fulfill({ json: {
    qualityProfiles: [{ id: 1, name: 'Lossless' }], metadataProfiles: [{ id: 1, name: 'Studio albums' }], rootFolders: [],
    defaults: { qualityProfileId: 1, metadataProfileId: 1 },
  } }));
  await page.goto('/search?q=Common+Name&tab=artist');
  await page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first().click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options.getByRole('alert')).toBeVisible();
  await expect(options.getByRole('combobox', { name: 'Root folder', exact: true })).toBeFocused();
  expect(acquisitions).toBe(0);
});
