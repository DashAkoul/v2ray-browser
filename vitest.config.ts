import { defineConfig } from 'vitest/config';
import { workspaceAliases } from './scripts/aliases.ts';

export default defineConfig({
  resolve: { alias: workspaceAliases() },
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.{ts,tsx}', 'apps/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.d.ts'],
    },
  },
});
