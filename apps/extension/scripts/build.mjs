import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const root = resolve(appDir, '../..');
const target = process.argv[2] === 'firefox' ? 'firefox' : 'chrome';
const outDir = resolve(root, 'dist', target);
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');

if (!existsSync(viteBin)) {
  console.error('vite is not installed. Run `npm install` first.');
  process.exit(1);
}

if (!existsSync(resolve(appDir, 'public/icons/icon128.png'))) {
  const icons = spawnSync(process.execPath, [resolve(root, 'scripts/generate-icons.mjs')], { stdio: 'inherit' });
  if (icons.status !== 0) process.exit(icons.status ?? 1);
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

function runVite(config) {
  const result = spawnSync(process.execPath, [viteBin, 'build', '--config', config, '--logLevel', 'warn'], {
    cwd: appDir,
    env: { ...process.env, BUILD_TARGET: target, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`build failed for ${config}`);
    process.exit(result.status ?? 1);
  }
}

runVite('vite.config.ts');
runVite('vite.background.config.ts');

const base = JSON.parse(readFileSync(resolve(appDir, 'manifests/base.json'), 'utf8'));
const specific = JSON.parse(readFileSync(resolve(appDir, `manifests/${target}.json`), 'utf8'));
const permissions = Array.from(new Set([...(base.permissions ?? []), ...(specific.permissions ?? [])]));
const manifest = { ...base, ...specific, permissions };
writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const required = ['manifest.json', 'popup.html', 'options.html', 'background.js', 'icons/icon128.png'];
const missing = required.filter((file) => !existsSync(resolve(outDir, file)));
if (missing.length > 0) {
  console.error(`build incomplete, missing: ${missing.join(', ')}`);
  process.exit(1);
}

const background = readFileSync(resolve(outDir, 'background.js'), 'utf8');
if (/<script|import\s+['"]https?:/i.test(background)) {
  console.error('background bundle contains unexpected remote content');
  process.exit(1);
}

process.stdout.write(`built ${target} -> ${outDir}
`);
