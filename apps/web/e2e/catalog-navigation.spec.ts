import { mkdir } from 'node:fs/promises';
import { test, expect, CATALOG_USER } from './catalog-fixtures';

for (const role of ['admin', 'user'] as const) {
  test.describe(`${role} navigation`, () => {
    test.use({ catalogRole: role });
    for (const width of [320, 390, 1024]) {
      test(`${width}px authorized destinations and focus`, async ({ catalogPage: page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.route('**/api/auth/me', route => route.fulfill({ json: { user: { ...CATALOG_USER, role, displayName: 'A very long catalog username that must remain usable on narrow screens' }, setupRequired: false } }));
        await page.goto('/search');
        const menu = page.getByRole('button', { name: 'Open menu' });
        if (width < 1024) {
          await menu.click();
          const drawer = page.getByRole('dialog', { name: 'Mixarr navigation' });
          await expect(drawer).toBeVisible();
          await expect(drawer.getByRole('link', { name: 'Subscriptions', exact: true })).toBeVisible();
          await expect(drawer.getByRole('link', { name: 'Connections', exact: true })).toHaveCount(role === 'admin' ? 1 : 0);
          await expect(drawer.getByRole('link', { name: 'Search', exact: true })).toHaveAttribute('aria-current', 'page');
          expect(await drawer.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
          await page.keyboard.press('Shift+Tab');
          expect(await drawer.evaluate(el => el.contains(document.activeElement))).toBe(true);
          await page.keyboard.press('Escape');
          await expect(drawer).toHaveCount(0);
          await expect(menu).toBeFocused();
          await menu.click();
          await drawer.getByRole('link', { name: 'Subscriptions', exact: true }).click();
          await expect(page).toHaveURL(/\/subscriptions$/);
          await expect(drawer).toHaveCount(0);
        } else {
          await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
          await expect(menu).toBeHidden();
          await expect(page.getByRole('link', { name: 'Connections', exact: true })).toHaveCount(role === 'admin' ? 1 : 0);
          const alignment = await page.evaluate(() => {
            const brand = document.querySelector('aside > div')!.getBoundingClientRect();
            const topbar = document.querySelector('[data-catalog-topbar]')!.getBoundingClientRect();
            return [brand.height, topbar.height, brand.bottom, topbar.bottom];
          });
          expect(alignment).toEqual([57, 57, 57, 57]);
          await page.getByRole('button', { name: 'Collapse sidebar' }).click();
          await expect(page.getByRole('link', { name: 'Search', exact: true })).toBeVisible();
        }
        const evidence = `${process.env.CATALOG_EVIDENCE_DIR || '/tmp/mixarr-catalog-evidence'}/navigation`;
        await mkdir(evidence, { recursive: true });
        await page.screenshot({ path: `${evidence}/${role}-${width}.png`, animations: 'disabled' });
      });
    }
  });
}

test.describe('login return targets', () => {
  test.use({ catalogAuthenticated: false });
  test('preserves path and repeated query parameters through login', async ({ catalogPage: page }) => {
    const target = '/search?q=Common+Name&seed=one&seed=two&page=3';
    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe(target);
    await page.getByLabel('Username', { exact: true }).fill(CATALOG_USER.username);
    await page.getByLabel('Password', { exact: true }).fill('catalog-fixture-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(new RegExp('/search\\?q=Common\\+Name&seed=one&seed=two&page=3$'));
  });
  for (const target of ['https://example.invalid/', '//example.invalid/', '/\\example.invalid/', 'javascript:alert(1)']) {
    test(`rejects unsafe return target ${target}`, async ({ catalogPage: page }) => {
      await page.goto(`/login?returnTo=${encodeURIComponent(target)}`);
      await page.getByLabel('Username', { exact: true }).fill(CATALOG_USER.username);
      await page.getByLabel('Password', { exact: true }).fill('catalog-fixture-password');
      await page.getByRole('button', { name: /sign in/i }).click();
      await expect(page).toHaveURL(/:\d+\/$/);
      await expect(page.getByRole('heading', { name: 'Discovery Feed', exact: true })).toBeVisible();
    });
  }
});
