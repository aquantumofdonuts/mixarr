import { mkdir } from 'node:fs/promises';
import { test, expect, CATALOG_USER } from './catalog-fixtures';
import { waitForTheme } from './fixtures';

const evidence = process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence/t27';
const timestamp = '2026-10-09T12:00:00Z';

async function systemFixtures(page: import('@playwright/test').Page, failed = false) {
  await page.route('**/api/jobs/recent/**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Job service unavailable' } : { jobs: [{ id: 'job-123', state: 'failed', data: { subscriptionName: 'Weekly discoveries' }, timestamp: 1791547200000, failedReason: 'Source connection unavailable' }] } }));
  await page.route('**/api/logs?**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Log service unavailable' } : { logs: [{ id: 12, level: 'warn', category: 'subscription', message: 'Connection needs attention', metadata: { connectionId: 3 }, createdAt: timestamp }], total: 1, hasMore: false } }));
  await page.route('**/api/admin/users', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'User service unavailable' } : { users: [{ ...CATALOG_USER, isActive: true, lastLogin: timestamp, createdAt: timestamp }, { id: 8, username: 'listener', displayName: 'Listener', role: 'user', isActive: false, lastLogin: null, createdAt: timestamp }] } }));
  await page.route('**/api/imports/preview/lastfm/3?**', route => route.fulfill({ status: failed ? 503 : 200, json: failed ? { error: 'Preview source unavailable' } : { connection: { id: 3, name: 'Listening history' }, artists: [{ name: 'Catalog Artist', listeners: '12000' }], similarArtists: [{ name: 'Related Artist' }], aiRecommendations: [{ name: 'Suggested Artist', source: 'lastfm', strategy: 'similarity' }], total: 1, filtered: 0 } }));
}

for (const theme of ['light', 'dark'] as const) {
  test(`remaining system routes in ${theme}`, async ({ catalogPage: page }) => {
    await systemFixtures(page);
    await mkdir(evidence, { recursive: true });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    for (const [path, heading, name] of [['/jobs', 'Jobs', 'jobs'], ['/logs', 'Logs', 'logs'], ['/users', 'User Management', 'users'], ['/users/me', 'My Profile', 'profile'], ['/preview?connectionId=3&type=lastfm', 'Preview Last.fm Artists', 'preview']] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
      await waitForTheme(page, theme);
      await expect.poll(() => page.getByRole('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (name === 'jobs') await expect(page.getByText('Weekly discoveries', { exact: true })).toBeVisible();
      if (name === 'logs') await expect(page.getByText('Connection needs attention', { exact: true })).toBeVisible();
      if (name === 'users') await expect(page.getByText('Listener', { exact: true })).toBeVisible();
      if (name === 'preview') await expect(page.getByText('Catalog Artist', { exact: true })).toBeVisible();
      await page.screenshot({ path: `${evidence}/${name}-${theme}.png` });
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`remaining system routes at 320px in ${theme}`, async ({ catalogPage: page }) => {
    await systemFixtures(page);
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    for (const [path, content, name] of [['/jobs', 'Weekly discoveries', 'jobs'], ['/logs', 'Connection needs attention', 'logs'], ['/users', 'Listener', 'users'], ['/users/me', 'Profile Information', 'profile'], ['/preview?connectionId=3&type=lastfm', 'Catalog Artist', 'preview']] as const) {
      await page.goto(path);
      await expect(page.getByText(content, { exact: true })).toBeVisible();
      await waitForTheme(page, theme);
      await expect.poll(() => page.getByRole('main').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `${evidence}/${name}-${theme}-320.png` });
    }
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`schema-valid account names fit the main scroll container in ${theme}`, async ({ catalogPage: page }) => {
    const username = 'a'.repeat(50);
    const displayName = 'b'.repeat(100);
    await mkdir(evidence, { recursive: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { ...CATALOG_USER, username, displayName }, setupRequired: false } }));
    await page.route('**/api/admin/users', route => route.fulfill({ json: { users: [] } }));
    const measurements = [];
    for (const path of ['/users', '/users/me']) {
      await page.goto(path);
      const main = page.getByRole('main');
      await expect(main.getByText(username, { exact: true })).toBeVisible();
      await expect(main.getByText(displayName, { exact: true })).toBeVisible();
      await waitForTheme(page, theme);
      measurements.push({ path, ...await main.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth })) });
      await page.screenshot({ path: `${evidence}/long-account-${path.replaceAll('/', '-')}-${theme}.png` });
    }
    for (const result of measurements) expect(result.content, result.path).toBeLessThanOrEqual(result.width);
  });
}

