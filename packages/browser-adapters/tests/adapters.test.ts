import { describe, expect, it, vi } from 'vitest';
import {
  ChromeProxyAdapter,
  FirefoxProxyAdapter,
  ProxyAdapterError,
  buildChromeProxyConfig,
  buildFirefoxProxySettings,
  createProxyAdapter,
  type ChromeApi,
  type ChromeProxySettingsValue,
  type FirefoxApi,
  type FirefoxProxySettingsValue,
  type ProxyTarget,
} from '../src/index';

function target(overrides: Partial<ProxyTarget> = {}): ProxyTarget {
  return {
    connectKind: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    bypassList: ['<local>'],
    ...overrides,
  };
}

function fakeChrome(options: { level?: string; value?: ChromeProxySettingsValue } = {}) {
  let value: unknown = options.value ?? { mode: 'system' };
  let level = options.level ?? 'controllable_by_this_extension';
  let leakPolicy = 'default';
  const setSpy = vi.fn();
  const api: ChromeApi = {
    proxy: {
      settings: {
        get: async () => ({ value: structuredClone(value), levelOfControl: level }),
        set: async (details) => {
          setSpy(details.value);
          value = structuredClone(details.value);
          level = 'controlled_by_this_extension';
        },
        clear: async () => {
          value = { mode: 'system' };
          level = 'controllable_by_this_extension';
        },
      },
    },
    privacy: {
      network: {
        webRTCIPHandlingPolicy: {
          get: async () => ({ value: leakPolicy }),
          set: async (details) => {
            leakPolicy = details.value;
          },
        },
      },
    },
  };
  return {
    api,
    setSpy,
    getValue: () => value as ChromeProxySettingsValue,
    getLeakPolicy: () => leakPolicy,
    setLevel: (next: string) => {
      level = next;
    },
  };
}

describe('chrome adapter', () => {
  it('maps every connect kind to a chrome proxy scheme', () => {
    expect(buildChromeProxyConfig(target({ connectKind: 'socks5' })).rules?.singleProxy?.scheme).toBe('socks5');
    expect(buildChromeProxyConfig(target({ connectKind: 'socks4' })).rules?.singleProxy?.scheme).toBe('socks4');
    expect(buildChromeProxyConfig(target({ connectKind: 'http' })).rules?.singleProxy?.scheme).toBe('http');
    expect(buildChromeProxyConfig(target({ connectKind: 'https' })).rules?.singleProxy?.scheme).toBe('https');
    expect(buildChromeProxyConfig(target()).rules?.bypassList).toEqual(['<local>']);
  });

  it('applies and verifies a fixed_servers configuration', async () => {
    const fake = fakeChrome();
    const adapter = new ChromeProxyAdapter(fake.api);
    await adapter.apply(target());
    expect(fake.getValue().mode).toBe('fixed_servers');
    expect(fake.getValue().rules?.singleProxy).toEqual({ scheme: 'socks5', host: '127.0.0.1', port: 1080 });
    await expect(adapter.verifyApplied(target())).resolves.toBe(true);
    await expect(adapter.verifyApplied(target({ port: 1081 }))).resolves.toBe(false);
  });

  it('refuses to apply when another extension or policy is in control', async () => {
    const fake = fakeChrome({ level: 'controlled_by_other_extensions' });
    const adapter = new ChromeProxyAdapter(fake.api);
    await expect(adapter.apply(target())).rejects.toMatchObject({ code: 'CONTROLLED' });
    expect(fake.setSpy).not.toHaveBeenCalled();
  });

  it('rejects endpoints that need credentials', async () => {
    const fake = fakeChrome();
    const adapter = new ChromeProxyAdapter(fake.api);
    const error = await adapter.apply(target({ username: 'u', password: 'p' })).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProxyAdapterError);
    expect((error as ProxyAdapterError).code).toBe('AUTH_UNSUPPORTED');
  });

  it('restores the captured configuration verbatim', async () => {
    const fake = fakeChrome({ value: { mode: 'fixed_servers', rules: { singleProxy: { host: 'corp', port: 8080 } } } });
    const adapter = new ChromeProxyAdapter(fake.api);
    const snapshot = await adapter.capture();
    await adapter.apply(target());
    expect(fake.getValue().rules?.singleProxy?.host).toBe('127.0.0.1');
    await adapter.restore(snapshot);
    expect(fake.getValue().rules?.singleProxy?.host).toBe('corp');
  });

  it('clears settings when there is no snapshot', async () => {
    const fake = fakeChrome();
    const adapter = new ChromeProxyAdapter(fake.api);
    await adapter.apply(target());
    await adapter.restore(undefined);
    expect(fake.getValue().mode).toBe('system');
  });

  it('toggles the WebRTC leak guard', async () => {
    const fake = fakeChrome();
    const adapter = new ChromeProxyAdapter(fake.api);
    await expect(adapter.setLeakProtection(true)).resolves.toBe(true);
    expect(fake.getLeakPolicy()).toBe('disable_non_proxied_udp');
    await adapter.setLeakProtection(false);
    expect(fake.getLeakPolicy()).toBe('default');
  });

  it('reports capabilities including chrome auth limitations', async () => {
    const adapter = new ChromeProxyAdapter(fakeChrome().api);
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.browser).toBe('chrome');
    expect(capabilities.supportedConnectKinds).toContain('https');
    expect(capabilities.authSupported).toEqual([]);
    expect(capabilities.notes.join(' ')).toMatch(/credentials/i);
  });
});

