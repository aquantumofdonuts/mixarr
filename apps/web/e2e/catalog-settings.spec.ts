import { test, expect } from './catalog-fixtures';
import type { Page } from '@playwright/test';

async function settingsNavigation(page: Page, name: 'Settings' | 'Search') {
  const menu = page.getByRole('button', { name: 'Open menu', exact: true });
  const account = page.getByRole('button', { name: 'Account menu', exact: true });
  await expect.poll(async () => await menu.isVisible() || await account.isVisible()).toBe(true);
  if (await menu.isVisible()) {
    await menu.click();
    const drawer = page.getByRole('dialog', { name: 'Mixarr navigation', exact: true });
    await expect(drawer).toBeVisible();
    await drawer.getByRole('link', { name, exact: true }).last().click();
  } else {
    if (name === 'Settings') await account.click();
    await page.locator('aside').getByRole('link', { name, exact: true }).last().click();
  }
}

async function settingsApi(page: Page) {
  const writes: { path: string; body: Record<string, any> }[] = [];
  let failPersonal = false;
  const personal = { defaultResultHandling: 'preview', maxConcurrentJobs: 4, notifyOnComplete: true, notifyOnError: true };
  const global = { baseUrl: 'https://mixarr.example' };
  const ai = { openaiEnabled: true, openaiConfigured: true, openaiApiKey: 'fixture-secret', openaiBaseUrl: '', openaiModel: 'old-model', anthropicEnabled: false, anthropicConfigured: false };
  const providers = [{ id: 1, type: 'google', name: 'Google', isEnabled: false, config: { clientId: 'fixture.apps.googleusercontent.com', clientSecret: '********' } }, { id: 2, type: 'oidc', name: 'OpenID Connect', isEnabled: false, config: { issuerUrl: 'https://issuer.example', clientId: 'fixture-client', clientSecret: '********' } }];
  await page.route(/\/api\/(settings(?:\/global|\/base-url)?|ai\/settings|sso\/providers(?:\/[^/]+)?|notifications\/(?:channels|events))$/, async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === 'GET') {
      const json = path === '/api/settings' ? { settings: personal } : path === '/api/settings/global' ? { settings: global } : path === '/api/settings/base-url' ? { baseUrl: global.baseUrl } : path === '/api/ai/settings' ? { settings: ai } : path === '/api/sso/providers' ? { providers } : path === '/api/notifications/events' ? ['job.completed'] : [];
      return route.fulfill({ json });
    }
    const body = req.postDataJSON(); writes.push({ path, body });
    if (path === '/api/settings' && failPersonal) return route.fulfill({ status: 503, json: { error: 'Personal settings unavailable' } });
    if (path === '/api/settings') Object.assign(personal, body.settings);
    if (path === '/api/settings/global') Object.assign(global, body.settings);
    if (path === '/api/ai/settings') Object.assign(ai, body);
    if (path.startsWith('/api/sso/providers/')) return route.fulfill({ json: { provider: { id: path.endsWith('/google') ? 1 : 2, type: path.split('/').at(-1), ...body } } });
    return route.fulfill({ json: { success: true } });
  });
  return { writes, fail: (value: boolean) => { failPersonal = value; } };
}

test('personal, global, AI and provider local saves do not persist another section', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); await page.goto('/settings');
  await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('5'); await page.getByLabel('Base URL', { exact: true }).fill('https://new.example');
  await page.getByLabel('Model (Optional)').fill('new-model');
  await page.getByRole('button', { name: 'Configure Google', exact: true }).click(); await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('changed.apps.googleusercontent.com');
  await page.getByRole('button', { name: 'Save personal settings', exact: true }).click(); await expect(page.getByText('Personal settings saved', { exact: true }).first()).toBeVisible();
  expect(api.writes.map(write => write.path)).toEqual(['/api/settings']);
  await expect(page.getByText('Unsaved global settings changes')).toBeVisible(); await expect(page.getByText('Unsaved AI settings changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save Global Settings', exact: true }).click(); await page.getByRole('button', { name: 'Save AI settings', exact: true }).click();
  await page.getByRole('button', { name: 'Save Google settings', exact: true }).click();
  await expect.poll(() => api.writes.length).toBe(4);
  expect(api.writes[2].body).toEqual({ openaiModel: 'new-model' }); expect(api.writes[3].body.config.clientSecret).toBe('********');
  expect(api.writes.map(write => write.path)).toEqual(['/api/settings', '/api/settings/global', '/api/ai/settings', '/api/sso/providers/google']);
});