test('system failures offer recovery instead of an empty collection', async ({ catalogPage: page }) => {
  test.setTimeout(60000);
  for (const path of ['/jobs', '/logs', '/users', '/preview?connectionId=3&type=lastfm']) {
    await systemFixtures(page, true);
    await page.goto(path);
    await expect(page.getByRole('alert', { name: 'Results unavailable' })).toBeVisible({ timeout: 15000 });
    await systemFixtures(page);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('alert', { name: 'Results unavailable' })).toHaveCount(0);
  }
});

test('preview refresh failure disables hidden selections until recovery', async ({ catalogPage: page }) => {
  await systemFixtures(page);
  await page.goto('/preview?connectionId=3&type=lastfm');
  await expect(page.getByRole('button', { name: 'Import 1 Artist', exact: true })).toBeEnabled();
  await page.route('**/api/imports/preview/lastfm/3?**', route => route.fulfill({ status: 503, json: { error: 'Preview source unavailable' } }));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('alert', { name: 'Results unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import / })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Catalog Artist', exact: true })).toHaveCount(0);
  await systemFixtures(page);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Select Catalog Artist', exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Import 1 Artist', exact: true })).toBeEnabled();
});

test('valid empty collections stay distinct from failures and filtered no matches', async ({ catalogPage: page }) => {
  await systemFixtures(page);
  await page.route('**/api/jobs/recent/**', route => route.fulfill({ json: { jobs: [] } }));
  await page.route('**/api/logs?**', route => route.fulfill({ json: { logs: [], total: 0, hasMore: false } }));
  await page.route('**/api/admin/users', route => route.fulfill({ json: { users: [] } }));
  await page.route('**/api/imports/preview/lastfm/3?**', route => route.fulfill({ json: { connection: { id: 3, name: 'Listening history' }, artists: [], similarArtists: [], aiRecommendations: [], total: 0, filtered: 0 } }));
  for (const path of ['/jobs', '/logs', '/users', '/preview?connectionId=3&type=lastfm']) {
    await page.goto(path);
    await expect(page.getByRole('status', { name: 'No records yet' })).toBeVisible();
    await expect(page.getByRole('alert', { name: 'Results unavailable' })).toHaveCount(0);
  }
  await expect(page.getByText('All artists are already in your Lidarr library!', { exact: true })).toHaveCount(0);
  await page.goto('/logs');
  await page.getByLabel('Level', { exact: true }).selectOption('warn');
  await expect(page.getByRole('status', { name: 'No matches', exact: true })).toBeVisible();
});

test('log details and preview selection support the keyboard', async ({ catalogPage: page }) => {
  await systemFixtures(page);
  await page.goto('/logs');
  const details = page.locator('summary').filter({ hasText: 'Connection needs attention' });
  await details.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('"connectionId": 3', { exact: false })).toBeVisible();
  await page.goto('/preview?connectionId=3&type=lastfm');
  const artist = page.getByRole('checkbox', { name: 'Select Catalog Artist', exact: true });
  await expect(artist).toBeChecked();
  await artist.focus();
  await page.keyboard.press('Space');
  await expect(artist).not.toBeChecked();
});

