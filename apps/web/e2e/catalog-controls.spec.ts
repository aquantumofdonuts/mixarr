import { mkdir } from 'node:fs/promises';
import { test, expect } from './catalog-fixtures';
import { waitForTheme } from './fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: existing subscription form keeps actions outside scroll and restores its trigger`, async ({ catalogPage: page }) => {
    await page.addInitScript(value => localStorage.setItem('theme', value), theme);
    await page.goto('/subscriptions');
    await waitForTheme(page, theme);
    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    await edit.click();
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
    await expect(edit).toBeFocused();
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
  await expect(page.getByText('Queue Artist 001', { exact: true })).toBeVisible();
});
