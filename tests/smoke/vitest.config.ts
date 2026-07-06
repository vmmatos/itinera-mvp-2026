import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.smoke.ts'],
    // Smoke tests are slow (real HTTP). 30s per test, 2 min total.
    testTimeout: 30_000,
    hookTimeout: 10_000,
    globals: false,
  },
});
