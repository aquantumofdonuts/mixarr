import { defineConfig } from 'vitest/config';

/**
 * Dedicated config for the Collaboration Constellation end-to-end integration
 * test. It lives under tests/integration/ (per the task spec), which the default
 * `vitest.config.ts` excludes because the OTHER integration tests there require a
 * live MySQL database. THIS test needs no database — it composes the real
 * constellation services over an in-memory Prisma store — so this config runs
 * just that one file with the integration exclusion lifted.
 *
 *   npm run test:constellation-e2e      (from apps/api)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/constellation.e2e.test.ts'],
    exclude: ['node_modules', 'dist'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30000,
  },
});
