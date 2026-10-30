import { test as base, expect, Page } from '@playwright/test';

/**
 * Shared test fixtures for Mixarr E2E tests
 */

// Test user credentials (from seed data or test environment)
export const TEST_USER = {
  username: 'test',
  email: 'test@example.com',
  password: 'testpassword123',
};

// Extend base test with custom fixtures
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  // Fixture: Pre-authenticated page
  authenticatedPage: async ({ page }, use) => {
    // Navigate to login page
    await page.goto('/login');
    
    // Fill login form
    await page.getByLabel(/username/i).fill(TEST_USER.username);
    await page.getByLabel(/password/i).fill(TEST_USER.password);
    
    // Submit and wait for redirect
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await page.waitForURL(/\/(dashboard|subscriptions)?$/);
    
    // Provide authenticated page to test
    await use(page);
  },
});

// Re-export expect for convenience
export { expect };

/**
 * Helper: Check if element has focus
 */
export async function hasFocus(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const element = document.querySelector(sel);
    return element === document.activeElement;
  }, selector);
}

/**
 * Helper: Get all focusable elements in order
 */
export async function getFocusableElements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const focusableSelectors = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');
    
    const elements = Array.from(document.querySelectorAll(focusableSelectors));
    return elements.map((el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const text = el.textContent?.trim().slice(0, 20) || '';
      return `${tag}${id}: ${text}`;
    });
  });
}

/**
 * Helper: Check for accessibility violations using basic checks
 * (For full a11y testing, consider adding @axe-core/playwright)
 */
export async function checkBasicA11y(page: Page): Promise<{ violations: string[] }> {
  const violations: string[] = [];
  
  // Check for missing alt text on images
  const imagesWithoutAlt = await page.locator('img:not([alt])').count();
  if (imagesWithoutAlt > 0) {
    violations.push(`${imagesWithoutAlt} images missing alt text`);
  }
  
  // Check for missing form labels
  const inputsWithoutLabels = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])');
    let count = 0;
    inputs.forEach((input) => {
      const id = input.id;
      const hasLabel = id && document.querySelector(`label[for="${id}"]`);
      const hasAriaLabel = input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby');
      if (!hasLabel && !hasAriaLabel) count++;
    });
    return count;
  });
  if (inputsWithoutLabels > 0) {
    violations.push(`${inputsWithoutLabels} inputs missing labels`);
  }
  
  // Check for buttons without accessible names
  const buttonsWithoutNames = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    let count = 0;
    buttons.forEach((btn) => {
      const hasText = btn.textContent?.trim();
      const hasAriaLabel = btn.hasAttribute('aria-label');
      if (!hasText && !hasAriaLabel) count++;
    });
    return count;
  });
  if (buttonsWithoutNames > 0) {
    violations.push(`${buttonsWithoutNames} buttons missing accessible names`);
  }
  
  return { violations };
}

/**
 * Helper: Wait for theme to be applied
 */
export async function waitForTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.waitForFunction(
    (expectedTheme) => {
      const html = document.documentElement;
      if (expectedTheme === 'dark') {
        return html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark';
      }
      return !html.classList.contains('dark') && html.getAttribute('data-theme') !== 'dark';
    },
    theme,
    { timeout: 5000 }
  );
}

/**
 * Helper: Get current theme
 */
export async function getCurrentTheme(page: Page): Promise<'light' | 'dark' | 'system'> {
  return page.evaluate(() => {
    const html = document.documentElement;
    const isDark = html.classList.contains('dark') || html.getAttribute('data-theme') === 'dark';
    const stored = localStorage.getItem('theme');
    if (stored === 'system') return 'system';
    return isDark ? 'dark' : 'light';
  });
}
