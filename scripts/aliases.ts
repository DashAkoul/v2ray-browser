import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @returns {{ find: RegExp, replacement: string }[]} */
export function workspaceAliases() {
  return [
    { find: /^@v2rb\/shared$/, replacement: resolve(root, 'packages/shared-types/src/index.ts') },
    { find: /^@v2rb\/parser$/, replacement: resolve(root, 'packages/config-parser/src/index.ts') },
    { find: /^@v2rb\/storage$/, replacement: resolve(root, 'packages/storage/src/index.ts') },
    { find: /^@v2rb\/adapters$/, replacement: resolve(root, 'packages/browser-adapters/src/index.ts') },
    { find: /^@v2rb\/core$/, replacement: resolve(root, 'packages/core/src/index.ts') },
    { find: /^@v2rb\/ui$/, replacement: resolve(root, 'packages/ui/src/index.ts') },
  ];
}

export { root };
