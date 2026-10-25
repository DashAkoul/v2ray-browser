import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceAliases } from '../../scripts/aliases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.BUILD_TARGET === 'firefox' ? 'firefox' : 'chrome';

export default defineConfig({
  root: here,
  resolve: { alias: workspaceAliases() },
  build: {
    outDir: resolve(here, `../../dist/${target}`),
    emptyOutDir: false,
    target: target === 'firefox' ? 'firefox115' : 'chrome116',
    minify: true,
    sourcemap: false,
    lib: {
      entry: resolve(here, 'src/background/index.ts'),
      formats: ['iife'],
      name: 'V2RayBrowserBackground',
      fileName: () => 'background.js',
    },
  },
});