test('failed saves retain drafts and restore defaults requires an explicit personal save', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); api.fail(true); await page.goto('/settings');
  await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('7'); await page.getByRole('button', { name: 'Save personal settings', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Personal settings unavailable' })).toBeVisible(); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('7');
  await page.getByRole('button', { name: 'Restore personal defaults' }).click(); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('3'); expect(api.writes.length).toBe(1);
  api.fail(false); await page.getByRole('button', { name: 'Save personal settings', exact: true }).click(); await expect.poll(() => api.writes.length).toBe(2);
  await expect(page.getByRole('button', { name: 'Save personal settings', exact: true })).toBeDisabled();
});

test('native entry and browser Back prompt protect drafts; cancel retains edits', async ({ catalogPage: page }) => {
  await settingsApi(page); await page.goto('/');
  await settingsNavigation(page, 'Settings');
  await expect(page).toHaveURL(/\/settings$/); await page.getByLabel('Max Concurrent Jobs', { exact: true }).click(); await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('8'); await expect(page.getByText('Unsaved personal settings changes')).toBeVisible();
  const dialogs: string[] = []; page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.dismiss(); });
  void page.goBack().catch(() => {}); await expect.poll(() => dialogs).toEqual(['beforeunload']); await expect(page).toHaveURL(/\/settings$/); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('8');
  expect(dialogs).toEqual(['beforeunload']);
  await settingsNavigation(page, 'Search'); await expect(page).toHaveURL(/\/settings$/); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('8'); expect(dialogs).toEqual(['beforeunload', 'beforeunload']);
  void page.evaluate(() => window.location.reload()).catch(() => {}); await expect.poll(() => dialogs.length).toBe(3); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('8'); expect(dialogs.at(-1)).toBe('beforeunload');
});

