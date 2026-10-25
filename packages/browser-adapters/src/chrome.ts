import type { ConnectKind, ProxyCapabilities } from '@v2rb/shared';
import {
  ProxyAdapterError,
  hasCredentials,
  toHostPort,
  type ProxyAdapter,
  type ProxySnapshot,
  type ProxyTarget,
} from './types';

export interface ChromeProxySettingsValue {
  mode: 'direct' | 'auto_detect' | 'pac_script' | 'fixed_servers' | 'system';
  rules?: {
    singleProxy?: { scheme?: string; host: string; port: number };
    bypassList?: string[];
  };
  pacScript?: { url?: string; data?: string; mandatory?: boolean };
}

export interface ChromeApi {
  proxy: {
    settings: {
      get(details?: { incognito?: boolean }): Promise<{ value: unknown; levelOfControl?: string }>;
      set(details: { value: unknown; scope?: 'regular' | 'regular_only' | 'incognito_persistent' }): Promise<void>;
      clear(details?: { scope?: 'regular' | 'regular_only' | 'incognito_persistent' }): Promise<void>;
    };
  };
  privacy?: {
    network?: {
      webRTCIPHandlingPolicy?: {
        get(details?: { incognito?: boolean }): Promise<{ value: string }>;
        set(details: { value: string; scope?: string }): Promise<void>;
      };
    };
  };
}

const SCHEME_BY_KIND: Record<ConnectKind, string> = {
  socks5: 'socks5',
  socks4: 'socks4',
  http: 'http',
  https: 'https',
};

function isControllable(levelOfControl: string | undefined): boolean {
  return levelOfControl === 'controllable_by_this_extension' || levelOfControl === 'controlled_by_this_extension';
}

function controlNote(levelOfControl: string | undefined): string | undefined {
  if (levelOfControl === 'controlled_by_other_extensions') {
    return 'Another extension currently controls proxy settings.';
  }
  if (levelOfControl === 'not_controllable') {
    return 'Proxy settings are managed by an enterprise policy.';
  }
  return undefined;
}

export function buildChromeProxyConfig(target: ProxyTarget): ChromeProxySettingsValue {
  const bypass = target.bypassList.length > 0 ? target.bypassList : ['<local>'];
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: SCHEME_BY_KIND[target.connectKind],
        host: target.host,
        port: target.port,
      },
      bypassList: bypass,
    },
  };
}

function configsMatch(value: unknown, target: ProxyTarget): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const config = value as ChromeProxySettingsValue;
  if (config.mode !== 'fixed_servers') return false;
  const proxy = config.rules?.singleProxy;
  if (!proxy) return false;
  if (proxy.host !== target.host) return false;
  if (Number(proxy.port) !== target.port) return false;
  const expectedScheme = SCHEME_BY_KIND[target.connectKind];
  if ((proxy.scheme ?? 'http') !== expectedScheme) return false;
  return true;
}

export class ChromeProxyAdapter implements ProxyAdapter {
  readonly browser = 'chrome' as const;

  constructor(private readonly api: ChromeApi) {}

  private settingsOrThrow() {
    const settings = this.api.proxy?.settings;
    if (!settings) {
      throw new ProxyAdapterError('UNAVAILABLE', 'chrome.proxy API is not available in this browser');
    }
    return settings;
  }

  async getCapabilities(): Promise<ProxyCapabilities> {
    const notes: string[] = [];
    let controllable = false;
    try {
      const settings = this.settingsOrThrow();
      const current = await settings.get({ incognito: false });
      controllable = isControllable(current.levelOfControl);
      const note = controlNote(current.levelOfControl);
      if (note && !controllable) notes.push(note);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : 'Proxy API unavailable');
    }
    notes.push('Chrome does not expose proxy credentials to extensions (Manifest V3).');
    return {
      browser: 'chrome',
      proxyApi: Boolean(this.api.proxy?.settings),
      controllable,
      ...(controllable ? {} : { controlNote: notes[0] }),
      incognitoAccess: true,
      webRtcGuard: Boolean(this.api.privacy?.network?.webRTCIPHandlingPolicy),
      supportedConnectKinds: ['socks5', 'socks4', 'http', 'https'],
      authSupported: [],
      notes,
    };
  }

  async capture(): Promise<ProxySnapshot> {
    const settings = this.settingsOrThrow();
    const current = await settings.get({ incognito: false });
    let webRtcPolicy: string | undefined;
    try {
      const policy = this.api.privacy?.network?.webRTCIPHandlingPolicy;
      if (policy) {
        const existing = await policy.get({ incognito: false });
        webRtcPolicy = existing.value;
      }
    } catch {
      webRtcPolicy = undefined;
    }
    return {
      browser: 'chrome',
      capturedAt: Date.now(),
      proxy: current.value,
      ...(webRtcPolicy !== undefined ? { webRtcPolicy } : {}),
    };
  }

  async apply(target: ProxyTarget): Promise<void> {
    if (hasCredentials(target)) {
      throw new ProxyAdapterError(
        'AUTH_UNSUPPORTED',
        'Chrome cannot pass proxy credentials to an extension',
        'Use an endpoint without authentication, or configure it in the operating system.',
      );
    }
    const settings = this.settingsOrThrow();
    try {
      const current = await settings.get({ incognito: false });
      if (!isControllable(current.levelOfControl)) {
        throw new ProxyAdapterError(
          'CONTROLLED',
          controlNote(current.levelOfControl) ?? 'Proxy settings cannot be changed by this extension',
          `levelOfControl=${current.levelOfControl ?? 'unknown'}`,
        );
      }
      await settings.set({ value: buildChromeProxyConfig(target), scope: 'regular' });
    } catch (error) {
      if (error instanceof ProxyAdapterError) throw error;
      throw new ProxyAdapterError(
        'APPLY_FAILED',
        'Chrome rejected the proxy configuration',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async verifyApplied(target: ProxyTarget): Promise<boolean> {
    try {
      const settings = this.settingsOrThrow();
      const current = await settings.get({ incognito: false });
      return configsMatch(current.value, target) && isControllable(current.levelOfControl);
    } catch {
      return false;
    }
  }

  async restore(snapshot: ProxySnapshot | undefined): Promise<void> {
    const settings = this.settingsOrThrow();
    try {
      if (snapshot && snapshot.proxy !== undefined && snapshot.proxy !== null) {
        await settings.set({ value: snapshot.proxy, scope: 'regular' });
      } else {
        await settings.clear({ scope: 'regular' });
      }
      if (snapshot?.webRtcPolicy) {
        await this.setLeakProtection(snapshot.webRtcPolicy !== 'disable_non_proxied_udp');
      }
    } catch (error) {
      throw new ProxyAdapterError(
        'RESTORE_FAILED',
        'Could not restore previous proxy settings',
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async setLeakProtection(enabled: boolean): Promise<boolean> {
    const policy = this.api.privacy?.network?.webRTCIPHandlingPolicy;
    if (!policy) return false;
    try {
      await policy.set({ value: enabled ? 'disable_non_proxied_udp' : 'default', scope: 'regular' });
      return true;
    } catch {
      return false;
    }
  }
}

/** Convenience for the connection controller: endpoint label for diagnostics. */
export function describeTarget(target: ProxyTarget): string {
  return `${target.connectKind}://${toHostPort(target.host, target.port)}`;
}
