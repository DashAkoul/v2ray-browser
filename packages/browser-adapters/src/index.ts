import { ChromeProxyAdapter, type ChromeApi } from './chrome';
import { FirefoxProxyAdapter, type FirefoxApi } from './firefox';
import type { BrowserKind, ProxyAdapter } from './types';

export { ChromeProxyAdapter, buildChromeProxyConfig, describeTarget } from './chrome';
export type { ChromeApi, ChromeProxySettingsValue } from './chrome';
export { FirefoxProxyAdapter, buildFirefoxProxySettings } from './firefox';
export type { FirefoxApi, FirefoxProxySettingsValue } from './firefox';
export {
  ProxyAdapterError,
  toHostPort,
  type AdapterErrorCode,
  type BrowserKind,
  type ProxyAdapter,
  type ProxySnapshot,
  type ProxyTarget,
} from './types';

export interface BrowserGlobals {
  chrome?: ChromeApi;
  browser?: FirefoxApi;
  /** True when the Firefox WebExtension namespace is present. */
  isFirefox?: boolean;
}

export function detectBrowserKind(globals: BrowserGlobals = readGlobals()): BrowserKind {
  if (globals.isFirefox) return 'firefox';
  if (globals.browser && !globals.chrome) return 'firefox';
  return 'chrome';
}

function readGlobals(): BrowserGlobals {
  const scope = globalThis as unknown as Record<string, unknown>;
  const chrome = scope['chrome'] as ChromeApi | undefined;
  const browser = scope['browser'] as FirefoxApi | undefined;
  const runtime = scope['browser'] as { runtime?: { getBrowserInfo?: unknown } } | undefined;
  return {
    ...(chrome ? { chrome } : {}),
    ...(browser ? { browser } : {}),
    isFirefox: Boolean(runtime?.runtime?.getBrowserInfo),
  };
}

export function createProxyAdapter(globals: BrowserGlobals = readGlobals()): ProxyAdapter {
  if (detectBrowserKind(globals) === 'firefox') {
    const api = globals.browser ?? (globals.chrome as unknown as FirefoxApi | undefined);
    if (!api) throw new Error('No WebExtension API available');
    return new FirefoxProxyAdapter(api);
  }
  const api = globals.chrome ?? (globals.browser as unknown as ChromeApi | undefined);
  if (!api) throw new Error('No WebExtension API available');
  return new ChromeProxyAdapter(api);
}
