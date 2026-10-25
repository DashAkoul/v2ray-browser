/**
 * Shared domain types for V2Ray Browser.
 *
 * Terminology:
 * - A "profile" is a saved configuration entry. It may or may not be usable for
 *   routing browser traffic.
 * - `connectKind` is set only for endpoint families that the browser's own
 *   proxy stack can speak (SOCKS4/5, HTTP, HTTPS). Everything else is stored
 *   and exported, and is explicitly labelled "configuration only".
 */

export const APP_NAME = 'V2Ray Browser';
export const APP_ID = 'v2ray-browser';
export const APP_VERSION = '1.0.0';
export const EXPORT_FORMAT = 'v2ray-browser.export';
export const EXPORT_VERSION = 1;
export const DB_SCHEMA_VERSION = 1;

export const PROTOCOLS = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'shadowsocksr',
  'hysteria2',
  'wireguard',
  'socks5',
  'socks4',
  'http',
  'https',
] as const;

export type ProtocolId = (typeof PROTOCOLS)[number];

/** Proxy families the browser proxy API can actually route through. */
export const CONNECT_KINDS = ['socks5', 'socks4', 'http', 'https'] as const;
export type ConnectKind = (typeof CONNECT_KINDS)[number];

export const TRANSPORT_TYPES = [
  'tcp',
  'ws',
  'grpc',
  'http',
  'h2',
  'quic',
  'mkcp',
  'httpupgrade',
  'xhttp',
  'kcp',
] as const;
export type TransportType = (typeof TRANSPORT_TYPES)[number];

export type SecurityType = 'none' | 'tls' | 'reality';

export interface TransportSettings {
  type: TransportType;
  /** WS/HTTP path, gRPC service name is separate. */
  path?: string;
  /** Host header / WS host / gRPC authority. */
  host?: string;
  serviceName?: string;
  mode?: string;
  headers?: Record<string, string>;
}

export interface TlsSettings {
  type: SecurityType;
  sni?: string;
  alpn?: string[];
  fingerprint?: string;
  /** REALITY public key (pbk). */
  publicKey?: string;
  /** REALITY short id (sid). */
  shortId?: string;
  allowInsecure?: boolean;
}

export type CredentialKind = 'none' | 'uuid' | 'password' | 'method-password';

export interface Credentials {
  kind: CredentialKind;
  uuid?: string;
  password?: string;
  method?: string;
  flow?: string;
  /** HTTP/SOCKS proxy username (non-secret-ish but still redacted in lists). */
  username?: string;
}

export type ProfileSourceType = 'manual' | 'uri' | 'paste' | 'file' | 'clipboard' | 'subscription' | 'config';

export interface ProfileSource {
  type: ProfileSourceType;
  subscriptionId?: string;
  importedAt: number;
}

export interface Profile {
  id: string;
  name: string;
  protocol: ProtocolId;
  host: string;
  port: number;
  credentials: Credentials;
  transport: TransportSettings;
  security: TlsSettings;
  tags: string[];
  group?: string;
  source: ProfileSource;
  /** Original share link, kept verbatim for export. Contains secrets. */
  rawUri?: string;
  /** Parameters we did not understand, preserved for forward compatibility. */
  unknown: Record<string, string>;
  /** Set only when the browser proxy stack can use this endpoint directly. */
  connectKind?: ConnectKind;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
}

export interface Subscription {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  lastUpdatedAt?: number;
  lastError?: string;
  profileCount: number;
  createdAt: number;
  updatedAt: number;
}

export type LocaleSetting = 'auto' | 'en' | 'fa';
export type ThemeSetting = 'system' | 'light' | 'dark';

export interface HealthCheckSettings {
  enabled: boolean;
  url: string;
  timeoutMs: number;
}

export interface SubscriptionAutoRefresh {
  enabled: boolean;
  /** Minimum age before a startup refresh is attempted. */
  staleAfterHours: number;
}

export interface Settings {
  locale: LocaleSetting;
  theme: ThemeSetting;
  activeProfileId: string | null;
  bypassList: string[];
  healthCheck: HealthCheckSettings;
  /** Chrome-only leak guard via chrome.privacy.network. */
  webRtcLeakGuard: boolean;
  subscriptionAutoRefresh: SubscriptionAutoRefresh;
  onboardingCompleted: boolean;
}

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: number;
  app: string;
  settings?: Partial<Settings>;
  profiles: Profile[];
  subscriptions?: Subscription[];
}

/* ------------------------------------------------------------------ */
/* Connection state                                                    */
/* ------------------------------------------------------------------ */

export type ConnectionPhase = 'idle' | 'applying' | 'active' | 'error';
export type VerificationState = 'none' | 'pending' | 'ok' | 'failed' | 'skipped';

