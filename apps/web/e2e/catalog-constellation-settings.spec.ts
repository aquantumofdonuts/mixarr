import { test, expect } from './catalog-fixtures';

const defaults = { constellationIndexEnabled: false, constellationIndexPath: '/data/constellation/index.db', orbitEdgeBudget: 250000, dailyApiBudget: 5000, fanoutN: 8, pathMaxDegrees: 6, indexRefresh: 'monthly' };

test('admin constellation fields, usage and its local Save preserve other section drafts', async ({ catalogPage: page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/settings/constellation', route => {
    if (route.request().method() === 'GET') return route.fallback();
    const changes = route.request().postDataJSON(); writes.push(changes);
    return route.fulfill({ json: { success: true, settings: { ...defaults, ...changes } } });
  });
  await page.goto('/settings');
  const section = page.getByRole('region', { name: 'Constellation settings' });
  await expect(section.getByLabel('Local credit index')).not.toBeChecked(); await expect(section.getByLabel('Index path')).toHaveValue(defaults.constellationIndexPath);
  await expect(section.getByLabel('Orbit edge budget')).toHaveValue('250000'); await expect(section.getByLabel('Daily API budget')).toHaveValue('5000');
  await expect(section.getByLabel('Fan-out')).toHaveValue('8'); await expect(section.getByLabel('Path max degrees')).toHaveValue('6'); await expect(section.getByLabel('Index refresh preference')).toHaveValue('monthly');
  await expect(section.getByText('17 / 5000')).toBeVisible(); await expect(section.getByText('00:00 UTC')).toBeVisible();
  await expect(section.getByText(/Automatic index refresh is unavailable/)).toBeVisible();
  await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('9'); await section.getByLabel('Daily API budget').fill('2000');
  await section.getByRole('button', { name: 'Save constellation settings' }).click(); await expect(section.getByText('Constellation settings saved', { exact: true })).toBeVisible();
  expect(writes).toEqual([{ dailyApiBudget: 2000 }]); await expect(page.getByText('Unsaved personal settings changes')).toBeVisible();
});

test('invalid budget is focused before any save request', async ({ catalogPage: page }) => {
  let writes = 0;
  await page.route('**/api/settings/constellation', route => { if (route.request().method() !== 'GET') writes++; return route.fallback(); });
  await page.goto('/settings'); await page.getByLabel('Orbit edge budget').fill('0'); await page.getByLabel('Daily API budget').fill('-1');
  await page.getByRole('button', { name: 'Save constellation settings' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Orbit edge budget must be a positive integer.' })).toBeVisible(); await expect(page.getByLabel('Orbit edge budget')).toBeFocused(); expect(writes).toBe(0);
});

test('a failed save and usage read retain the constellation draft and never show fake usage', async ({ catalogPage: page }) => {
  let writes = 0;
  await page.route('**/api/settings/constellation/usage', route => route.fulfill({ json: {} }));
  await page.route('**/api/settings/constellation', route => {
    if (route.request().method() === 'GET') return route.fallback();
    writes++; return route.fulfill({ status: 400, json: { error: 'Validation failed: fanoutN' } });
  });
  await page.goto('/settings'); const section = page.getByRole('region', { name: 'Constellation settings' });
  await expect(section.getByRole('alert')).toHaveText('Failed to load constellation usage: invalid response.'); await expect(section.getByText('0 / 5000')).toHaveCount(0);
  await section.getByLabel('Fan-out').fill('3'); await section.getByRole('button', { name: 'Save constellation settings' }).click();
  await expect(section.getByRole('alert').filter({ hasText: 'Validation failed: fanoutN' })).toBeVisible(); await expect(section.getByLabel('Fan-out')).toHaveValue('3');
  await expect(section.getByText('Constellation settings saved', { exact: true })).toHaveCount(0); expect(writes).toBe(1);
  await section.getByRole('button', { name: 'Save constellation settings' }).click(); await expect.poll(() => writes).toBe(2);
});

test('a constellation-only draft participates in the real settings navigation guard', async ({ catalogPage: page }) => {
  await page.goto('/settings'); await page.getByLabel('Fan-out').fill('3');
  const dialogs: string[] = [];
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  await page.locator('aside').getByRole('link', { name: 'Search', exact: true }).click();
  await expect.poll(() => dialogs).toEqual(['beforeunload']); await expect(page).toHaveURL(/\/settings$/); await expect(page.getByLabel('Fan-out')).toHaveValue('3');
});

test.describe('regular actor', () => {
  test.use({ catalogRole: 'user' });
  test('actual settings mount does not request either constellation admin endpoint', async ({ catalogPage: page }) => {
    const reads: string[] = []; page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/settings/constellation')) reads.push(request.url()); });
    await page.goto('/settings'); await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('region', { name: 'Constellation settings' })).toHaveCount(0); expect(reads).toEqual([]);
  });
});