test('notification modal cancel and invalid JSON retain drafts and focus the invalid input', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); await page.goto('/settings/notifications'); await page.getByRole('button', { name: 'Add Channel', exact: true }).click();
  await page.getByLabel('Channel Type').selectOption('webhook'); await page.getByLabel('URL', { exact: true }).fill('https://hook.example'); await page.getByLabel('Headers (JSON, optional)').fill('{');
  await page.getByRole('button', { name: 'Create Channel', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Headers must be a JSON object with string values.' })).toBeVisible(); await expect(page.getByLabel('Headers (JSON, optional)')).toBeFocused(); expect(api.writes).toHaveLength(0);
  page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Add Notification Channel' })).toBeVisible(); await expect(page.getByLabel('Headers (JSON, optional)')).toHaveValue('{');
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('provider enabled state stays a draft and saving another provider preserves hidden edits', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); await page.goto('/settings');
  await page.getByRole('button', { name: 'Configure Google', exact: true }).click();
  await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('unsaved.apps.googleusercontent.com');
  await page.getByRole('switch', { name: 'Enable Google', exact: true }).click(); expect(api.writes).toHaveLength(0); await expect(page.getByRole('region', { name: 'Google settings', exact: true }).getByText('Disabled', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Configure OIDC', exact: true }).click();
  await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('changed-oidc');
  await page.getByRole('button', { name: 'Save OIDC settings', exact: true }).click(); await expect.poll(() => api.writes.length).toBe(1);
  expect(api.writes[0].path).toBe('/api/sso/providers/oidc');
  await page.getByRole('button', { name: 'Configure Google', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Client ID', exact: true })).toHaveValue('unsaved.apps.googleusercontent.com'); await expect(page.getByRole('switch', { name: 'Enable Google', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Save Google settings', exact: true }).click(); await expect.poll(() => api.writes.length).toBe(2); expect(api.writes[1].body.isEnabled).toBe(true); await expect(page.getByRole('region', { name: 'Google settings', exact: true }).getByText('Enabled', { exact: true })).toBeVisible();
});

test('editing during an AI save retains the new draft against the submitted snapshot', async ({ catalogPage: page }) => {
  await settingsApi(page);
  let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/settings', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    await pending; await route.fulfill({ json: { success: true } });
  });
  await page.goto('/settings'); await page.getByLabel('Model (Optional)').fill('submitted-model'); await page.getByRole('button', { name: 'Save AI settings', exact: true }).click();
  await expect(page.getByText('Saving AI settings…')).toBeVisible(); await page.getByLabel('Model (Optional)').fill('later-draft'); release();
  await expect(page.getByText('Unsaved AI settings changes')).toBeVisible(); await expect(page.getByLabel('Model (Optional)')).toHaveValue('later-draft'); await expect(page.getByRole('button', { name: 'Save AI settings', exact: true })).toBeEnabled();
});

test('mobile native settings entry and canceled logout protect the same draft', async ({ catalogPage: page }) => {
  await settingsApi(page); let logouts = 0; page.on('request', request => { if (new URL(request.url()).pathname === '/api/auth/logout') logouts++; }); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'Open menu' }).click(); await page.getByRole('dialog').getByRole('link', { name: 'Settings', exact: true }).last().click();
  await expect(page).toHaveURL(/\/settings$/); await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('9');
  await page.getByRole('button', { name: 'Open menu' }).click(); page.once('dialog', dialog => dialog.dismiss()); await page.getByRole('button', { name: 'Logout', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Mixarr navigation' })).toBeVisible(); await page.getByRole('button', { name: 'Close', exact: true }).click(); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toHaveValue('9'); expect(logouts).toBe(0);
});

test('invalid personal, global and provider fields focus their labels before any save request', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); await page.goto('/settings');
  await page.getByLabel('Max Concurrent Jobs', { exact: true }).fill('0'); await page.getByRole('button', { name: 'Save personal settings', exact: true }).click(); await expect(page.getByLabel('Max Concurrent Jobs', { exact: true })).toBeFocused();
  await page.getByLabel('Base URL', { exact: true }).fill('invalid'); await page.getByRole('button', { name: 'Save Global Settings', exact: true }).click(); await expect(page.getByLabel('Base URL', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Configure Google', exact: true }).click(); await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill(''); await page.getByRole('button', { name: 'Save Google settings', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Client ID', exact: true })).toBeFocused(); expect(api.writes).toHaveLength(0);
});

test.describe('non-admin settings access', () => {
  test.use({ catalogRole: 'user' });
  test('redirects without requesting admin setting scopes', async ({ catalogPage: page }) => {
    const api = await settingsApi(page); const reads: string[] = [];
    page.on('request', request => { const path = new URL(request.url()).pathname; if (/^\/api\/(settings\/global|ai\/settings|sso\/providers)$/.test(path)) reads.push(path); });
    await page.goto('/settings'); await expect(page).toHaveURL(/\/$/); expect(reads).toEqual([]); expect(api.writes).toEqual([]);
  });
});

for (const kind of ['missing', 'malformed'] as const) {
  test(`${kind} settings read responses show load failures and never claim saved baselines`, async ({ catalogPage: page }) => {
    const api = await settingsApi(page);
    await page.route(/\/api\/(?:settings(?:\/global)?|ai\/settings)$/, async route => {
      if (route.request().method() !== 'GET') return route.fallback();
      return kind === 'missing' ? route.fulfill({ status: 204 }) : route.fulfill({ json: { settings: [] } });
    });
    await page.goto('/settings');
    for (const [scope, saved, save] of [['personal', 'Personal settings saved', 'Save personal settings'], ['global', 'Global settings saved', 'Save Global Settings'], ['AI', 'AI settings saved', 'Save AI settings']]) {
      await expect(page.getByRole('alert').filter({ hasText: `Failed to load ${scope} settings: invalid response.` })).toBeVisible();
      await expect(page.getByText(saved, { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: save, exact: true })).toBeDisabled();
    }
    expect(api.writes).toEqual([]);
  });
}