test('account forms expose associated labels', async ({ catalogPage: page }) => {
  await systemFixtures(page);
  await page.goto('/users');
  await page.getByRole('button', { name: 'Add User', exact: true }).click();
  await expect(page.getByLabel('Username *', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Role', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: `Edit user ${CATALOG_USER.username}`, exact: true }).click();
  await expect(page.getByLabel('Role', { exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Active', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Inactive', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.goto('/users/me');
  await page.getByRole('button', { name: 'Change Password', exact: true }).click();
  await expect(page.getByLabel('Current Password', { exact: true })).toBeVisible();
});

test.describe('member permission visibility', () => {
  test.use({ catalogRole: 'user' });
  test('does not fetch or offer administrative user controls', async ({ catalogPage: page }) => {
    let adminCalls = 0;
    await page.route('**/api/admin/users', route => { adminCalls++; return route.fulfill({ json: { users: [] } }); });
    await page.goto('/users');
    await expect(page.getByRole('heading', { name: 'Your Account', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add User', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'All Users', exact: true })).toHaveCount(0);
    expect(adminCalls).toBe(0);
  });
});

test.describe('public routes', () => {
  test.use({ catalogAuthenticated: false, viewport: { width: 320, height: 844 } });
  for (const theme of ['light', 'dark'] as const) {
    test(`login and setup in ${theme}`, async ({ catalogPage: page }) => {
      await mkdir(evidence, { recursive: true });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in to Mixarr', exact: true, level: 1 })).toBeVisible();
      await waitForTheme(page, theme);
      await page.getByRole('button', { name: 'Show password', exact: true }).click();
      await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
      await page.screenshot({ path: `${evidence}/login-${theme}.png` });
      await page.route('**/api/auth/setup-required', route => route.fulfill({ json: { setupRequired: true, adminExists: false, baseUrlExists: false } }));
      await page.goto('/setup');
      await expect(page.getByRole('heading', { name: 'Set up Mixarr', exact: true, level: 1 })).toBeVisible();
      await page.screenshot({ path: `${evidence}/setup-${theme}.png` });
      await page.getByRole('button', { name: 'Get Started', exact: true }).click();
      await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Confirm Password', { exact: true })).toBeVisible();
    });
  }
  for (const theme of ['light', 'dark'] as const) {
    test(`enabled Google sign-in renders and supports keyboard handoff in ${theme}`, async ({ catalogPage: page }) => {
      await mkdir(evidence, { recursive: true });
      await page.addInitScript(value => localStorage.setItem('theme', value), theme);
      await page.route('**/api/auth/sso/enabled', route => route.fulfill({ json: { providers: [{ type: 'google', name: 'Google' }] } }));
      let handoffs = 0;
      await page.route('**/api/auth/sso/google', route => {
        expect(route.request().method()).toBe('GET');
        handoffs++;
        return route.fulfill({ contentType: 'text/html', body: '<h1>Google sign-in handoff</h1>' });
      });
      await page.goto('/login');
      await waitForTheme(page, theme);
      const google = page.getByRole('button', { name: 'Login with Google', exact: true });
      await expect(google).toBeVisible();
      await expect(google.locator('svg')).toBeVisible();
      await page.screenshot({ path: `${evidence}/login-google-${theme}.png` });
      await google.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/api\/auth\/sso\/google$/);
      await expect(page.getByRole('heading', { name: 'Google sign-in handoff', exact: true })).toBeVisible();
      expect(handoffs).toBe(1);
    });
  }

  test('resumes at application URL and preserves prerequisite guidance', async ({ catalogPage: page }) => {
    await page.route('**/api/auth/setup-required', route => route.fulfill({ json: { setupRequired: true, adminExists: true, baseUrlExists: false } }));
    await page.goto('/setup');
    await expect(page.getByRole('heading', { name: 'Application URL', exact: true, level: 1 })).toBeVisible();
    await expect(page.getByLabel('Base URL', { exact: true })).toBeVisible();
    await expect(page.getByText('Spotify integration requires HTTPS.', { exact: false })).toBeVisible();
  });
  test('setup submits with Enter and retains recovery on URL and completion failure', async ({ catalogPage: page }) => {
    let created = false;
    let urlAttempts = 0;
    let completionAttempts = 0;
    await page.route('**/api/auth/setup-required', route => route.fulfill({ json: { setupRequired: true, adminExists: created, baseUrlExists: false } }));
    await page.route('**/api/auth/me', route => route.fulfill({ json: { user: created ? CATALOG_USER : null, setupRequired: true } }));
    await page.route('**/api/auth/setup', route => {
      expect(route.request().postDataJSON()).toEqual({ username: 'administrator', password: 'catalog-password', displayName: 'administrator' });
      created = true;
      return route.fulfill({ json: { success: true } });
    });
    await page.route('**/api/settings/base-url', route => {
      expect(route.request().postDataJSON()).toEqual({ baseUrl: 'https://catalog.example.test' });
      urlAttempts++;
      return route.fulfill({ status: urlAttempts === 1 ? 503 : 200, json: urlAttempts === 1 ? { error: 'Could not save application URL' } : { success: true } });
    });
    await page.route('**/api/auth/complete-setup', route => {
      completionAttempts++;
      return route.fulfill({ status: completionAttempts === 1 ? 503 : 200, json: completionAttempts === 1 ? { error: 'Could not complete setup' } : { success: true } });
    });
    await page.goto('/setup');
    await page.getByRole('button', { name: 'Get Started', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('administrator');
    await page.getByLabel('Password', { exact: true }).fill('catalog-password');
    await page.getByLabel('Confirm Password', { exact: true }).fill('catalog-password');
    await page.getByLabel('Confirm Password', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Application URL', exact: true })).toBeVisible();
    await page.getByLabel('Base URL', { exact: true }).fill('https://catalog.example.test');
    await page.getByLabel('Base URL', { exact: true }).press('Enter');
    await expect(page.getByRole('alert').filter({ hasText: 'Could not save application URL' })).toHaveText('Could not save application URL');
    await expect(page.getByLabel('Base URL', { exact: true })).toHaveValue('https://catalog.example.test');
    await page.getByLabel('Base URL', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Setup complete', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Continue to Connections', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Could not complete setup' })).toHaveText('Could not complete setup');
    await page.getByRole('button', { name: 'Continue to Connections', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connections', exact: true, level: 1 })).toBeVisible();
    expect(urlAttempts).toBe(2);
    expect(completionAttempts).toBe(2);
  });

});