export type ConnectionErrorCode =
  | 'NO_ACTIVE_PROFILE'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_NOT_CONNECTABLE'
  | 'UNSUPPORTED_IN_BROWSER'
  | 'PROXY_API_UNAVAILABLE'
  | 'CONTROLLED_BY_OTHER'
  | 'FIREFOX_INCOGNITO_REQUIRED'
  | 'AUTH_UNSUPPORTED'
  | 'APPLY_FAILED'
  | 'VERIFY_FAILED'
  | 'RESTORE_FAILED'
  | 'TIMEOUT'
  | 'UNKNOWN';

export interface ConnectionError {
  code: ConnectionErrorCode;
  message: string;
  detail?: string;
  at: number;
}

export interface ProxyCapabilities {
  browser: 'chrome' | 'firefox';
  proxyApi: boolean;
  /** chrome.proxy levelOfControl / firefox settings ownership. */
  controllable: boolean;
  /** Browser-specific note about why control is unavailable. */
  controlNote?: string;
  incognitoAccess: boolean;
  webRtcGuard: boolean;
  supportedConnectKinds: ConnectKind[];
  /** Kinds where an endpoint's username/password can actually be used. */
  authSupported: ConnectKind[];
  notes: string[];
}

export interface ConnectionState {
  phase: ConnectionPhase;
  profileId: string | null;
  profileName: string | null;
  profileProtocol: ProtocolId | null;
  endpoint: string | null;
  appliedAt: number | null;
  verification: VerificationState;
  latencyMs: number | null;
  error: ConnectionError | null;
  capabilities: ProxyCapabilities | null;
}

/* ------------------------------------------------------------------ */
/* Runtime persistence                                                 */
/* ------------------------------------------------------------------ */

export interface RuntimeState {
  intent: 'on' | 'off';
  profileId: string | null;
  appliedAt?: number;
  /** Opaque per-browser proxy snapshot used to restore user settings. */
  snapshot?: unknown;
  lastError?: ConnectionError;
}

/* ------------------------------------------------------------------ */
/* RPC messages                                                        */
/* ------------------------------------------------------------------ */

export type RpcRequest =
  | { type: 'state/get' }
  | { type: 'profile/add'; input: string; source?: ProfileSourceType; subscriptionId?: string }
  | { type: 'profile/add-batch'; input: string; source?: ProfileSourceType }
  | { type: 'profile/update'; id: string; patch: ProfilePatch }
  | { type: 'profile/remove'; id: string }
  | { type: 'profile/set-active'; id: string | null }
  | { type: 'profile/import-bundle'; bundle: unknown; mode: 'merge' | 'replace' }
  | { type: 'profile/export'; includeSecrets: boolean }
  | { type: 'settings/update'; patch: Partial<Settings> }
  | { type: 'connection/connect'; profileId: string }
  | { type: 'connection/disconnect' }
  | { type: 'connection/recheck' }
  | { type: 'subscription/add'; url: string; name?: string }
  | { type: 'subscription/refresh'; id: string }
  | { type: 'subscription/remove'; id: string }
  | { type: 'diagnostics/get' }
  | { type: 'data/clear'; scope: 'profiles' | 'all' };

export interface ProfilePatch {
  name?: string;
  tags?: string[];
  group?: string;
  host?: string;
  port?: number;
  credentials?: Partial<Credentials>;
  security?: Partial<TlsSettings>;
  transport?: Partial<TransportSettings>;
}

export interface DiagnosticsReport {
  appVersion: string;
  browser: 'chrome' | 'firefox' | 'unknown';
  userAgent: string;
  schemaVersion: number;
  profileCount: number;
  subscriptionCount: number;
  capabilities: ProxyCapabilities | null;
  probe: CapabilityProbe[];
  lastError: ConnectionError | null;
  issues: string[];
  generatedAt: number;
}

export interface CapabilityProbe {
  id: string;
  label: string;
  available: boolean;
  detail: string;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: 'auto',
  theme: 'system',
  activeProfileId: null,
  bypassList: ['<local>'],
  healthCheck: {
    enabled: true,
    url: 'https://www.gstatic.com/generate_204',
    timeoutMs: 4000,
  },
  webRtcLeakGuard: false,
  subscriptionAutoRefresh: { enabled: false, staleAfterHours: 24 },
  onboardingCompleted: false,
};

export const CONNECTABLE_PROTOCOLS: Record<ConnectKind, ProtocolId> = {
  socks5: 'socks5',
  socks4: 'socks4',
  http: 'http',
  https: 'https',
};

export function isConnectKind(value: string): value is ConnectKind {
  return (CONNECT_KINDS as readonly string[]).includes(value);
}

export function isProtocolId(value: string): value is ProtocolId {
  return (PROTOCOLS as readonly string[]).includes(value);
}

/** Protocols that can never be routed by a browser-only extension. */
export const CORE_PROTOCOLS: ProtocolId[] = [
  'vless',
  'vmess',
  'trojan',
  'shadowsocks',
  'shadowsocksr',
  'hysteria2',
  'wireguard',
];
