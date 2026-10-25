import type { ProxyCapabilities } from '@v2rb/shared';
import {
  ProxyAdapterError,
  hasCredentials,
  toHostPort,
  type ProxyAdapter,
  type ProxySnapshot,
  type ProxyTarget,
} from './types';

export interface FirefoxProxySettingsValue {
  proxyType: 'none' | 'manual' | 'autoDetect' | 'system' | 'autoConfig';
  http?: string;
  ssl?: string;
  socks?: string;
  socksVersion?: number;
  proxyDNS?: boolean;
  passthrough?: string;
  autoConfigUrl?: string;
}

export interface FirefoxApi {
  proxy: {
    settings: {
      get(details?: Record<string, unknown>): Promise<{ value: FirefoxProxySettingsValue; levelOfControl?: string }>;
      set(details: { value: FirefoxProxySettingsValue }): Promise<void>;
      clear(details?: Record<string, unknown>): Promise<void>;
    };
  };
  extension?: {
    isAllowedIncognitoAccess?: () => Promise<boolean>;
  };
}

function settingsOrThrow(api: FirefoxApi) {
  const settings = api.proxy?.settings;
  if (!settings) {
    throw new ProxyAdapterError('UNAVAILABLE', 'browser.proxy.settings is not available');
  }
  return settings;
}

function isControllable(levelOfControl: string | undefined): boolean {
  return levelOfControl === undefined || levelOfControl === 'controllable_by_this_extension' || levelOfControl === 'controlled_by_this_extension';
}

export function buildFirefoxProxySettings(target: ProxyTarget): FirefoxProxySettingsValue {
  const passthrough = target.bypassList.length > 0 ? target.bypassList.join(',') : '<local>';
  if (target.connectKind === 'socks5' || target.connectKind === 'socks4') {
    return {
      proxyType: 'manual',
      socks: toHostPort(target.host, target.port),
      socksVersion: target.connectKind === 'socks4' ? 4 : 5,
      proxyDNS: target.connectKind === 'socks5',
      passthrough,
    };
  }
  const endpoint = toHostPort(target.host, target.port);
  return {
    proxyType: 'manual',
    http: endpoint,
    ssl: endpoint,
    passthrough,
  };
}

function normalize(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function settingsMatch(value: FirefoxProxySettingsValue | undefined, target: ProxyTarget): boolean {
  if (!value || value.proxyType !== 'manual') return false;
  const expected = buildFirefoxProxySettings(target);
  if (normalize(value.socks) !== normalize(expected.socks)) return false;
  if (normalize(value.http) !== normalize(expected.http)) return false;
  if (normalize(value.ssl) !== normalize(expected.ssl)) return false;
  if (expected.socksVersion !== undefined && value.socksVersion !== expected.socksVersion) return false;
  return true;
}

function mapError(error: unknown, fallbackCode: 'APPLY_FAILED' | 'RESTORE_FAILED'): ProxyAdapterError {
  const message = error instanceof Error ? error.message : String(error);
  if (/incognito|private browsing/i.test(message)) {
    return new ProxyAdapterError(
      'INCOGNITO_REQUIRED',
      'Firefox requires private-browsing access before proxy settings can be changed',
      message,
    );
  }
  return new ProxyAdapterError(fallbackCode, message || 'Firefox rejected the proxy configuration', message);
}

export class FirefoxProxyAdapter implements ProxyAdapter {
  readonly browser = 'firefox' as const;

  constructor(private readonly api: FirefoxApi) {}

  async getCapabilities(): Promise<ProxyCapabilities> {
    const notes: string[] = [];
    let controllable = false;
    let incognitoAccess = false;
    try {
      const settings = settingsOrThrow(this.api);
      const current = await settings.get({});
      controllable = isControllable(current.levelOfControl);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'Proxy API unavailable');
    }
    try {
      incognitoAccess = (await this.api.extension?.isAllowedIncognitoAccess?.()) ?? false;
    } catch {
      incognitoAccess = false;
    }
    if (!incognitoAccess) {
      notes.push('Firefox needs access to private browsing windows to apply proxy settings.');
    }
    notes.push('TLS-to-proxy (https://) endpoints are not exposed by Firefox proxy settings.');
    notes.push('browser.proxy.settings cannot transmit proxy credentials.');
    return {
      browser: 'firefox',
      proxyApi: Boolean(this.api.proxy?.settings),
      controllable,
      ...(controllable ? {} : { controlNote: notes[0] }),
      incognitoAccess,
      webRtcGuard: false,
      supportedConnectKinds: ['socks5', 'socks4', 'http'],
      // browser.proxy.settings has no credential fields, and embedding userinfo
      // in the proxy string is not a documented, testable contract. Report the
      // truth: no endpoint authentication from the extension.
      authSupported: [],
      notes,
    };
  }

  async capture(): Promise<ProxySnapshot> {
    const settings = settingsOrThrow(this.api);
    const current = await settings.get({});
    return { browser: 'firefox', capturedAt: Date.now(), proxy: current.value };
  }

  async apply(target: ProxyTarget): Promise<void> {
    if (target.connectKind === 'https') {
      throw new ProxyAdapterError(
        'UNSUPPORTED_KIND',
        'Firefox proxy settings cannot express a TLS connection to the proxy itself',
        'Use an http:// or socks5:// endpoint in Firefox.',
      );
    }
    if (hasCredentials(target)) {
      throw new ProxyAdapterError(
        'AUTH_UNSUPPORTED',
        'Firefox cannot supply proxy credentials from an extension',
        'Use an endpoint that does not require authentication.',
      );
    }
    const settings = settingsOrThrow(this.api);
    try {
      const current = await settings.get({});
      if (!isControllable(current.levelOfControl)) {
        throw new ProxyAdapterError(
          'CONTROLLED',
          'Proxy settings are controlled by another add-on or policy',
          `levelOfControl=${current.levelOfControl ?? 'unknown'}`,
        );
      }
      await settings.set({ value: buildFirefoxProxySettings(target) });
    } catch (error) {
      if (error instanceof ProxyAdapterError) throw error;
      throw mapError(error, 'APPLY_FAILED');
    }
  }

  async verifyApplied(target: ProxyTarget): Promise<boolean> {
    try {
      const settings = settingsOrThrow(this.api);
      const current = await settings.get({});
      return settingsMatch(current.value, target);
    } catch {
      return false;
    }
  }

  async restore(snapshot: ProxySnapshot | undefined): Promise<void> {
    const settings = settingsOrThrow(this.api);
    try {
      if (snapshot && snapshot.proxy && typeof snapshot.proxy === 'object') {
        await settings.set({ value: snapshot.proxy as FirefoxProxySettingsValue });
      } else {
        await settings.clear({});
      }
    } catch (error) {
      throw mapError(error, 'RESTORE_FAILED');
    }
  }

  async setLeakProtection(): Promise<boolean> {
    return false;
  }
}
