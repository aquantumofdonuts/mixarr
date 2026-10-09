import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

const people = [
  { personId: 1, displayName: 'Common Name — British solo artist', genre: 'Rock', size: 4, owned: true },
  { personId: 7, displayName: 'Common Name — Canadian ensemble', genre: 'Jazz', size: 3, owned: false },
  { personId: 42, displayName: 'A very long credited collaborator name with session performance and production work', genre: null, size: 2, owned: false },
];
const credits = [{ source: 1, target: 42, weight: 3, bridge: 0.75, bridgeConfident: true, roleBitmask: 6, sampleMasterId: 987, sharedMasterCount: 4 }];
async function constellationFixture(page: Page, delayFirstSeed = false) {
  const calls: string[] = [], invalid: string[] = [];
  let releaseSeed!: () => void;
  const firstSeed = new Promise<void>(resolve => { releaseSeed = resolve; });
  await page.route(/\/api\/constellation\//, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    calls.push(`${path}${url.search}`);
    const reply = (json: unknown, status = 200) => route.fulfill({ status, json });
    if (request.method() !== 'GET') { invalid.push(request.method()); return reply({ error: 'Unexpected mutation' }, 501); }
    if (path === '/api/constellation/identity') {
      const mbid = url.searchParams.get('mbid'), personId = Number(url.searchParams.get('personId'));
      if (mbid && ARTIST_IDS.includes(mbid)) return reply({ mbid, personId: mbid === ARTIST_IDS[0] ? 1 : 7, needsManual: false });
      if (!mbid && people.some(person => person.personId === personId)) return reply({ personId, mbid: personId === 42 ? null : ARTIST_IDS[personId === 1 ? 0 : 1], displayName: people.find(person => person.personId === personId)!.displayName, needsManual: personId === 42 });
      invalid.push(`${path}${url.search}`); return reply({ error: 'Unknown identity' }, 400);
    }
    if (path === '/api/constellation/seed') {
      const seed = url.searchParams.get('id');
      if (!seed || !ARTIST_IDS.includes(seed) || url.searchParams.get('type') !== 'artist') { invalid.push(`${path}${url.search}`); return reply({ error: 'Invalid seed' }, 400); }
      if (delayFirstSeed && seed === ARTIST_IDS[0]) await firstSeed;
      const focusId = seed === ARTIST_IDS[0] ? 1 : 7;
      return reply({ focusId, subgraph: { focusId, nodes: people, edges: credits }, streamToken: { id: `fixture-${focusId}`, generation: 1 } });
    }
    const expand = path.match(/^\/api\/constellation\/expand\/(1|7|42)$/);
    if (expand && /^fixture-(1|7)$/.test(url.searchParams.get('token') || '') && url.searchParams.get('generation') === '1') return reply({ personId: Number(expand[1]), enqueued: true, subgraph: { focusId: Number(expand[1]), nodes: people, edges: credits } });
    if (path === '/api/constellation/path' && ['1', '7'].includes(url.searchParams.get('from') || '') && ['1', '7'].includes(url.searchParams.get('to') || '') && ['shortest', 'interesting'].includes(url.searchParams.get('mode') || '')) return reply({ nodes: [Number(url.searchParams.get('from')), 42, Number(url.searchParams.get('to'))], degrees: 2, mode: url.searchParams.get('mode') });
    if (/^\/api\/constellation\/person\/(1|7|42)\/releases$/.test(path)) return reply({ personId: Number(path.split('/')[4]), releases: [{ releaseId: 10, title: 'Actual fixture credited release', year: 1994, master: 987 }] });
    if (/^\/api\/constellation\/stream\/fixture-(1|7)$/.test(path)) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ generation: 1, nodes: [people[2]], edges: [] })}\n\n` });
    if (path === '/api/constellation/play' && url.searchParams.get('artist') === people[0].displayName) return reply({ source: 'youtube', youtubeUrl: 'https://www.youtube.com/results?search_query=fixture', owned: true });
    invalid.push(`${path}${url.search}`); return reply({ error: 'Unexpected constellation contract' }, 501);
  });
  return { calls, invalid, releaseSeed };
}
async function choose(page: Page, label: string, candidate: 'British' | 'Canadian') {
  const input = page.getByLabel(label, { exact: true });
  await input.fill('Common Name');
  await input.locator('..').getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('group', { name: `Choose ${label.toLowerCase()} identity` }).getByRole('radio', { name: new RegExp(candidate) }).check();
}
async function seed(page: Page, candidate: 'British' | 'Canadian') {
  await choose(page, 'Seed artist', candidate);
  await expect(page.getByRole('button', { name: 'Explore artist' })).toBeEnabled();
  await page.getByRole('button', { name: 'Explore artist' }).click();
}

test('deliberate same-name choices, real credit bridges, playback, inspector round trip and Back/reload', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page);
  await page.goto('/constellation?q=retained');
  await page.getByLabel('Seed artist', { exact: true }).fill('Common Name');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(2); await expect(page.getByRole('button', { name: 'Explore artist' })).toBeDisabled();
  expect(fixture.calls.some(call => call.includes('/seed'))).toBe(false);
  await page.getByRole('radio', { name: /British/ }).check(); await expect(page.getByText('Discogs person ID: 1', { exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Explore artist' }).click();
  await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[0]}&focus=1`));
  const panel = page.getByRole('dialog', { name: `${people[0].displayName} details` });
  await expect(panel.getByText('Producer · Composer', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Shared release on Discogs' })).toHaveAttribute('href', 'https://www.discogs.com/master/987');
  await panel.getByRole('button', { name: `Play ${people[0].displayName}`, exact: true }).click();
  await expect(page.getByRole('link', { name: /Open in YouTube/ })).toBeVisible();
  await panel.getByRole('link', { name: 'Open artist inspector' }).click();
  const inspector = page.getByRole('dialog', { name: 'Common Name', exact: true }); await expect(inspector).toBeVisible();
  await inspector.getByRole('button', { name: 'Back to list' }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('focus') === '1' && !url.searchParams.has('artist'));
  await expect(inspector).toHaveCount(0);
  await panel.getByRole('link', { name: 'Open artist inspector' }).click(); await expect(inspector).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(url => !url.searchParams.has('artist')); await expect(inspector).toHaveCount(0);
  await expect(panel).toBeVisible(); await expect(panel.getByRole('link', { name: 'Open artist inspector' })).toBeFocused();
  await panel.getByRole('button', { name: 'Close panel' }).click();
  await page.getByText('People in this field', { exact: true }).click();
  await page.getByRole('button', { name: people[1].displayName, exact: true }).click();
  await expect(page).toHaveURL(/focus=7/); await page.goBack(); await expect(page).toHaveURL(/focus=1/);
  await page.reload(); await expect(page.getByRole('dialog', { name: `${people[0].displayName} details` })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('q')).toBe('retained'); expect(fixture.invalid).toEqual([]);
});

