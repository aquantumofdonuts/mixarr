import { test, expect, ARTIST_IDS } from './catalog-fixtures';

test('results deep links retain page and filter through refresh and Back', async ({ catalogPage: page }) => {
  await page.goto('/subscriptions/11?tab=results&status=pending&page=2');
  await expect(page.getByRole('tab', { name: 'All results' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Result Artist 51', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Result Artist 51', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Previous page' }).click();
  await expect(page.getByText('Unknown Common Name', { exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByText('Result Artist 51', { exact: true })).toBeVisible();
  await page.getByLabel('Result status').selectOption('added');
  await expect(page).toHaveURL(/status=added/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(page.getByText('No added results found')).toBeVisible();
});

test('native run disclosures preserve direct links and distinguish empty runs', async ({ catalogPage: page }) => {
  await page.goto('/subscriptions/11?tab=runs&run=71');
  const run = page.locator('details[data-run="71"]');
  await expect(run).toHaveAttribute('open', '');
  await expect(run.getByText('Unknown Common Name', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(run).toHaveAttribute('open', '');
  await page.locator('details[data-run="72"] summary').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/run=72/);
  await expect(page.getByText('This run has no results')).toBeVisible();
  await page.goBack();
  await expect(run).toHaveAttribute('open', '');
});

test('identity selection acquires only the chosen original result', async ({ catalogPage: page }) => {
  const approvals: { path: string; body: unknown }[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/approve')) approvals.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
  });
  await page.goto('/subscriptions/11?tab=results');
  await page.getByRole('button', { name: 'Identify and add artist Unknown Common Name' }).click();
  const picker = page.getByRole('dialog', { name: 'Select Artist' });
  await expect(picker.getByRole('button', { name: /Canadian ensemble/ })).toBeVisible();
  expect(approvals).toEqual([]);
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(approvals).toEqual([]);
  await page.getByRole('button', { name: 'Identify and add artist Unknown Common Name' }).click();
  await picker.getByRole('button', { name: /Canadian ensemble/ }).click();
  await expect(page.getByText('Artist added to Lidarr', { exact: true }).first()).toBeVisible();
  expect(approvals).toEqual([{ path: '/api/subscriptions/11/results/101/approve', body: { mbid: ARTIST_IDS[1] } }]);
});

test('run error offers retry instead of empty results', async ({ catalogPage: page }) => {
  let unavailable = true;
  await page.route('**/api/subscriptions/11/runs/71', async route => {
    if (unavailable) return route.fulfill({ status: 503, json: { error: 'Run unavailable' } });
    return route.fallback();
  });
  await page.goto('/subscriptions/11?tab=runs&run=71');
  await expect(page.getByRole('alert').filter({ hasText: 'Run results could not be loaded' })).toBeVisible();
  await expect(page.getByText('This run has no results')).toHaveCount(0);
  unavailable = false;
  await page.getByRole('button', { name: 'Retry run results' }).click();
  await expect(page.getByText('Unknown Common Name', { exact: true }).first()).toBeVisible();
});

test('mobile subscription inspector keeps run context and restores focus', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/subscriptions/11?tab=runs&run=71&status=pending');
  const trigger = page.getByRole('link', { name: 'Result Artist 2', exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('run')).toBe('71');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('an older run outside the initial history remains directly reachable', async ({ catalogPage: page }) => {
  await page.route('**/api/subscriptions/11/runs/69', route => route.fulfill({ json: {
    run: { id: 69, status: 'completed', resultsCount: 1, addedCount: 0, skippedCount: 0, errorMessage: null, startedAt: '2026-09-01T12:00:00Z', completedAt: '2026-09-01T12:01:00Z' },
    results: [{ id: 99, itemType: 'artist', name: 'Older source artist', artistName: null, mbid: ARTIST_IDS[0], runId: 69, status: 'pending', skipReason: null, createdAt: '2026-09-01T12:00:00Z' }],
  } }));
  await page.goto('/subscriptions/11?tab=runs&run=69');
  await expect(page.locator('details[data-run="69"]')).toHaveAttribute('open', '');
  await expect(page.getByRole('link', { name: 'Older source artist', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Link to run 69' })).toBeVisible();
});

test('an uncertain acquisition remains retryable without a success claim', async ({ catalogPage: page }) => {
  await page.route('**/api/subscriptions/11/results/102/approve', route => route.fulfill({ status: 503, json: { error: 'Provider outcome could not be confirmed; retry to reconcile', code: 'ACQUISITION_UNCERTAIN', outcome: 'uncertain' } }));
  await page.goto('/subscriptions/11?tab=results');
  await page.getByRole('button', { name: 'Add artist Result Artist 2', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Result 102', exact: true }).getByText('Provider outcome could not be confirmed; retry to reconcile')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add artist Result Artist 2', exact: true })).toBeEnabled();
  await expect(page.getByText('Artist added to Lidarr', { exact: true })).toHaveCount(0);
});

test('an out-of-range page recovers to the final page in its filter', async ({ catalogPage: page }) => {
  await page.goto('/subscriptions/11?tab=results&status=pending&page=10000');
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText('Result Artist 51', { exact: true })).toBeVisible();
  await expect(page.getByText('No pending results found', { exact: true })).toHaveCount(0);
});

test('result artwork opens the inspector by pointer and keyboard and restores focus', async ({ catalogPage: page }) => {
  await page.goto('/subscriptions/11?tab=results');
  const artwork = page.getByRole('link', { name: 'Inspect artist Result Artist 2', exact: true });
  await artwork.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(artwork).toBeFocused();
  await artwork.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(artwork).toBeFocused();
  expect(new URL(page.url()).searchParams.get('tab')).toBe('results');
});

test('status refinements replace history while page changes retain Back navigation', async ({ catalogPage: page }) => {
  await page.goto('/subscriptions');
  await page.getByRole('link', { name: 'View results', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'All results' })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Result status').selectOption('pending');
  await expect(page).toHaveURL(/status=pending/);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(page.getByText('Result Artist 51', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/status=pending/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL('/subscriptions');
});
