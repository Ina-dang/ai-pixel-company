import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