test('SSO missing and malformed reads fail visibly; retrying a valid empty list establishes a new provider draft', async ({ catalogPage: page }) => {
  await settingsApi(page); let response: 'missing' | 'malformed' | 'empty' = 'missing';
  await page.route('**/api/sso/providers', route => response === 'missing' ? route.fulfill({ status: 204 }) : route.fulfill({ json: response === 'malformed' ? {} : { providers: [] } }));
  await page.goto('/settings');
  await expect(page.getByRole('alert').filter({ hasText: 'Failed to load SSO providers: invalid response.' })).toBeVisible();
  await page.getByRole('heading', { name: 'Google', exact: true }).click(); await expect(page.getByText('Provider settings saved', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save Google settings', exact: true })).toBeDisabled();
  response = 'malformed'; await page.getByRole('button', { name: 'Retry loading SSO providers' }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Failed to load SSO providers: invalid response.' })).toBeVisible();
  response = 'empty'; await page.getByRole('button', { name: 'Retry loading SSO providers' }).click(); await expect(page.getByText('No saved provider configuration', { exact: true })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Client ID', exact: true })).toHaveValue('');
});

test('a malformed SSO save retains the draft and allows an explicit retry', async ({ catalogPage: page }) => {
  const api = await settingsApi(page); let malformed = true;
  await page.route('**/api/sso/providers/google', route => route.request().method() === 'PUT' && malformed ? route.fulfill({ json: {} }) : route.fallback());
  await page.goto('/settings'); await page.getByRole('button', { name: 'Configure Google', exact: true }).click(); await page.getByRole('textbox', { name: 'Client ID', exact: true }).fill('draft.apps.googleusercontent.com'); await page.getByRole('button', { name: 'Save Google settings', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Invalid save response; retry or reload to confirm Google settings.' })).toBeVisible(); await expect(page.getByRole('textbox', { name: 'Client ID', exact: true })).toHaveValue('draft.apps.googleusercontent.com'); await expect(page.getByRole('button', { name: 'Save Google settings', exact: true })).toBeEnabled();
  malformed = false; await page.getByRole('button', { name: 'Save Google settings', exact: true }).click(); await expect(page.getByRole('region', { name: 'Google settings', exact: true }).getByText('Provider settings saved', { exact: true })).toBeVisible(); expect(api.writes).toHaveLength(1);
});

test('notification missing channels and malformed events require explicit valid reads before opening an editor', async ({ catalogPage: page }) => {
  await settingsApi(page); let validChannels = false, validEvents = false;
  await page.route('**/api/notifications/channels', route => validChannels ? route.fallback() : route.fulfill({ status: 204 }));
  await page.route('**/api/notifications/events', route => validEvents ? route.fallback() : route.fulfill({ json: {} }));
  await page.goto('/settings/notifications'); await expect(page.getByRole('alert').filter({ hasText: 'Failed to load channels: invalid response.' })).toBeVisible(); await expect(page.getByRole('alert').filter({ hasText: 'Failed to load events: invalid response.' })).toBeVisible(); await expect(page.getByText('No Notification Channels', { exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Add Channel', exact: true })).toBeDisabled();
  validChannels = true; validEvents = true; await page.getByRole('button', { name: 'Retry loading channels' }).click(); await page.getByRole('button', { name: 'Retry loading events' }).click(); await expect(page.getByRole('button', { name: 'Add Channel', exact: true })).toBeEnabled(); await page.getByRole('button', { name: 'Add Channel', exact: true }).click(); await expect(page.getByText('Channel draft unchanged', { exact: true })).toBeVisible();
});

test('native pending-create controls lock and a failed edit retry retains one created channel', async ({ catalogPage: page }) => {
  await settingsApi(page); let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
  let saved: Record<string, any> | null = null, failEdit = true;
  const writes: { method: string; body: Record<string, any> }[] = [];
  await page.route(/\/api\/notifications\/channels(?:\/101)?$/, async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: saved ? [{ ...saved, config: { ...saved.config, headers: '••••••••' } }] : [] });
    const body = request.postDataJSON(); writes.push({ method: request.method(), body });
    if (request.method() === 'POST') { await pending; saved = { id: 101, ...body, createdAt: '2026-10-09T00:00:00Z' }; return route.fulfill({ status: 201, json: saved }); }
    if (failEdit) return route.fulfill({ status: 503, json: { error: 'Channel temporarily unavailable' } });
    saved = { ...saved, ...body }; return route.fulfill({ json: saved });
  });
  await page.goto('/settings/notifications'); await page.getByRole('button', { name: 'Add Channel', exact: true }).click(); await page.getByLabel('Channel Type').selectOption('webhook');
  await page.getByLabel('Name', { exact: true }).fill('New channel'); await page.getByLabel('URL', { exact: true }).fill('https://hook.example'); await page.getByLabel('Headers (JSON, optional)').fill('{"X-Fixture":"test"}'); await page.getByRole('checkbox', { name: 'job.completed', exact: true }).check();
  await page.getByRole('button', { name: 'Create Channel', exact: true }).click();
  try {
    await expect(page.getByText('Saving channel…', { exact: true })).toBeVisible(); await expect(page.getByLabel('Name', { exact: true })).toBeDisabled(); await expect(page.getByLabel('Channel Type')).toBeDisabled(); await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    expect(await page.getByRole('dialog').locator('input, select, textarea').evaluateAll(controls => controls.length > 0 && controls.every(control => control.matches(':disabled')))).toBe(true);
  } finally { release(); }
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'New channel', exact: true })).toBeVisible(); expect(writes.map(write => write.method)).toEqual(['POST']);
  await page.locator('.rounded-card').filter({ has: page.getByRole('heading', { name: 'New channel', exact: true }) }).getByRole('button').nth(1).click(); await page.getByLabel('Name', { exact: true }).fill('Retry rename'); await page.getByRole('button', { name: 'Save channel changes', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Channel temporarily unavailable' })).toBeVisible(); await expect(page.getByLabel('Name', { exact: true })).toBeEnabled(); await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Retry rename');
  failEdit = false; await page.getByRole('button', { name: 'Save channel changes', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('heading', { name: 'Retry rename', exact: true })).toBeVisible(); expect(writes.map(write => write.method)).toEqual(['POST', 'PUT', 'PUT']);
});

test('saved webhook header masks survive rename; replacement JSON is validated and invalid edits stay focused', async ({ catalogPage: page }) => {
  await settingsApi(page);
  const saved = { id: 101, type: 'webhook', name: 'Stored webhook', config: { url: 'https://hook.example', method: 'POST', headers: '••••••••' }, events: ['job.completed'], isActive: true, createdAt: '2026-10-09T00:00:00Z' };
  const writes: Record<string, any>[] = [];
  await page.route(/\/api\/notifications\/channels(?:\/101)?$/, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [saved] });
    writes.push(route.request().postDataJSON()); return route.fulfill({ json: saved });
  });
  await page.goto('/settings/notifications');
  const edit = () => page.locator('.rounded-card').filter({ has: page.getByRole('heading', { name: 'Stored webhook', exact: true }) }).getByRole('button').nth(1).click();
  await edit(); await expect(page.getByLabel('Headers (JSON, optional)')).toHaveValue('••••••••'); await page.getByLabel('Name', { exact: true }).fill('Renamed webhook'); await page.getByRole('button', { name: 'Save channel changes', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(1); expect(writes[0].config.headers).toBe('••••••••');
  await edit(); await page.getByLabel('Headers (JSON, optional)').fill('{"X-Fixture":"replacement"}'); await page.getByRole('button', { name: 'Save channel changes', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(writes[1].config.headers).toEqual({ 'X-Fixture': 'replacement' });
  await edit(); await page.getByLabel('Headers (JSON, optional)').fill('"arbitrary string"'); await page.getByRole('button', { name: 'Save channel changes', exact: true }).click(); await expect(page.getByRole('alert').filter({ hasText: 'Headers must be a JSON object with string values.' })).toBeVisible(); await expect(page.getByLabel('Headers (JSON, optional)')).toBeFocused(); expect(writes).toHaveLength(2);
});


test('Back at the first visible dirty commit prompts before leaving and retains the draft', async ({ catalogPage: page }) => {
  await settingsApi(page);
  await page.goto('/');
  await settingsNavigation(page, 'Settings');
  await expect(page).toHaveURL(/\/settings$/);
  const field = page.getByLabel('Max Concurrent Jobs', { exact: true });
  await field.click();
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      if (!document.body.innerText.includes('Unsaved personal settings changes')) return;
      observer.disconnect();
      history.back();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await field.fill('8');
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(field).toHaveValue('8');
  await expect(page.getByText('Unsaved personal settings changes', { exact: true })).toBeVisible();
});