test('named endpoints send numeric path IDs and reload restores verified names', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page); await page.goto(`/constellation?seed=${ARTIST_IDS[0]}&focus=1`);
  await page.getByRole('button', { name: 'Close panel' }).click();
  await page.getByText('Find a collaboration path', { exact: true }).click();
  await choose(page, 'From artist', 'British'); await choose(page, 'To artist', 'Canadian');
  await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 1', { exact: true })).toBeVisible(); await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Find path', exact: true }).click();
  await expect(page.getByTestId('path-finder-result')).toContainText('2 degrees');
  expect(fixture.calls.some(call => call === '/api/constellation/path?from=1&to=7&mode=shortest')).toBe(true);
  await expect(page).toHaveURL(/from=1&to=7&mode=shortest/);
  await page.reload(); await page.getByText('Find a collaboration path', { exact: true }).click();
  await expect(page.getByLabel('From artist', { exact: true })).toHaveValue(people[0].displayName);
  await expect(page.getByLabel('To artist', { exact: true })).toHaveValue(people[1].displayName);
  await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 1', { exact: true })).toBeVisible(); await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await expect(page.getByTestId('path-finder-result')).toContainText('2 degrees'); expect(fixture.invalid).toEqual([]);
});

test('an unresolved named candidate never seeds a graph or fabricates an inspector link', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page);
  await page.route('**/api/constellation/identity?mbid=*', route => route.fulfill({ json: { mbid: ARTIST_IDS[0], personId: null, needsManual: true } }));
  await page.goto('/constellation'); await choose(page, 'Seed artist', 'British');
  await expect(page.getByText(/No verified graph identity/)).toBeVisible(); await expect(page.getByText(/Discogs person ID:/)).toHaveCount(0); await expect(page.getByRole('button', { name: 'Explore artist' })).toBeDisabled();
  expect(fixture.calls.some(call => call.includes('/seed'))).toBe(false); expect(fixture.invalid).toEqual([]);
});

