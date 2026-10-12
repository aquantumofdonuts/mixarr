import { mkdir } from 'node:fs/promises';
import { test, expect, ARTIST_IDS } from './catalog-fixtures';

test('artist drilldown retains feed context and pages its release chronology', async ({ catalogPage: page }) => {
  await page.goto('/?view=list');
  const artist = page.getByRole('link', { name: 'Common Name', exact: true }).first();
  await artist.click();
  await expect(page).toHaveURL(new RegExp(`view=list.*artist=${ARTIST_IDS[0]}`));
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Weekly discoveries', exact: true })).toHaveAttribute('href', '/subscriptions/11?tab=results');
  await expect(panel.locator('a[href="/subscriptions/11?tab=runs&run=71"]')).toBeVisible();
  await expect(panel.getByText('Catalog release 1', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Load more releases', exact: true }).click();
  await expect(panel.getByText('Catalog release 26', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).toHaveURL(/\?view=list$/);
  await expect(artist).toBeFocused();
});

test.describe('mobile artist direct link', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('fits the viewport and closes to its current parent query', async ({ catalogPage: page }) => {
    await page.goto(`/?view=artwork&artist=${ARTIST_IDS[1]}`);
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('Fixture identity', { exact: true })).toBeVisible();
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    if (process.env.CATALOG_EVIDENCE_DIR) {
      await mkdir(process.env.CATALOG_EVIDENCE_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.CATALOG_EVIDENCE_DIR}/artist-inspector-mobile.png` });
    }
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\?view=artwork$/);
  });
});

test('keyboard dismissal sends signed Undo immediately and restores its row', async ({ catalogPage: page }) => {
  await page.goto('/?view=list');
  const feed = page.getByTestId('feed-grid');
  await expect(feed.getByText('Common Name', { exact: true })).toHaveCount(2);
  const dismiss = feed.getByRole('button', { name: /^Dismiss/ }).first();
  await dismiss.focus();
  await page.keyboard.press('Enter');
  await expect(feed.getByText('Common Name', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(feed.getByText('Common Name', { exact: true })).toHaveCount(2);
});

test('artwork view keeps primary actions visible without hover', async ({ catalogPage: page }) => {
  await page.goto('/?view=artwork');
  const feed = page.getByTestId('feed-grid');
  const add = feed.getByRole('button', { name: /^Add artist/ }).first();
  await add.scrollIntoViewIfNeeded();
  await expect(add).toBeInViewport();
  expect(await add.evaluate(button => {
    for (let element: Element | null = button; element; element = element.parentElement) {
      if (Number(getComputedStyle(element).opacity) === 0) return false;
    }
    return true;
  })).toBe(true);
  await expect(feed.getByRole('button', { name: /^Dismiss/ }).first()).toBeVisible();
  await expect(feed.getByRole('link', { name: 'Common Name', exact: true }).first()).toHaveAttribute('href', new RegExp(`view=artwork.*artist=${ARTIST_IDS[0]}`));
});
