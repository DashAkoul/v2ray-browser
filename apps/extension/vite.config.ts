import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceAliases } from '../../scripts/aliases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.BUILD_TARGET === 'firefox' ? 'firefox' : 'chrome';

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  resolve: { alias: workspaceAliases() },
  build: {
    outDir: resolve(here, `../../dist/${target}`),
    emptyOutDir: true,
    target: target === 'firefox' ? 'firefox115' : 'chrome116',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        popup: resolve(here, 'popup.html'),
        options: resolve(here, 'options.html'),
      },
    },
  },
});
