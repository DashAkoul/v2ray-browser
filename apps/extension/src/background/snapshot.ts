import { APP_VERSION, type CapabilityProbe, type DiagnosticsReport } from '@v2rb/shared';
import type { ConnectionController, SubscriptionService, ProfileService, SettingsService } from '@v2rb/core';
import type { DatabaseStore } from '@v2rb/storage';
import { isFirefoxRuntime } from '../shared/browser';
import type { AppSnapshot } from '../shared/protocol';

export interface BackgroundServices {
  store: DatabaseStore;
  profiles: ProfileService;
  settings: SettingsService;
  subscriptions: SubscriptionService;
  controller: ConnectionController;
}

export async function buildSnapshot(services: BackgroundServices): Promise<AppSnapshot> {
  const db = await services.store.read();
  const connection = services.controller.getState();
  return {
    connection,
    settings: db.settings,
    profiles: db.profiles,
    subscriptions: db.subscriptions,
    capabilities: connection.capabilities,
    issues: services.store.getIssues(),
    browser: isFirefoxRuntime() ? 'firefox' : 'chrome',
    version: APP_VERSION,
  };
}

function readGlobal(path: string[]): unknown {
  let value: unknown = globalThis;
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * Runtime capability probe shown in Diagnostics. It records what the extension
 * environment actually exposes, including the APIs a browser-only proxy needs.
 */
export function probeCapabilities(): CapabilityProbe[] {
  const firefox = isFirefoxRuntime();
  const hasTcpSockets = typeof readGlobal(['chrome', 'sockets', 'tcp']) === 'object';
  const hasUdpSockets = typeof readGlobal(['chrome', 'sockets', 'udp']) === 'object';
  const hasListen = typeof readGlobal(['chrome', 'sockets', 'tcpServer']) === 'object';
  const hasNativeMessaging = typeof readGlobal(['chrome', 'runtime', 'connectNative']) === 'function';
  return [
    {
      id: 'proxy-api',
      label: 'Browser proxy configuration API',
      available: typeof readGlobal(['chrome', 'proxy', 'settings']) === 'object' || typeof readGlobal(['browser', 'proxy', 'settings']) === 'object',
      detail: 'Used for the only real routing path a browser extension has.',
    },
    {
      id: 'tcp-sockets',
      label: 'Raw TCP socket API',
      available: hasTcpSockets,
      detail: 'Chrome Apps API only; never available to Manifest V3 extensions.',
    },
    {
      id: 'udp-sockets',
      label: 'Raw UDP socket API',
      available: hasUdpSockets,
      detail: 'Required by QUIC-based protocols such as Hysteria2.',
    },
    {
      id: 'listen-sockets',
      label: 'Local listening socket',
      available: hasListen,
      detail: 'Needed for a local proxy server; extensions cannot open one.',
    },
    {
      id: 'native-messaging',
      label: 'Native messaging bridge',
      available: hasNativeMessaging,
      detail: 'Requires an installed companion application, which this project does not use.',
    },
    {
      id: 'wasm',
      label: 'WebAssembly runtime',
      available: typeof WebAssembly !== 'undefined',
      detail: 'WASM runs, but receives no socket host functions in a browser.',
    },
    {
      id: 'background',
      label: firefox ? 'Event page background' : 'Service worker background',
      available: true,
      detail: firefox
        ? 'Firefox runs background scripts instead of a service worker.'
        : 'Chrome terminates idle workers; state is reconciled on wake.',
    },
  ];
}

export async function buildDiagnostics(services: BackgroundServices): Promise<DiagnosticsReport> {
  const db = await services.store.read();
  const connection = services.controller.getState();
  return {
    appVersion: APP_VERSION,
    browser: isFirefoxRuntime() ? 'firefox' : 'chrome',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    schemaVersion: db.schemaVersion,
    profileCount: db.profiles.length,
    subscriptionCount: db.subscriptions.length,
    capabilities: connection.capabilities,
    probe: probeCapabilities(),
    lastError: connection.error,
    issues: services.store.getIssues().map((issue) => `${issue.kind}: ${issue.message}`),
    generatedAt: Date.now(),
  };
}
