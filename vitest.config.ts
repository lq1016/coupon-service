import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: '/tmp/coupon-coverage',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/interface.ts', 'src/db/schema.ts'],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 70 },
    },
  },
});
