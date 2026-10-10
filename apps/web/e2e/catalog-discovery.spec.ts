import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

const seedIds = ['33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
const seeds = seedIds.map((foreignArtistId, index) => ({ id: index + 1, foreignArtistId, name: index ? 'Seed Beta' : 'Seed Alpha', monitored: true }));
const recommendations = ARTIST_IDS.map(mbid => ({ name: 'Common Name', mbid, matchCount: 1, matchedFrom: ['Seed Alpha'], inLibrary: false }));
async function library(page: Page) {
  await page.route('**/api/discover/library?**', route => {
    const query = new URL(route.request().url()).searchParams;
    const filtered = seeds.filter(seed => seed.name.toLowerCase().includes((query.get('search') || '').toLowerCase()));
    return route.fulfill({ json: { artists: filtered, pagination: { page: 1, limit: 50, total: filtered.length, totalPages: 1 } } });
  });
}

async function chooseSeed(page: Page, name: string) {
  const checkbox = page.getByRole('checkbox', { name: `Use ${name} as seed`, exact: true });
  await checkbox.click();
  // The controlled state follows the completed URL navigation.
  await expect(checkbox).toBeChecked();
}

test('discovery preserves canonical seeds through reload and separates library search drafts', async ({ catalogPage: page }) => {
  await library(page);
  const bodies: { artistNames: string[]; limit: number }[] = [];
  await page.route('**/api/discover/similar', route => {
    const body = route.request().postDataJSON(); bodies.push(body);
    return route.fulfill({ json: { recommendations, seedArtists: body.artistNames, total: recommendations.length, failedSeedArtists: [] } });
  });
  await page.goto('/discover');
  expect(bodies).toEqual([]);
  await chooseSeed(page, 'Seed Alpha');
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  expect(new URL(page.url()).searchParams.getAll('seed')).toEqual([seedIds[0]]);
  const input = page.getByRole('textbox', { name: 'Search library seeds', exact: true });
  await input.fill('Beta');
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Use Seed Alpha as seed', exact: true })).toBeChecked();
  await expect(input).toHaveValue('');
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies).toEqual([{ artistNames: ['Seed Alpha'], limit: 100 }, { artistNames: ['Seed Alpha'], limit: 100 }]);
  await input.fill('Beta');
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('Beta');
  await chooseSeed(page, 'Seed Beta');
  await expect.poll(() => bodies.at(-1)?.artistNames).toEqual(['Seed Alpha', 'Seed Beta']);
  expect(new URL(page.url()).searchParams.getAll('seed')).toEqual(seedIds);
  await page.getByRole('button', { name: 'Remove seed Seed Alpha', exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('seed')).toEqual([seedIds[1]]);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('seed')).toEqual(seedIds);
  await expect(page.getByRole('list', { name: 'Selected seeds', exact: true }).getByText('Seed Alpha', { exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Use Seed Beta as seed', exact: true })).toBeChecked();
  await page.goBack();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('seed')).toEqual([seedIds[0]]);
  await expect(input).toHaveValue('Beta');
  await expect(page.getByRole('checkbox', { name: 'Use Seed Beta as seed', exact: true })).not.toBeChecked();
  await page.goBack();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Use Seed Alpha as seed', exact: true })).toBeChecked();
});

test('a superseded seed response cannot replace recommendations for the current seeds', async ({ catalogPage: page }) => {
  await library(page);
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  const requests: string[][] = [];
  await page.route('**/api/discover/similar', async route => {
    const names = route.request().postDataJSON().artistNames as string[]; requests.push(names);
    if (names.length === 1) {
      await slow;
      await route.fulfill({ json: { recommendations: [{ ...recommendations[0], name: 'Obsolete recommendation' }], seedArtists: names, total: 1, failedSeedArtists: [] } }).catch(() => {});
      return;
    }
    return route.fulfill({ json: { recommendations: [{ ...recommendations[1], name: 'Current recommendation', matchedFrom: names, matchCount: names.length }], seedArtists: names, total: 1, failedSeedArtists: [] } });
  });
  await page.goto('/discover');
  await chooseSeed(page, 'Seed Alpha');
  await expect.poll(() => requests.length).toBe(1);
  await chooseSeed(page, 'Seed Beta');
  await expect(page.getByRole('link', { name: 'Current recommendation', exact: true })).toBeVisible();
  release();
  await expect(page.getByRole('link', { name: 'Obsolete recommendation', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Current recommendation', exact: true })).toBeVisible();
});

test('same-name recommendation actions preserve unrelated selection and effective options', async ({ catalogPage: page }) => {
  await library(page);
  await page.route('**/api/discover/similar', route => route.fulfill({ json: { recommendations, seedArtists: ['Seed Alpha'], total: 2, failedSeedArtists: [] } }));
  const additions: { mbid: string; artistName: string; rootFolderPath: string; searchOnAdd: boolean }[] = [];
  await page.route('**/api/discover/add', route => {
    additions.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, outcome: 'added' } });
  });
  await page.goto('/discover');
  await chooseSeed(page, 'Seed Alpha');
  const rows = ARTIST_IDS.map(id => page.locator('article').filter({ has: page.locator(`a[href*="artist=${id}"]`) }));
  for (const row of rows) await row.getByRole('checkbox', { name: 'Select Common Name', exact: true }).check();
  await rows[0].getByRole('button', { name: 'Add artist Common Name', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await options.getByRole('combobox', { name: 'Root folder', exact: true }).selectOption('/archive');
  await options.getByRole('checkbox', { name: 'Search on add', exact: true }).uncheck();
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect.poll(() => additions.length).toBe(1);
  expect(additions[0]).toMatchObject({ mbid: ARTIST_IDS[0], artistName: 'Common Name', rootFolderPath: '/archive', searchOnAdd: false });
  await expect(rows[1].getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
  await rows[1].getByRole('link', { name: 'Common Name', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Common Name', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rows[1].getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
});

test('mixed discovery outcomes count new artists honestly and retain only failed selections for retry', async ({ catalogPage: page }) => {
  await library(page);
  const failedId = '55555555-5555-4555-8555-555555555555';
  const mixed = [...recommendations, { ...recommendations[0], mbid: failedId, name: 'Failed recommendation' }];
  await page.route('**/api/discover/similar', route => route.fulfill({ json: { recommendations: mixed, seedArtists: ['Seed Alpha'], total: 3, failedSeedArtists: [] } }));
  const additions: string[] = [];
  let fail = true;
  await page.route('**/api/discover/add', route => {
    const { mbid } = route.request().postDataJSON(); additions.push(mbid);
    return mbid === failedId && fail ? route.fulfill({ status: 503, json: { error: 'Provider offline' } }) : route.fulfill({ json: { success: true, outcome: mbid === ARTIST_IDS[1] ? 'already-in-library' : 'added' } });
  });
  await page.goto('/discover');
  await chooseSeed(page, 'Seed Alpha');
  await page.getByRole('button', { name: 'Select loaded recommendations', exact: true }).click();
  await page.getByRole('button', { name: 'Add selected artists', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options.getByText(/1 additions failed/)).toBeVisible();
  await expect(page.getByText('Added 1 artists to Lidarr; 1 already in Lidarr', { exact: true })).toBeVisible();
  await expect(page.getByText('In Lidarr', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('checkbox', { name: 'Select Failed recommendation', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Select Common Name', exact: true })).toHaveCount(0);
  fail = false;
  await options.getByRole('button', { name: 'Confirm add', exact: true }).click();
  await expect(options).toHaveCount(0);
  await expect(page.getByText('In Lidarr', { exact: true })).toHaveCount(3);
  expect(additions).toEqual([...ARTIST_IDS, failedId, failedId]);
  await expect(page.getByRole('region', { name: 'Bulk actions', exact: true })).toHaveCount(0);
});

test('mobile discovery keeps seeds before results and exposes usable persistent actions', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await library(page);
  await page.route('**/api/discover/similar', route => route.fulfill({ json: { recommendations, seedArtists: ['Seed Alpha'], total: 2, failedSeedArtists: [] } }));
  await page.goto('/discover');
  const seed = page.getByRole('checkbox', { name: 'Use Seed Alpha as seed', exact: true });
  await seed.click();
  await expect(seed).toBeChecked();
  const firstRecommendation = page.locator('article').filter({ has: page.locator(`a[href*="artist=${ARTIST_IDS[0]}"]`) });
  await expect(firstRecommendation.getByRole('button', { name: 'Add artist Common Name', exact: true })).toBeVisible();
  const positions = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(positions.scroll).toBeLessThanOrEqual(positions.width);
  const evidence = `${process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence'}/discovery`;
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/mobile.png`, animations: 'disabled' });
});

test('discovery distinguishes unresolved seeds, provider failure, no matches and partial results', async ({ catalogPage: page }) => {
  await library(page);
  const requests: string[][] = [];
  let failed = false;
  await page.route('**/api/discover/similar', route => {
    const names = route.request().postDataJSON().artistNames as string[]; requests.push(names);
    if (!failed) {
      failed = true;
      return route.fulfill({ json: { recommendations: [], seedArtists: names, total: 0, failedSeedArtists: names } });
    }
    if (names.length === 1) return route.fulfill({ json: { recommendations: [], seedArtists: names, total: 0, failedSeedArtists: [] } });
    return route.fulfill({ json: { recommendations: recommendations.map(rec => ({ ...rec, matchedFrom: ['Seed Beta'] })), seedArtists: names, total: 2, failedSeedArtists: ['Seed Alpha'] } });
  });
  await page.goto('/discover?seed=Saved+name');
  await expect(page.getByText('Unresolved saved seed: Saved name. Choose a library identity.', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Remove seed Saved name', exact: true }).click();
  await chooseSeed(page, 'Seed Alpha');
  await expect(page.getByRole('region', { name: 'Recommendations', exact: true }).getByRole('alert')).toContainText('Last.fm recommendations are unavailable.');
  await expect(page.getByText('No new matches for these seed artists.', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry recommendations', exact: true }).click();
  await expect(page.getByText('No new matches for these seed artists.', { exact: true })).toBeVisible();
  await chooseSeed(page, 'Seed Beta');
  await expect(page.getByText('Partial recommendations: Last.fm was unavailable for Seed Alpha.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expect(page.getByText('Similar to: Seed Beta · 1 match', { exact: true })).toHaveCount(2);
  expect(requests).toEqual([['Seed Alpha'], ['Seed Alpha'], ['Seed Alpha', 'Seed Beta']]);
});

test('replacement recommendations preserve prior rows and selection through failure and retry', async ({ catalogPage: page }) => {
  await library(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const requests: string[][] = [];
  let failed = false;
  await page.route('**/api/discover/similar', async route => {
    const names = route.request().postDataJSON().artistNames as string[]; requests.push(names);
    if (names.length === 1) return route.fulfill({ json: { recommendations, seedArtists: names, total: 2, failedSeedArtists: [] } });
    if (!failed) {
      failed = true;
      await pending;
      return route.fulfill({ status: 503, json: { error: 'Fixture Last.fm unavailable' } });
    }
    return route.fulfill({ json: { recommendations: recommendations.map(rec => ({ ...rec, matchedFrom: names, matchCount: 2 })), seedArtists: names, total: 2, failedSeedArtists: [] } });
  });
  await page.goto('/discover');
  await chooseSeed(page, 'Seed Alpha');
  const row = page.locator('article').filter({ has: page.locator(`a[href*="artist=${ARTIST_IDS[0]}"]`) });
  await row.getByRole('checkbox', { name: 'Select Common Name', exact: true }).check();
  await chooseSeed(page, 'Seed Beta');
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expect(page.getByText(/previous recommendations/i)).toBeVisible();
  await expect(row.getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
  await expect(row.getByRole('button', { name: 'Add artist Common Name', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: 'Retry recommendations', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  await expect(page.getByText(/previous recommendations/i)).toBeVisible();
  await page.getByRole('button', { name: 'Retry recommendations', exact: true }).click();
  await expect(page.getByText('Similar to: Seed Alpha, Seed Beta · 2 matches', { exact: true })).toHaveCount(2);
  await expect(row.getByRole('checkbox', { name: 'Select Common Name', exact: true })).toBeChecked();
  await expect(row.getByRole('button', { name: 'Add artist Common Name', exact: true })).toBeEnabled();
  expect(requests).toEqual([['Seed Alpha'], ['Seed Alpha', 'Seed Beta'], ['Seed Alpha', 'Seed Beta']]);
});

test('a direct-linked seed remains resolved when library filtering moves it off-page', async ({ catalogPage: page }) => {
  await library(page);
  const requests: string[][] = [];
  await page.route('**/api/discover/similar', route => {
    const names = route.request().postDataJSON().artistNames as string[]; requests.push(names);
    return route.fulfill({ json: { recommendations, seedArtists: names, total: 2, failedSeedArtists: [] } });
  });
  await page.goto(`/discover?seed=${seedIds[0]}`);
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  const selected = page.getByRole('list', { name: 'Selected seeds', exact: true });
  await expect(selected.getByText('Seed Alpha', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search library seeds', exact: true }).fill('Beta');
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Use Seed Alpha as seed', exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: 'Use Seed Beta as seed', exact: true })).toBeVisible();
  await expect(selected.getByText('Seed Alpha', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find similar artists', exact: true })).toBeEnabled();
  await page.reload();
  await expect(selected.getByText('Seed Alpha', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Common Name', exact: true })).toHaveCount(2);
  expect(requests).toEqual([['Seed Alpha'], ['Seed Alpha']]);
});
