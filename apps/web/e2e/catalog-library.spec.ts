import { mkdir } from 'node:fs/promises';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

const artists = Array.from({ length: 520 }, (_, index) => ({
  id: index + 1, name: index === 0 ? 'Common Name' : `Library Artist ${String(index + 1).padStart(3, '0')}`,
  foreignArtistId: index === 1 ? 'unidentified' : ARTIST_IDS[index % 2], monitored: true,
  albumCount: index + 1, trackCount: 10, trackFileCount: 5, sizeOnDisk: 100,
  hasOverview: true, hasPoster: true, hasGenres: true, issues: [], needsRefresh: false,
}));

test.beforeEach(async ({ catalogPage: page }) => {
  await page.route('**/api/search/lidarr/artists/fix-all/status', route => route.fulfill({ json: { jobId: null, status: null } }));
  await page.route('**/api/search/lidarr/artists', route => route.fulfill({ json: { artists, total: artists.length, needingRefresh: 0, issueStats: { noAlbums: 0, noPoster: 0, noOverview: 0, noGenres: 0 }, healthScore: 100 } }));
});

test('library keyboard sorting restores its URL and bounds rendering to the expanded snapshot window', async ({ catalogPage: page }) => {
  let snapshots = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/search/lidarr/artists') snapshots++; });
  await page.goto('/library?sort=albumCount&dir=asc&page=2&keep=value');
  await expect(page.getByText('500 of 520 matching artists shown · 0 selected')).toBeVisible();
  const initialSnapshots = snapshots;
  await expect(page.getByRole('checkbox', { name: 'Select library artist 501', exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select library artist 1', exact: true }).check();
  await page.getByRole('button', { name: 'Show more (20 remaining)' }).click();
  await expect(page).toHaveURL(/page=3/); await expect(page.getByRole('checkbox', { name: 'Select library artist 1', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select library artist 520', exact: true })).toBeVisible();
  const sort = page.getByRole('button', { name: 'Albums', exact: true }); await sort.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('columnheader', { name: 'Albums' })).toHaveAttribute('aria-sort', 'descending');
  expect(new URL(page.url()).searchParams.has('page')).toBe(false); expect(new URL(page.url()).searchParams.get('keep')).toBe('value');
  await page.keyboard.press('Space'); await expect(page.getByRole('columnheader', { name: 'Albums' })).toHaveAttribute('aria-sort', 'ascending');
  await page.goBack(); await expect(page.getByRole('columnheader', { name: 'Albums' })).toHaveAttribute('aria-sort', 'descending');
  await page.goBack(); await expect(page.getByText('520 of 520 matching artists shown · 1 selected')).toBeVisible();
  expect(snapshots).toBe(initialSnapshots); await expect(page.getByRole('link', { name: 'Library Artist 002', exact: true })).toHaveCount(0);
});

test('library artist closure and browser Back retain filters, selected IDs, scroll and trigger focus', async ({ catalogPage: page }) => {
  await page.goto('/library?sort=name&dir=asc&page=2&filter=complete&keep=value');
  const selection = page.getByRole('checkbox', { name: 'Select library artist 100', exact: true }); await selection.check();
  const link = page.getByRole('link', { name: 'Library Artist 100', exact: true }); await link.scrollIntoViewIfNeeded();
  const main = page.locator('[data-list-scroll]'); const top = await main.evaluate(element => element.scrollTop);
  await link.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(link).toBeFocused(); await expect(selection).toBeChecked();
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(top);
  expect(new URL(page.url()).searchParams.get('page')).toBe('2'); expect(new URL(page.url()).searchParams.get('filter')).toBe('complete');
  await link.click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(selection).toBeChecked();
  await expect.poll(() => main.evaluate(element => element.scrollTop)).toBe(top); await expect(link).toBeFocused();
});

test('library search replaces its draft and discrete filters preserve unrelated parameters', async ({ catalogPage: page }) => {
  await page.goto('/library?page=2&keep=value&seed=one&seed=two'); await page.getByRole('textbox', { name: 'Search library snapshot' }).fill('Library Artist 519');
  await expect(page).toHaveURL(/q=Library\+Artist\+519/); await expect(page.getByText('1 of 1 matching artists shown · 0 selected')).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter library snapshot' }).selectOption('complete');
  await expect(page).toHaveURL(/filter=complete/); expect(new URL(page.url()).searchParams.getAll('seed')).toEqual(['one', 'two']); expect(new URL(page.url()).searchParams.get('keep')).toBe('value');
  await page.goBack(); await expect(page.getByRole('combobox', { name: 'Filter library snapshot' })).toHaveValue('all'); await expect(page.getByRole('textbox', { name: 'Search library snapshot' })).toHaveValue('Library Artist 519');
});

test('library narrow table provides labeled horizontal scrolling without page overflow', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/library?q=Common');
  const region = page.getByRole('region', { name: 'Library artists table, scroll horizontally for metadata and actions' }); await expect(region).toBeVisible(); await expect(region).toHaveAttribute('tabindex', '0');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await region.focus(); await page.keyboard.press('ArrowRight');
  if (process.env.CATALOG_EVIDENCE_DIR) { await mkdir(process.env.CATALOG_EVIDENCE_DIR, { recursive: true }); await page.screenshot({ path: `${process.env.CATALOG_EVIDENCE_DIR}/library-mobile.png` }); }
});

test('library native checkbox labels activate across a 44px target and expose partial selection', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/library?q=Library+Artist+00');
  const checkbox = page.getByRole('checkbox', { name: 'Select library artist 2', exact: true }); await checkbox.scrollIntoViewIfNeeded();
  const box = (await checkbox.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 6); await expect(checkbox).toBeChecked();
  const labels = await checkbox.evaluate(input => Array.from((input as HTMLInputElement).labels || []).map(label => ({ width: label.getBoundingClientRect().width, height: label.getBoundingClientRect().height })));
  expect(labels.some(label => label.width >= 44 && label.height >= 44)).toBe(true);
  const all = page.getByRole('checkbox', { name: 'Select shown library artists' }); expect(await all.evaluate(input => (input as HTMLInputElement).indeterminate)).toBe(true);
  await all.scrollIntoViewIfNeeded(); const allBox = (await all.boundingBox())!; await page.mouse.click(allBox.x + allBox.width / 2, allBox.y + allBox.height + 6);
  await expect(all).toBeChecked(); expect(await all.evaluate(input => (input as HTMLInputElement).indeterminate)).toBe(false);
  await expect(page.getByRole('checkbox', { name: 'Select library artist 9', exact: true })).toBeChecked();
});
