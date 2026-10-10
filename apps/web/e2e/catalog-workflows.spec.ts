import { test, expect, ARTIST_IDS, keyboardActivate, expectCatalogFits } from './catalog-fixtures';

test('keyboard feed Add, Dismiss and Undo preserve original identities in both views', async ({ catalogPage: page }) => {
  const approvals: string[] = [];
  page.on('request', request => { if (/\/api\/feed\/.*\/approve$/.test(request.url())) approvals.push(new URL(request.url()).pathname); });
  await page.goto('/');
  const row = page.locator('article[data-feed-id="feed-1-2"]');
  await keyboardActivate(page, row.getByRole('button', { name: 'Add artist Common Name', exact: true }));
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await keyboardActivate(page, options.getByRole('button', { name: 'Confirm add', exact: true }));
  await expect(options).toHaveCount(0);
  await expect(row.getByRole('status')).toHaveText('Artist added to Lidarr');
  await expect(row.getByRole('button')).toHaveCount(0);
  expect(approvals).toEqual(['/api/feed/feed-1-2/approve']);
  const other = page.locator('article[data-feed-id="feed-3"]');
  await keyboardActivate(page, other.getByRole('button', { name: 'Dismiss Common Name', exact: true }));
  await expect(other).toHaveCount(0);
  await keyboardActivate(page, page.getByRole('button', { name: 'Undo', exact: true }).last());
  await expect(other).toBeVisible();
  // Remove the used decision so the next Undo cannot resolve to its stale toast.
  await keyboardActivate(page, page.getByRole('button', { name: 'Dismiss Dismissed', exact: true }));
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  const grid = page.getByRole('button', { name: 'Artwork', exact: true });
  await keyboardActivate(page, grid);
  await expect(other.getByRole('button', { name: 'Add artist Common Name', exact: true })).toBeVisible();
  await keyboardActivate(page, other.getByRole('button', { name: 'Dismiss Common Name', exact: true }));
  await expect(other).toHaveCount(0);
  await keyboardActivate(page, page.getByRole('button', { name: 'Undo', exact: true }));
  await expect(other).toBeVisible();
  await keyboardActivate(page, other.getByRole('button', { name: 'Add artist Common Name', exact: true }));
  await keyboardActivate(page, options.getByRole('button', { name: 'Confirm add', exact: true }));
  await expect(options).toHaveCount(0);
  await expect(other.getByRole('status')).toHaveText('Artist added to Lidarr');
  expect(approvals).toEqual(['/api/feed/feed-1-2/approve', '/api/feed/feed-3/approve']);
});

