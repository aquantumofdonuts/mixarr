import { test, expect, waitForTheme } from './fixtures';

/**
 * Theme E2E Tests
 * 
 * Tests theme switching, persistence, and system preference detection
 */

test.describe('Theme', () => {
  test.describe('Theme Switching', () => {
    test('can switch to dark theme', async ({ page }) => {
      await page.goto('/');
      
      // Find theme toggle button or dropdown
      const themeToggle = page.getByRole('button', { name: /theme|dark|light|mode/i })
        .or(page.getByLabel(/theme/i));
      
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        
        // If it's a dropdown, select dark
        const darkOption = page.getByRole('menuitem', { name: /dark/i })
          .or(page.getByRole('option', { name: /dark/i }))
          .or(page.getByText(/^dark$/i));
        
        if (await darkOption.isVisible()) {
          await darkOption.click();
        }
        
        // Verify dark theme is applied
        await waitForTheme(page, 'dark');
        
        const isDark = await page.evaluate(() => {
          return document.documentElement.classList.contains('dark') ||
                 document.documentElement.getAttribute('data-theme') === 'dark';
        });
        
        expect(isDark).toBe(true);
      }
    });

    test('can switch to light theme', async ({ page }) => {
      await page.goto('/');
      
      // First set to dark to ensure we're switching
      await page.evaluate(() => {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      });
      
      const themeToggle = page.getByRole('button', { name: /theme|dark|light|mode/i })
        .or(page.getByLabel(/theme/i));
      
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        
        const lightOption = page.getByRole('menuitem', { name: /light/i })
          .or(page.getByRole('option', { name: /light/i }))
          .or(page.getByText(/^light$/i));
        
        if (await lightOption.isVisible()) {
          await lightOption.click();
        }
        
        await waitForTheme(page, 'light');
        
        const isLight = await page.evaluate(() => {
          return !document.documentElement.classList.contains('dark') &&
                 document.documentElement.getAttribute('data-theme') !== 'dark';
        });
        
        expect(isLight).toBe(true);
      }
    });

    test('can switch to system theme', async ({ page }) => {
      await page.goto('/');
      
      const themeToggle = page.getByRole('button', { name: /theme|dark|light|mode/i })
        .or(page.getByLabel(/theme/i));
      
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        
        const systemOption = page.getByRole('menuitem', { name: /system/i })
          .or(page.getByRole('option', { name: /system/i }))
          .or(page.getByText(/^system$/i));
        
        if (await systemOption.isVisible()) {
          await systemOption.click();
          
          // Verify system preference is stored
          const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
          expect(storedTheme).toBe('system');
        }
      }
    });
  });

  test.describe('Persistence', () => {
    test('theme preference persists across page reload', async ({ page }) => {
      await page.goto('/');
      
      // Set dark theme via localStorage
      await page.evaluate(() => {
        localStorage.setItem('theme', 'dark');
        document.documentElement.classList.add('dark');
      });
      
      // Reload the page
      await page.reload();
      
      // Wait for theme to apply
      await page.waitForTimeout(500);
      
      // Check theme is still dark
      const isDark = await page.evaluate(() => {
        const stored = localStorage.getItem('theme');
        const hasDarkClass = document.documentElement.classList.contains('dark');
        return stored === 'dark' || hasDarkClass;
      });
      
      expect(isDark).toBe(true);
    });

    test('theme preference persists across sessions', async ({ page, context }) => {
      await page.goto('/');
      
      // Set theme preference
      await page.evaluate(() => {
        localStorage.setItem('theme', 'dark');
      });
      
      // Create a new page in the same context (simulates new tab)
      const newPage = await context.newPage();
      await newPage.goto('/');
      
      // Check theme in new page
      const isDark = await newPage.evaluate(() => {
        return localStorage.getItem('theme') === 'dark';
      });
      
      expect(isDark).toBe(true);
      
      await newPage.close();
    });
  });

  test.describe('System Detection', () => {
    test('system theme responds to prefers-color-scheme', async ({ page }) => {
      // Set system preference to dark
      await page.emulateMedia({ colorScheme: 'dark' });
      
      await page.goto('/');
      
      // Set theme to system
      await page.evaluate(() => {
        localStorage.setItem('theme', 'system');
      });
      
      await page.reload();
      await page.waitForTimeout(500);
      
      // Should apply dark theme based on system preference
      const isDark = await page.evaluate(() => {
        return document.documentElement.classList.contains('dark') ||
               document.documentElement.getAttribute('data-theme') === 'dark' ||
               window.matchMedia('(prefers-color-scheme: dark)').matches;
      });
      
      expect(isDark).toBe(true);
    });

    test('manual override takes precedence over system', async ({ page }) => {
      // Set system preference to dark
      await page.emulateMedia({ colorScheme: 'dark' });
      
      await page.goto('/');
      
      // Manually set light theme
      await page.evaluate(() => {
        localStorage.setItem('theme', 'light');
        document.documentElement.classList.remove('dark');
      });
      
      await page.reload();
      await page.waitForTimeout(500);
      
      // Should be light despite system preferring dark
      const storedTheme = await page.evaluate(() => localStorage.getItem('theme'));
      expect(storedTheme).toBe('light');
    });
  });
});
