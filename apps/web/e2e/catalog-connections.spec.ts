import { mkdir } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { test, expect, CATALOG_USER } from './catalog-fixtures';
import { waitForTheme } from './fixtures';

async function connectionsApi(page: Page) {
  const state = { testCalls: 0, deleteCalls: 0, saveCalls: 0, failDelete: true, failStatus: false, authorized: false, lastTest: null as string | null };
  let removed = false;
  await page.route(/\/api\/connections(?:\/[0-9]+(?:\/[^?]+)?)?$/, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const reply = (json: unknown, status = 200) => route.fulfill({ json, status });
    const source = { id: 4, userId: CATALOG_USER.id, type: 'lastfm', name: 'Listening source', isActive: true, lastTest: state.lastTest, createdAt: '2026-10-07T12:00:00Z' };
    const spotify = { ...source, id: 5, type: 'spotify', name: 'Playlists' };
    const global = { ...source, id: 6, userId: null, type: 'lidarr', name: 'Shared library' };
    if (request.method() === 'GET') {
      if (path === '/api/connections') return reply({ connections: [...(removed ? [] : [source]), spotify, global] });
      if (path === '/api/connections/4') return reply({ connection: { ...source, config: { username: 'fixture-listener' } } });
      if (path === '/api/connections/5/spotify/status') return state.failStatus ? reply({ error: 'Provider status unavailable' }, 503) : reply({ authorized: state.authorized, expired: false, needsReauthorization: !state.authorized });
    }
    if (request.method() === 'PUT' && path === '/api/connections/4') {
      state.saveCalls++;
      return reply({ success: true, connection: source });
    }
    if (request.method() === 'POST' && path === '/api/connections/4/test') {
      state.testCalls++;
      state.lastTest = '2026-10-09T12:00:00Z';
      return reply({ success: false, message: 'Provider rejected fixture credentials' });
    }
    if (request.method() === 'DELETE' && path === '/api/connections/4') {
      state.deleteCalls++;
      if (state.failDelete) return reply({ error: 'Delete unavailable' }, 503);
      removed = true;
      return reply({ success: true });
    }
    return route.fallback();
  });
  return state;
}

test('configured services precede the catalog; a failed test remains separate from its timestamp and reload', async ({ catalogPage: page }) => {
  const api = await connectionsApi(page);
  await page.goto('/connections');
  const row = page.getByRole('article', { name: 'Listening source' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Enabled: Yes');
  await expect(row).toContainText('Session test: Unknown');
  await expect(page.getByTestId('type-card-spotify')).toHaveCount(0);
  await row.getByRole('button', { name: 'Test', exact: true }).click();
  await expect(row).toContainText('Session test: Fail');
  await expect(row.getByRole('alert')).toContainText('Provider rejected fixture credentials');
  await expect.poll(() => api.testCalls).toBe(1);
  await expect(row.locator('time')).toBeVisible();
  await page.reload();
  await expect(row).toContainText('Session test: Unknown');
  await expect(row.locator('time')).toHaveAttribute('datetime', '2026-10-09T12:00:00Z');
  await expect(row.getByText('Pass', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add connection', exact: true }).click();
  await expect(page.getByTestId('type-card-spotify')).toBeVisible();
  await expect(page.getByTestId('type-card-slskd')).toBeVisible();
  expect(await page.getByRole('dialog').locator('[style*="background-color"]').count()).toBe(0);
});

test('OAuth errors stay unknown with Retry and a forged callback cannot manufacture authorization', async ({ catalogPage: page }) => {
  const api = await connectionsApi(page); api.failStatus = true;
  await page.goto('/connections?spotify_authorized=5&source=keep');
  const row = page.getByRole('article', { name: 'Playlists' });
  await expect(row.getByRole('alert')).toContainText('Provider status unavailable');
  await expect(row).toContainText('Authorization: Unknown');
  await expect(row.getByRole('button', { name: 'Authorize Spotify', exact: true })).toHaveCount(0);
  await expect(page.getByText(/authorized successfully/i)).toHaveCount(0);
  await expect(page).toHaveURL(/\/connections\?source=keep$/);
  api.failStatus = false;
  await row.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(row).toContainText('Authorization: Required');
  await expect(row.getByRole('button', { name: 'Authorize Spotify', exact: true })).toBeVisible();
  await expect(row.getByText('Authorization: Authorized', { exact: true })).toHaveCount(0);
});

test('deletion explains retained subscriptions and retains failed deletion for Retry', async ({ catalogPage: page }) => {
  const api = await connectionsApi(page);
  await page.goto('/connections');
  await page.getByRole('article', { name: 'Listening source' }).getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Linked subscriptions are retained but lose this connection and need reconfiguration');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(dialog).toContainText('Delete failed: Delete unavailable');
  expect(api.deleteCalls).toBe(1);
  api.failDelete = false;
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('article', { name: 'Listening source' })).toHaveCount(0);
  expect(api.deleteCalls).toBe(2);
});

test('editing uses redacted config and an awaited failed provider test reaches the configured row', async ({ catalogPage: page }) => {
  const api = await connectionsApi(page);
  let releaseTest!: () => void;
  const pending = new Promise<void>(resolve => { releaseTest = resolve; });
  await page.route('**/api/connections/4/test', async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    await pending;
    return route.fallback();
  });
  await page.goto('/connections');
  const row = page.getByRole('article', { name: 'Listening source' });
  await row.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByPlaceholder('Your Last.fm username (for library subscriptions)')).toHaveValue('fixture-listener');
  await expect(dialog.getByPlaceholder('Last.fm API key')).toHaveValue('');
  await expect(dialog.getByPlaceholder('Last.fm API key')).toHaveAttribute('type', 'password');
  await dialog.getByPlaceholder('Last.fm API key').fill('replacement-fixture-key');
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog).toContainText('Testing connection…');
  await expect(dialog.getByText('Connection saved and tested!', { exact: true })).toHaveCount(0);
  releaseTest();
  await expect(dialog).toContainText('Connection saved but test failed');
  await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(row).toContainText('Session test: Fail');
  await expect(row.getByRole('alert')).toContainText('Provider rejected fixture credentials');
  expect(api.saveCalls).toBe(1);
});

test.describe('member permissions', () => {
  test.use({ catalogRole: 'user' });
  test('retains accessible testing and restricts global modification and maintenance', async ({ catalogPage: page }) => {
    await connectionsApi(page); await page.goto('/connections');
    const global = page.getByRole('article', { name: 'Shared library' });
    await expect(global.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
    await expect(global.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(global.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
    await expect(global.getByText('Library Maintenance')).toHaveCount(0);
    await expect(page.getByRole('article', { name: 'Listening source' }).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  });
});

for (const theme of ['light', 'dark']) {
  test(`narrow ${theme} configured list and provider catalog stay within the viewport`, async ({ catalogPage: page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await connectionsApi(page); await page.goto('/connections');
    await expect(page.getByRole('article', { name: 'Listening source' })).toBeVisible();
    await waitForTheme(page, theme as 'light' | 'dark');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const evidence = `${process.env.CATALOG_EVIDENCE_DIR || '/tmp/t24-evidence'}/connections`;
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${theme}-320.png`, animations: 'disabled' });
    await page.getByRole('button', { name: 'Add connection', exact: true }).click();
    await expect(page.getByTestId('type-card-slskd')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${evidence}/${theme}-catalog-320.png`, animations: 'disabled' });
  });
}
