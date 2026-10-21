import { defineConfig } from 'vitest/config';
import path from 'node:path';

const root = import.meta.dirname;
const r = (p: string) => path.resolve(root, p);

export default defineConfig({
  resolve: {
    alias: {
      // Subpath aliases must come before their package prefix, otherwise
      // '@storycode/storage' rewrites '@storycode/storage/node-fs' first.
      '@storycode/storage/node-fs': r('packages/storage/src/node-fs.ts'),
      '@': r('apps/desktop/src'),
      '@storycode/core': r('packages/core/src/index.ts'),
      '@storycode/storage': r('packages/storage/src/index.ts'),
      '@storycode/validation': r('packages/validation/src/index.ts'),
      '@storycode/agent': r('packages/agent/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.ts',
      'apps/desktop/src/**/*.test.tsx',
      'tests/**/*.test.ts',
    ],
    // exFAT + macOS writes AppleDouble `._*` siblings; never collect them.
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-types/**', '**/._*'],
    globals: false,
    testTimeout: 15000,
  },
});
