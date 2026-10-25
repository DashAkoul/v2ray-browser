import type { ConnectKind, ProxyCapabilities } from '@v2rb/shared';

export type BrowserKind = 'chrome' | 'firefox';

export interface ProxyTarget {
  connectKind: ConnectKind;
  host: string;
  port: number;
  username?: string;
  password?: string;
  bypassList: string[];
}

export interface ProxySnapshot {
  browser: BrowserKind;
  capturedAt: number;
  /** Raw browser proxy value, restored verbatim on disconnect. */
  proxy: unknown;
  /** Previous WebRTC leak policy when the browser exposes it. */
  webRtcPolicy?: string;
}

export type AdapterErrorCode =
  | 'UNAVAILABLE'
  | 'CONTROLLED'
  | 'INCOGNITO_REQUIRED'
  | 'UNSUPPORTED_KIND'
  | 'AUTH_UNSUPPORTED'
  | 'APPLY_FAILED'
  | 'VERIFY_FAILED'
  | 'RESTORE_FAILED';

export class ProxyAdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly detail: string | undefined;

  constructor(code: AdapterErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'ProxyAdapterError';
    this.code = code;
    this.detail = detail;
  }
}

export interface ProxyAdapter {
  readonly browser: BrowserKind;
  getCapabilities(): Promise<ProxyCapabilities>;
  capture(): Promise<ProxySnapshot>;
  apply(target: ProxyTarget): Promise<void>;
  verifyApplied(target: ProxyTarget): Promise<boolean>;
  restore(snapshot: ProxySnapshot | undefined): Promise<void>;
  setLeakProtection(enabled: boolean): Promise<boolean>;
}

const IPV6_RE = /^[0-9a-f:]+$/i;

export function toHostPort(host: string, port: number): string {
  const value = IPV6_RE.test(host) && host.includes(':') ? `[${host}]` : host;
  return `${value}:${port}`;
}

export function hasCredentials(target: ProxyTarget): boolean {
  return Boolean(target.username || target.password);
}