test('keyboard inspector keeps source and chronology accessible, traps focus and fixes footer outside scrolling body', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/');
  const trigger = page.locator('article[data-feed-id="feed-1-2"]').getByRole('link', { name: 'Common Name', exact: true });
  await keyboardActivate(page, trigger);
  const dialog = page.getByRole('dialog', { name: 'Common Name', exact: true });
  const source = dialog.getByRole('link', { name: 'Run 71', exact: true });
  await expect(source).toHaveAttribute('href', '/subscriptions/11?tab=runs&run=71');
  await keyboardActivate(page, source);
  await expect(page).toHaveURL('/subscriptions/11?tab=runs&run=71');
  await expect(page.locator('details[data-run="71"]')).toHaveAttribute('open', '');
  await page.goBack();
  await expect(dialog).toBeVisible();
  // Native source navigation replaced the document; reopen from a live trigger for focus return.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL('/');
  await keyboardActivate(page, trigger);
  await expect(dialog).toBeVisible();
  const chronology = dialog.getByRole('region', { name: 'Release chronology' });
  await expect(chronology.getByRole('link').first()).toHaveText('Catalog release 25');
  await keyboardActivate(page, dialog.getByRole('button', { name: 'Load more releases', exact: true }));
  await expect(chronology.getByRole('link').first()).toHaveText('Catalog release 26');
  const footer = dialog.getByRole('button', { name: 'Back to list', exact: true });
  expect(await footer.evaluate(element => element.closest('[data-modal-body]'))).toBeNull();
  await footer.scrollIntoViewIfNeeded();
  const bounds = (await footer.boundingBox())!;
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(700);
  const focusable = dialog.locator('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]');
  await focusable.last().focus();
  await page.keyboard.press('Tab');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(focusable.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('keyboard subscription run, schedule and original result run reference stay separate', async ({ catalogPage: page }) => {
  const actions: { path: string; body: unknown }[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/subscriptions/11' && request.method() === 'PATCH') actions.push({ path: '/api/subscriptions/11', body: request.postDataJSON() });
  });
  page.on('request', request => { if (request.url().endsWith('/jobs/run/subscription/11')) actions.push({ path: '/api/jobs/run/subscription/11', body: request.postData() }); });
  await page.goto('/subscriptions');
  await keyboardActivate(page, page.getByRole('button', { name: 'Run now', exact: true }));
  await expect.poll(() => actions.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Pause schedule', exact: true })).toBeEnabled();
  await keyboardActivate(page, page.getByRole('button', { name: 'Pause schedule', exact: true }));
  await expect.poll(() => actions.length).toBe(2);
  expect(actions[0].path).toBe('/api/jobs/run/subscription/11');
  expect(actions[1].body).toEqual({ isActive: false });
  await expect(page.getByRole('button', { name: 'Resume schedule', exact: true })).toBeVisible();
  await keyboardActivate(page, page.getByRole('link', { name: 'View results', exact: true }));
  const result = page.getByRole('article', { name: 'Result 102', exact: true });
  await keyboardActivate(page, result.getByRole('link', { name: 'Run 71', exact: true }));
  await expect(page).toHaveURL('/subscriptions/11?tab=runs&run=71');
  await expect(page.locator('details[data-run="71"]')).toHaveAttribute('open', '');
  await keyboardActivate(page, page.locator('details[data-run="72"] summary'));
  await expect(page.getByText('This run has no results', { exact: true })).toBeVisible();
});

test('keyboard search chooses same-name identity and bulk action respects native checked state', async ({ catalogPage: page }) => {
  const additions: string[] = [];
  page.on('request', request => { if (request.url().endsWith('/search/artists/add')) additions.push(request.postDataJSON().foreignArtistId); });
  await page.route('**/api/search/discover/add', route => {
    additions.push(route.request().postDataJSON().mbid);
    return route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/search/batch', route => {
    const ids = route.request().postDataJSON().artistIds; additions.push(...ids);
    return route.fulfill({ json: { added: ids, skipped: [], failed: [] } });
  });
  await page.goto('/search?q=Common+Name&tab=artist');
  await keyboardActivate(page, page.getByRole('button', { name: /Add artist Unidentified Ensemble/ }));
  const options = page.getByRole('dialog', { name: 'Add artist options', exact: true });
  await keyboardActivate(page, options.getByRole('radio', { name: /Canadian ensemble/ }), 'Space');
  await expect(options.getByRole('radio', { name: /Canadian ensemble/ })).toBeChecked();
  await keyboardActivate(page, options.getByRole('button', { name: 'Confirm add', exact: true }));
  await expect(options).toHaveCount(0);
  expect(additions).toEqual([ARTIST_IDS[1]]);
  const checkbox = page.locator('article').filter({ has: page.locator(`a[href*="artist=${ARTIST_IDS[0]}"]`) }).getByRole('checkbox', { name: 'Select Common Name', exact: true });
  await keyboardActivate(page, checkbox, 'Space');
  await expect(checkbox).toBeChecked();
  expect(await checkbox.evaluate(input => (input as HTMLInputElement).type)).toBe('checkbox');
  await keyboardActivate(page, page.getByRole('button', { name: 'Add selected artists', exact: true }));
  await keyboardActivate(page, options.getByRole('button', { name: 'Confirm add', exact: true }));
  await expect.poll(() => additions).toEqual([ARTIST_IDS[1], ARTIST_IDS[0]]);
});

test('keyboard queue paging and rejection use the shown record ID', async ({ catalogPage: page }) => {
  const decisions: unknown[] = [];
  page.on('request', request => {
    if (/\/api\/imports\/review\/\d+$/.test(new URL(request.url()).pathname) && request.method() === 'PUT') decisions.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  await page.goto('/queue');
  await expect(page.getByRole('article', { name: 'Review item 520', exact: true })).toBeVisible();
  await keyboardActivate(page, page.getByRole('button', { name: 'Next page', exact: true }));
  const row = page.getByRole('article', { name: 'Review item 470', exact: true });
  await expect(row).toBeVisible();
  await keyboardActivate(page, row.getByRole('button', { name: 'Reject', exact: true }));
  await expect.poll(() => decisions).toEqual([{ path: '/api/imports/review/470', body: { status: 'rejected' } }]);
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
});

test('keyboard library sorting announces aria-sort inside its labeled scrolling region', async ({ catalogPage: page }) => {
  await page.route('**/api/search/lidarr/artists/fix-all/status', route => route.fulfill({ json: { jobId: null, status: null } }));
  await page.route('**/api/search/lidarr/artists', route => route.fulfill({ json: { artists: [{ id: 1, name: 'Common Name', foreignArtistId: ARTIST_IDS[0], monitored: true, albumCount: 2, trackCount: 4, trackFileCount: 4, sizeOnDisk: 100, hasOverview: true, hasPoster: true, hasGenres: true, issues: [], needsRefresh: false }], total: 1, needingRefresh: 0, issueStats: { noAlbums: 0, noPoster: 0, noOverview: 0, noGenres: 0 }, healthScore: 100 } }));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/library');
  const region = page.getByRole('region', { name: 'Library artists table, scroll horizontally for metadata and actions' });
  await expect(region).toHaveAttribute('tabindex', '0');
  await keyboardActivate(page, page.getByRole('button', { name: 'Albums', exact: true }));
  await expect(page.getByRole('columnheader', { name: 'Albums' })).toHaveAttribute('aria-sort', 'descending');
  await page.keyboard.press('Space');
  await expect(page.getByRole('columnheader', { name: 'Albums' })).toHaveAttribute('aria-sort', 'ascending');
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await expectCatalogFits(page);
});

test('keyboard mobile drawer traps focus and returns it to the menu trigger', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open menu', exact: true });
  await keyboardActivate(page, trigger);
  const drawer = page.getByRole('dialog', { name: 'Mixarr navigation', exact: true });
  await expect(drawer).toBeVisible();
  const controls = drawer.locator('a[href],button:not([disabled])');
  await controls.last().focus();
  await page.keyboard.press('Tab');
  await expect(controls.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('keyboard invalid settings focus their labeled field and canceled navigation retains the draft', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await keyboardActivate(page, page.getByRole('button', { name: 'Account menu', exact: true }));
  await keyboardActivate(page, page.locator('aside').getByRole('link', { name: 'Settings', exact: true }).last());
  const field = page.getByLabel('Max Concurrent Jobs', { exact: true });
  await field.fill('8');
  await expect(page.getByText('Unsaved personal settings changes', { exact: true })).toBeVisible();
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
  await keyboardActivate(page, page.locator('aside').getByRole('link', { name: 'Search', exact: true }));
  await expect.poll(() => dialogs).toEqual(['beforeunload']);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(field).toHaveValue('8');
  void page.goBack().catch(() => {});
  await expect.poll(() => dialogs).toEqual(['beforeunload', 'beforeunload']);
  await expect(page).toHaveURL(/\/settings$/);
  await expect(field).toHaveValue('8');
  await field.fill('0');
  await keyboardActivate(page, page.getByRole('button', { name: 'Save personal settings', exact: true }));
  await expect(field).toBeFocused();
  await expect(page.getByRole('alert').filter({ hasText: 'Max Concurrent Jobs must be a positive integer.' })).toBeVisible();
});
