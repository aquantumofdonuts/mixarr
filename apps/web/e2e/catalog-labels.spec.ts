import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

const labelId = '33333333-3333-4333-8333-333333333333';
const artist = (id: string, name: string) => ({ id, name, sortName: name, imageUrl: null });
async function openLabel(page: Page) {
  await page.route('**/api/search/label?**', route => route.fulfill({ json: { labels: [{ id: labelId, name: 'Catalog Label' }], count: 1 } }));
  await page.goto('/search?q=Catalog&tab=label');
  await page.getByRole('button', { name: 'View Artists', exact: true }).click();
  return page.getByRole('dialog', { name: 'Catalog Label', exact: true });
}

test('label release cursors survive duplicates, loaded filtering, and a failed page', async ({ catalogPage: page }) => {
  const offsets: number[] = [];
  let failed = false;
  await page.route('**/api/search/label/*/artists?**', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (offset === 100 && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { error: 'Label releases temporarily unavailable' } });
    }
    if (![0, 50, 100].includes(offset)) return route.fulfill({ status: 400, json: { error: 'Unexpected release offset' } });
    return route.fulfill({ json: {
      artists: [offset === 100 ? artist(ARTIST_IDS[1], 'Beta artist') : artist(ARTIST_IDS[0], 'Alpha artist')],
      releasesProcessed: offset === 100 ? 20 : 50,
      totalReleases: 120, nextReleaseOffset: offset === 100 ? null : offset + 50,
    } });
  });
  const dialog = await openLabel(page);
  await expect(dialog.getByText(/50 releases checked; 1 artists? loaded/)).toBeVisible();
  expect(offsets).toEqual([0]);
  await dialog.getByRole('textbox', { name: 'Search loaded artists', exact: true }).fill('Beta');
  await expect(dialog.getByText(/No loaded artists match/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(dialog.getByText(/100 releases checked; 1 artists? loaded/)).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Search loaded artists', exact: true })).toHaveValue('Beta');
  await dialog.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Label releases temporarily unavailable');
  await expect(dialog.getByText(/100 releases checked; 1 artists? loaded/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog.getByText(/120 releases checked; 2 artists? loaded/)).toBeVisible();
  await expect(dialog.getByText('Beta artist', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Search loaded artists', exact: true }).fill('');
  await expect(dialog.getByText('Alpha artist', { exact: true })).toHaveCount(1);
  expect(offsets).toEqual([0, 50, 100, 100]);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Artists', exact: true })).toBeFocused();
});

test('mobile label filters collapse independently and keep bulk actions outside the scroll body', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.route('**/api/search/label/*/artists?**', route => route.fulfill({ json: {
    artists: Array.from({ length: 50 }, (_, index) => artist(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, `Loaded artist ${index + 1}`)),
    releasesProcessed: 50, totalReleases: 50, nextReleaseOffset: null,
  } }));
  const dialog = await openLabel(page);
  await expect(dialog.getByRole('checkbox')).toHaveCount(50);
  await dialog.getByRole('checkbox').first().check();
  const search = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Search$/ }) });
  const sort = dialog.locator('details').filter({ has: page.locator('summary').filter({ hasText: /^Sort$/ }) });
  await expect(search).toHaveAttribute('open', '');
  await expect(sort).toHaveAttribute('open', '');
  await search.locator('summary').press('Enter');
  await expect(search).not.toHaveAttribute('open', '');
  await expect(sort).toHaveAttribute('open', '');
  await sort.locator('summary').press('Enter');
  await expect(sort).not.toHaveAttribute('open', '');
  await dialog.locator('[data-modal-body]').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.getByRole('button', { name: /^Add 1 selected artists?$/ })).toBeInViewport();
  expect(await dialog.evaluate(element => [...element.querySelectorAll<HTMLElement>('*')].filter(child => ['auto', 'scroll'].includes(getComputedStyle(child).overflowY) && child.scrollHeight > child.clientHeight).length)).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const evidence = process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence';
  await mkdir(`${evidence}/labels`, { recursive: true });
  await page.screenshot({ path: `${evidence}/labels/mobile.png`, animations: 'disabled' });
});

