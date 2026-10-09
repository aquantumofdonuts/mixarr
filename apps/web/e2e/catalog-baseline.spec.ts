import { mkdir } from 'node:fs/promises';
import { test, expect, CATALOG_USER } from './catalog-fixtures';
import { waitForTheme } from './fixtures';

const evidence = process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence';
const routes = [
  ['/', 'Discovery'], ['/search', 'Search'], ['/subscriptions', 'Subscriptions'],
  ['/queue', 'Review Queue'], ['/connections', 'Connections'], ['/downloads', 'slskd Downloads'],
  ['/settings', 'Settings'], ['/constellation', 'Constellation'],
] as const;

for (const [path, heading] of routes) {
  test(`catalog baseline: ${heading}`, async ({ catalogPage: page }) => {
    await mkdir(evidence, { recursive: true });
    for (const theme of ['light', 'dark', 'system'] as const) {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
      await waitForTheme(page, theme === 'system' ? 'dark' : theme);
      if (path === '/') await expect(page.getByText('Common Name', { exact: true })).toHaveCount(2);
      if (path === '/queue') await expect(page.getByText('Queue Artist 001', { exact: true })).toBeVisible();
      await page.screenshot({ path: `${evidence}/${heading.toLowerCase().replaceAll(' ', '-')}-${theme}.png`, fullPage: false });
    }
  });
}

test('an artist action targets only the selected stable identity', async ({ catalogPage: page }) => {
  await page.goto('/search');
  await page.getByPlaceholder('Search for artist...').fill('Common Name');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('Common Name', { exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Add artist Common Name', exact: true }).first().click();
  await expect(page.getByText('Artist added', { exact: true })).toBeVisible();
  await expect(page.getByText('In Lidarr', { exact: true })).toHaveCount(1);
});

test.describe('member navigation', () => {
  test.use({ catalogRole: 'user', viewport: { width: 390, height: 844 } });
  test('mobile drawer shows only authorized destinations', async ({ catalogPage: page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('link', { name: 'Subscriptions', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Connections', exact: true })).toHaveCount(0);
  });
});

test.describe('username login', () => {
  test.use({ catalogAuthenticated: false });
  test('uses the real username auth shape', async ({ catalogPage: page }) => {
    await page.goto('/login');
    await page.getByLabel('Username', { exact: true }).fill(CATALOG_USER.username);
    await page.getByLabel('Password', { exact: true }).fill('catalog-fixture-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('heading', { name: 'Discovery', exact: true, level: 1 })).toBeVisible();
  });
});

// These fixtures verify visible outcome handling, not live provider behavior.
test.describe('unconfirmed feed acquisition', () => {
  test.use({ catalogScenario: 'add-failed' });
  test('retains the failed identity with Retry and never announces it as added', async ({ catalogPage: page }) => {
    await page.goto('/');
    const add = page.getByTestId('feed-grid').getByRole('button', { name: /^Add artist/ }).first();
    expect(await add.evaluate(button => {
      for (let element: Element | null = button; element; element = element.parentElement) {
        if (Number(getComputedStyle(element).opacity) === 0) return false;
      }
      return true;
    })).toBe(true);
    await add.click();
    await expect(page.getByText('Addition unconfirmed', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry Common Name', exact: true })).toBeVisible();
    await expect(page.getByText('Common Name', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Added to Lidarr', { exact: true })).toHaveCount(0);
  });
});
