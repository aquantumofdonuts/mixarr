import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'capture.spec.ts',
  workers: 1,
  reporter: 'list',
  outputDir: '/tmp/mixarr-website-captures',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3027',
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    timezoneId: 'UTC',
  },
});
