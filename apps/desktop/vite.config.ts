import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

const host = process.env.TAURI_DEV_HOST;
const root = import.meta.dirname;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@storycode/core': path.resolve(root, '../../packages/core/src/index.ts'),
      '@storycode/storage': path.resolve(root, '../../packages/storage/src/index.ts'),
      '@storycode/validation': path.resolve(root, '../../packages/validation/src/index.ts'),
      '@storycode/agent': path.resolve(root, '../../packages/agent/src/index.ts'),
      '@': path.resolve(root, 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome110',
    minify: false,
    sourcemap: true,
  },
});
