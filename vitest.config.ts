import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Use Node.js environment for server tests
    environment: 'node',

    // Include test files
    include: [
      'src/**/*.test.ts',
      'src/**/*.spec.ts',
      'tests/**/*.test.ts',
      'tests/**/*.spec.ts',
    ],

    // Test timeout (integration tests may take longer)
    testTimeout: 30000,

    // Hook timeout
    hookTimeout: 30000,

    // Run tests sequentially for integration tests (to avoid port conflicts)
    // In Vitest 4, pool options are top-level
    sequence: {
      concurrent: false,
    },

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/packages/server/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
    },
  },
});