test('label keyboard traversal reaches fields and footer with open and collapsed filters', async ({ catalogPage: page }) => {
  await page.route('**/api/search/label/*/artists?**', route => route.fulfill({ json: {
    artists: [artist(ARTIST_IDS[0], 'Alpha artist')], releasesProcessed: 50,
    totalReleases: 100, nextReleaseOffset: 50,
  } }));
  const dialog = await openLabel(page);
  const checkbox = dialog.getByRole('checkbox', { name: 'Select Alpha artist' });
  await checkbox.check();
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const searchSummary = dialog.locator('summary').filter({ hasText: /^Search$/ });
  const sortSummary = dialog.locator('summary').filter({ hasText: /^Sort$/ });
  const field = dialog.getByRole('textbox', { name: 'Search loaded artists' });
  const sort = dialog.getByRole('combobox', { name: 'Sort loaded artists' });
  const add = dialog.getByRole('button', { name: 'Add 1 selected artists' });
  const visibleControls = [searchSummary, field, sortSummary, sort, checkbox,
    dialog.getByRole('link', { name: 'Open artist Alpha artist', exact: true }), dialog.getByRole('link', { name: 'Alpha artist', exact: true }),
    dialog.getByRole('link', { name: 'Open on Last.fm' }), dialog.getByRole('link', { name: 'Open on MusicBrainz' }),
    dialog.getByRole('button', { name: 'Select all loaded artists' }),
    dialog.getByRole('button', { name: 'Clear selection' }), dialog.getByRole('button', { name: 'Load more' }), add, close];
  await close.focus();
  for (const control of visibleControls) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await expect(add).toBeFocused();
  await searchSummary.focus();
  await page.keyboard.press('Enter');
  await sortSummary.focus();
  await page.keyboard.press('Enter');
  await expect(field).toBeHidden();
  await expect(sort).toBeHidden();
  await close.focus();
  for (const control of [searchSummary, sortSummary, ...visibleControls.slice(4)]) {
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
  }
  await page.keyboard.press('Shift+Tab');
  await expect(add).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Artists', exact: true })).toBeFocused();
});


test('same-name label artists open the common inspector above retained selection, filtering and pending pages', async ({ catalogPage: page }) => {
  const offsets: number[] = [];
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/search/label/*/artists?**', async route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    offsets.push(offset);
    if (offset === 50) await held;
    return route.fulfill({ json: { artists: ARTIST_IDS.map(id => artist(id, 'Common Name')), releasesProcessed: 50, totalReleases: 100, nextReleaseOffset: offset === 0 ? 50 : null } });
  });
  await openLabel(page);
  const label = page.getByRole('dialog', { name: 'Catalog Label', exact: true, includeHidden: true });
  const checks = label.getByRole('checkbox', { name: 'Select Common Name', exact: true });
  await checks.nth(1).check();
  await label.getByRole('textbox', { name: 'Search loaded artists', exact: true }).fill('Common');
  const names = label.getByRole('link', { name: 'Common Name', exact: true });
  const artwork = label.getByRole('link', { name: 'Open artist Common Name', exact: true }).first();
  expect((await artwork.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await artwork.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await label.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(label.getByText('Loading label releases…', { exact: true })).toBeVisible();
  try {
    await names.nth(1).click();
    const inspector = page.getByRole('dialog', { name: 'Common Name', exact: true });
    await expect(inspector).toBeVisible();
    expect(new URL(page.url()).searchParams.get('artist')).toBe(ARTIST_IDS[1]);
    await expect(label).toHaveCount(1);
    await inspector.getByRole('button', { name: 'Back to list', exact: true }).click();
    await expect(inspector).toHaveCount(0);
    await expect(label).toBeVisible();
    await expect(names.nth(1)).toBeFocused();
    await expect(checks.nth(1)).toBeChecked();
    await expect(checks.nth(0)).not.toBeChecked();
    await expect(label.getByRole('textbox', { name: 'Search loaded artists', exact: true })).toHaveValue('Common');
    await expect(label.getByText('Loading label releases…', { exact: true })).toBeVisible();
    await label.getByRole('link', { name: 'Open artist Common Name', exact: true }).first().click();
    await expect(inspector).toBeVisible();
    expect(new URL(page.url()).searchParams.get('artist')).toBe(ARTIST_IDS[0]);
    await page.keyboard.press('Escape');
    await expect(inspector).toHaveCount(0);
    await expect(label).toBeVisible();
    await expect(label.getByRole('link', { name: 'Open artist Common Name', exact: true }).first()).toBeFocused();
  } finally { release(); }
  await expect(label.getByText('100 releases checked; 2 artists loaded', { exact: true })).toBeVisible();
  expect(offsets).toEqual([0, 50]);
  await expect(checks.nth(1)).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(label).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'View Artists', exact: true })).toBeFocused();
});
