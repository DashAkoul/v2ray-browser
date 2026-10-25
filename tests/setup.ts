import '@testing-library/jest-dom/vitest';

// Provide a deterministic clock-independent crypto mock surface for tests that
// only need ids. Real crypto.randomUUID is used when available.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      getRandomValues: (arr: Uint8Array) => arr.fill(7),
    },
    configurable: true,
  });
}
