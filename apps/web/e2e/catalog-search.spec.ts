import { mkdir } from 'node:fs/promises';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

test('search URL restores committed query and sources while draft typing stays local', async ({ catalogPage: page }) => {
  await page.goto('/search?q=Common+Name&tab=artist&sources=deezer');
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Search query', exact: true })).toHaveValue('Common Name');
  await expect(page.getByRole('button', { name: 'Deezer', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Spotify', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Local draft');
  expect(new URL(page.url()).searchParams.get('q')).toBe('Common Name');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search query', exact: true })).toHaveValue('Common Name');
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Committed second query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Committed second query');
  await page.goBack();
  await expect(page.getByRole('textbox', { name: 'Search query', exact: true })).toHaveValue('Common Name');
  expect(new URL(page.url()).searchParams.get('sources')).toBe('deezer');
});

test('a single same-name add preserves the other selected identity and inspector context', async ({ catalogPage: page }) => {
  const added: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/search/artists/add') added.push(request.postDataJSON().foreignArtistId);
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  const rows = ARTIST_IDS.map(id => page.locator('article').filter({ has: page.locator(`a[href*="artist=${id}"]`) }));
  await rows[0].getByRole('checkbox', { name: 'Select Common Name', exact: true }).check();
  await rows[1].getByRole('checkbox', { name: 'Select Common Name', exact: true }).check();
  await rows[0].getByRole('button', { name: 'Add artist Common Name', exact: true }).click();
  await expect(rows[0].getByText('In Lidarr', { exact: true })).toBeVisible();
  await expect(rows[1].getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
  expect(added).toEqual([ARTIST_IDS[0]]);
  await rows[1].getByRole('link', { name: 'Common Name', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Common Name', exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe('Common Name');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(rows[1].getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
});

test('pending and failed replacement searches retain rows and offer explicit retry', async ({ catalogPage: page }) => {
  let releaseSlow!: () => void;
  const slow = new Promise<void>(resolve => { releaseSlow = resolve; });
  let failedRequests = 0;
  await page.route('**/api/search/discover?**', async route => {
    const q = new URL(route.request().url()).searchParams.get('q');
    if (q === 'Slow query') await slow;
    if (q === 'Failed query' && failedRequests++ === 0) return route.fulfill({ status: 503, json: { error: 'Search source unavailable' } });
    return route.fallback();
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Slow query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  try {
    await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Slow query');
    await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first()).toBeDisabled();
  } finally { releaseSlow(); }
  await expect(page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first()).toBeEnabled();
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Failed query');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Search query', exact: true })).toHaveValue('Failed query');
  await page.getByRole('button', { name: 'Retry search', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry search', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first()).toBeEnabled();
  expect(failedRequests).toBe(2);
});

test('mobile search places the input before controls without horizontal overflow', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/search?q=Common+Name&tab=artist');
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  const input = await page.getByRole('textbox', { name: 'Search query', exact: true }).boundingBox();
  const type = await page.getByRole('combobox', { name: 'Search type', exact: true }).boundingBox();
  expect(input).not.toBeNull(); expect(type).not.toBeNull();
  expect(input!.y + input!.height).toBeLessThanOrEqual(type!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await mkdir('/tmp/mixarr-catalog-evidence/search', { recursive: true });
  await page.screenshot({ path: '/tmp/mixarr-catalog-evidence/search/mobile.png' });
});

test('replacing the query keeps selected identities still present in the new results', async ({ catalogPage: page }) => {
  await page.route('**/api/search/discover?**', async route => {
    if (new URL(route.request().url()).searchParams.get('q') !== 'Replacement') return route.fallback();
    return route.fulfill({ json: { results: [{ mbid: ARTIST_IDS[1], name: 'Common Name', inLibrary: false, sources: ['deezer'] }] } });
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  const selections = page.getByRole('checkbox', { name: 'Select Common Name', exact: true });
  await expect(selections).toHaveCount(2);
  await selections.nth(0).check();
  await selections.nth(1).check();
  await page.getByRole('textbox', { name: 'Search query', exact: true }).fill('Replacement');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(selections).toHaveCount(1);
  await expect(selections).toBeChecked();
  await expect(page.getByRole('button', { name: 'Add selected artists', exact: true })).toBeVisible();
});
