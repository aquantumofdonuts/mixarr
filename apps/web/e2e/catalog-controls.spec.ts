import { mkdir } from 'node:fs/promises';
import { test, expect } from './catalog-fixtures';
import { waitForTheme } from './fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: existing subscription form keeps actions outside scroll and restores its trigger`, async ({ catalogPage: page }) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/subscriptions');
    await waitForTheme(page, theme);
    const overflow = page.getByLabel('More actions for Weekly discoveries', { exact: true });
    await overflow.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Edit subscription', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Subscription', exact: true });
    await expect(dialog).toBeVisible();
    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeVisible();
    expect(await save.evaluate(element => element.closest('[data-modal-body]') === null)).toBe(true);
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await mkdir('/tmp/mixarr-catalog-evidence/controls', { recursive: true });
    await expect(dialog).toHaveCSS('opacity', '1');
    await page.screenshot({ animations: 'disabled', path: `/tmp/mixarr-catalog-evidence/controls/subscription-form-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(overflow).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  });
}

test('catalog navigation uses native destinations', async ({ catalogPage: page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Review Queue', exact: true }).click();
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
});

test('dashboard record labels distinguish owner counts from broader administrative lists', async ({ catalogPage: page }) => {
  await page.goto('/');
  const summary = page.getByRole('region', { name: 'Your catalog summary' });
  await expect(summary.getByRole('link', { name: '4 Pending discovery records', exact: true })).toHaveAttribute('href', '/');
  await expect(summary.getByText('Results marked added (30d)', { exact: true })).toBeVisible();
  await expect(summary.getByRole('link', { name: /Results marked added/ })).toHaveCount(0);
  await summary.getByRole('link', { name: 'Open all review records', exact: true }).click();
  await expect(page).toHaveURL(/\/queue$/);
  await expect(page.getByText('Queue Artist 520', { exact: true })).toBeVisible();
});


test('mobile subscription rows expose separate actions and explain delete consequences', async ({ catalogPage: page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/subscriptions');
  await expect(page.getByRole('link', { name: 'Weekly discoveries', exact: true })).toHaveAttribute('href', '/subscriptions/11');
  await expect(page.getByRole('link', { name: 'View results', exact: true })).toHaveAttribute('href', '/subscriptions/11?tab=results');
  await expect(page.getByRole('button', { name: 'Run now', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause schedule', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const overflow = page.getByLabel('More actions for Weekly discoveries', { exact: true });
  await overflow.focus();
  await page.keyboard.press('Enter');
  const editBounds = await page.getByRole('button', { name: 'Edit subscription', exact: true }).boundingBox();
  expect(editBounds).not.toBeNull();
  expect(editBounds!.x).toBeGreaterThanOrEqual(0);
  expect(editBounds!.x + editBounds!.width).toBeLessThanOrEqual(320);
  await page.getByRole('button', { name: 'Delete subscription', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete subscription?', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/schedule/i);
  await expect(dialog).toContainText(/results/i);
  await expect(dialog).toContainText(/run history/i);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(overflow).toBeFocused();
});

test('editing a recurring subscription sends an explicit manual-only schedule', async ({ catalogPage: page }) => {
  const submitted: Record<string, unknown>[] = [];
  await page.route('**/api/subscriptions/11', async route => {
    if (route.request().method() !== 'PUT') return route.fallback();
    const body = route.request().postDataJSON();
    submitted.push(body);
    await route.fulfill({ json: { subscription: { id: 11, ...body } } });
  });
  await page.goto('/subscriptions');
  await page.getByLabel('More actions for Weekly discoveries', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit subscription', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Subscription', exact: true });
  await dialog.getByLabel('Schedule', { exact: true }).selectOption('');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => submitted.length).toBe(1);
  expect(submitted[0]).toHaveProperty('schedule', '');
  await expect(dialog).toHaveCount(0);
});