function fakeFirefox(options: { level?: string; value?: FirefoxProxySettingsValue; incognito?: boolean } = {}) {
  let value: FirefoxProxySettingsValue = options.value ?? { proxyType: 'system' };
  const setSpy = vi.fn();
  const api: FirefoxApi = {
    proxy: {
      settings: {
        get: async () => ({ value: structuredClone(value), levelOfControl: options.level }),
        set: async (details) => {
          if (options.incognito === false) {
            throw new Error('Extension does not have permission to access private browsing');
          }
          setSpy(details.value);
          value = structuredClone(details.value);
        },
        clear: async () => {
          value = { proxyType: 'none' };
        },
      },
    },
    extension: { isAllowedIncognitoAccess: async () => options.incognito ?? true },
  };
  return { api, setSpy, getValue: () => value };
}

describe('firefox adapter', () => {
  it('uses manual proxy settings with remote DNS for socks5', () => {
    const settings = buildFirefoxProxySettings(target());
    expect(settings).toMatchObject({
      proxyType: 'manual',
      socks: '127.0.0.1:1080',
      socksVersion: 5,
      proxyDNS: true,
      passthrough: '<local>',
    });
  });

  it('sets socks version 4 and omits remote DNS for socks4', () => {
    const settings = buildFirefoxProxySettings(target({ connectKind: 'socks4' }));
    expect(settings.socksVersion).toBe(4);
    expect(settings.proxyDNS).toBe(false);
  });

  it('maps http proxies to both http and ssl', () => {
    const settings = buildFirefoxProxySettings(target({ connectKind: 'http', port: 8080 }));
    expect(settings.http).toBe('127.0.0.1:8080');
    expect(settings.ssl).toBe('127.0.0.1:8080');
  });

  it('applies and verifies socks settings', async () => {
    const fake = fakeFirefox();
    const adapter = new FirefoxProxyAdapter(fake.api);
    await adapter.apply(target());
    expect(fake.getValue().socks).toBe('127.0.0.1:1080');
    await expect(adapter.verifyApplied(target())).resolves.toBe(true);
    await expect(adapter.verifyApplied(target({ port: 1081 }))).resolves.toBe(false);
  });

  it('rejects https (TLS to proxy) endpoints with a clear code', async () => {
    const adapter = new FirefoxProxyAdapter(fakeFirefox().api);
    await expect(adapter.apply(target({ connectKind: 'https' }))).rejects.toMatchObject({
      code: 'UNSUPPORTED_KIND',
    });
  });

  it('rejects socks endpoints that carry credentials', async () => {
    const adapter = new FirefoxProxyAdapter(fakeFirefox().api);
    await expect(adapter.apply(target({ username: 'u', password: 'p' }))).rejects.toMatchObject({
      code: 'AUTH_UNSUPPORTED',
    });
  });

  it('translates missing private-browsing access', async () => {
    const adapter = new FirefoxProxyAdapter(fakeFirefox({ incognito: false }).api);
    await expect(adapter.apply(target())).rejects.toMatchObject({ code: 'INCOGNITO_REQUIRED' });
  });

  it('reports firefox capabilities without https support', async () => {
    const adapter = new FirefoxProxyAdapter(fakeFirefox().api);
    const capabilities = await adapter.getCapabilities();
    expect(capabilities.supportedConnectKinds).toEqual(['socks5', 'socks4', 'http']);
    expect(capabilities.authSupported).toEqual([]);
    expect(capabilities.webRtcGuard).toBe(false);
    expect(capabilities.incognitoAccess).toBe(true);
  });
});

describe('factory', () => {
  it('creates a firefox adapter when the browser namespace is present', () => {
    const adapter = createProxyAdapter({
      browser: fakeFirefox().api,
      isFirefox: true,
    });
    expect(adapter.browser).toBe('firefox');
  });

  it('creates a chrome adapter by default', () => {
    const adapter = createProxyAdapter({ chrome: fakeChrome().api });
    expect(adapter.browser).toBe('chrome');
  });
});