test('a delayed old seed cannot replace the newer named artist', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page, true); await page.goto('/constellation'); await seed(page, 'British');
  await expect.poll(() => fixture.calls.some(call => call.includes(`id=${ARTIST_IDS[0]}`))).toBe(true);
  await seed(page, 'Canadian'); await expect(page.getByRole('dialog', { name: `${people[1].displayName} details` })).toBeVisible();
  fixture.releaseSeed(); await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[1]}&focus=7`));
  await expect(page.getByRole('dialog', { name: `${people[0].displayName} details` })).toHaveCount(0); expect(fixture.invalid).toEqual([]);
});

test('the common inspector launches a graph using its canonical seed identity', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page); await page.goto(`/search?artist=${ARTIST_IDS[1]}`);
  await page.getByRole('link', { name: 'Explore collaborations' }).click(); await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[1]}`));
  await expect(page.getByRole('dialog', { name: `${people[1].displayName} details` })).toBeVisible(); expect(fixture.invalid).toEqual([]);
});

for (const theme of ['light', 'dark'] as const) test(`320px ${theme} named controls, credit panel and graph stay within the viewport`, async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page); await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(value => localStorage.setItem('theme', value), theme);
  await page.goto(`/constellation?seed=${ARTIST_IDS[0]}&focus=1`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  const panel = page.getByRole('dialog', { name: `${people[0].displayName} details` }); await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Shared release on Discogs' })).toBeVisible();
  const evidence = process.env.CATALOG_EVIDENCE_DIR || '/tmp/t26-browser'; await mkdir(evidence, { recursive: true });
  await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/constellation-credit-320-${theme}.png`, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const controls = page.getByTestId('constellation-controls'); expect(await controls.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Close panel' }).click(); await page.getByText('Find a collaboration path', { exact: true }).click();
  await choose(page, 'From artist', 'British'); await choose(page, 'To artist', 'Canadian');
  await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 1', { exact: true })).toBeVisible(); await expect(page.getByTestId('path-finder').getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await page.getByTestId('path-finder').getByText('Discogs person ID: 7', { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const button = page.getByRole('button', { name: 'Find path', exact: true }); expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: `${evidence}/constellation-path-320-${theme}.png`, animations: 'disabled' }); expect(fixture.invalid).toEqual([]);
});

test('seed names and IDs follow cross-seed Back, Forward and reload independently of walking focus', async ({ catalogPage: page }) => {
  const fixture = await constellationFixture(page);
  await page.route('**/api/search/musicbrainz/artist?*', route => route.fulfill({ json: { results: ARTIST_IDS.map((id, index) => ({ id, name: index ? 'Canadian seed' : 'British seed', disambiguation: index ? 'Canadian ensemble' : 'British solo artist' })) } }));
  await page.route(/\/api\/search\/artist\/[^/]+\/detail(?:\?|$)/, route => {
    const mbid = new URL(route.request().url()).pathname.split('/')[4];
    if (!ARTIST_IDS.includes(mbid) || route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ json: { mbid, name: mbid === ARTIST_IDS[0] ? 'British restored seed' : 'Canadian restored seed', imageUrl: null, disambiguation: 'Verified fixture artist', membership: 'not-in-library', sources: [], sourcesNextCursor: null, unavailable: [] } });
  });
  await page.goto('/constellation'); await seed(page, 'British');
  await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[0]}&focus=1`)); await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('British seed');
  await seed(page, 'Canadian'); await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[1]}&focus=7`));
  await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('Canadian seed');
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[0]}&focus=1`));
  await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('British restored seed'); await expect(page.getByText('Discogs person ID: 1', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore artist' })).toBeEnabled();
  await page.goForward(); await expect(page).toHaveURL(new RegExp(`seed=${ARTIST_IDS[1]}&focus=7`));
  await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('Canadian restored seed'); await expect(page.getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('Canadian restored seed');
  await page.getByRole('button', { name: 'Close panel' }).click(); await page.getByText('People in this field', { exact: true }).click();
  await page.getByRole('button', { name: people[2].displayName, exact: true }).click();
  await expect(page).toHaveURL(url => url.searchParams.get('seed') === ARTIST_IDS[1] && url.searchParams.get('focus') === '42');
  await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('Canadian restored seed'); await expect(page.getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await page.reload(); await expect(page).toHaveURL(url => url.searchParams.get('seed') === ARTIST_IDS[1] && url.searchParams.get('focus') === '42');
  await expect(page.getByLabel('Seed artist', { exact: true })).toHaveValue('Canadian restored seed'); await expect(page.getByText('Discogs person ID: 7', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: `${people[2].displayName} details` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore artist' })).toBeEnabled(); expect(fixture.invalid).toEqual([]);
});
