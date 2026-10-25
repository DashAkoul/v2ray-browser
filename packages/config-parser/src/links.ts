import type { ConnectKind, ParsedProfile, ParseResult } from './types';
import type { SecurityType, TransportType } from '@v2rb/shared';
import {
  buildDraft,
  collectUnknown,
  decodeSafe,
  fail,
  fragmentName,
  isUuid,
  normalizeHost,
  ok,
  parseBool,
  parsePort,
  resolveOptions,
  type ParseOptions,
} from './util';
import { decodeBase64String } from './base64';

export const SHARE_SCHEMES = [
  'vless',
  'vmess',
  'trojan',
  'ss',
  'ssr',
  'hysteria2',
  'hy2',
  'wireguard',
  'wg',
  'socks',
  'socks5',
  'socks5h',
  'socks4',
  'socks4a',
  'http',
  'https',
] as const;

export type ShareScheme = (typeof SHARE_SCHEMES)[number];

export function detectScheme(input: string): ShareScheme | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input.trim());
  if (!match) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  return (SHARE_SCHEMES as readonly string[]).includes(scheme) ? (scheme as ShareScheme) : null;
}

export function isSupportedLink(input: string): boolean {
  return detectScheme(input) !== null;
}

const TRANSPORT_MAP: Record<string, TransportType> = {
  tcp: 'tcp',
  raw: 'tcp',
  ws: 'ws',
  websocket: 'ws',
  grpc: 'grpc',
  gun: 'grpc',
  http: 'http',
  h2: 'h2',
  quic: 'quic',
  kcp: 'mkcp',
  mkcp: 'mkcp',
  httpupgrade: 'httpupgrade',
  xhttp: 'xhttp',
  splithttp: 'xhttp',
};

function readTransportType(raw: string | null | undefined): TransportType {
  if (!raw) return 'tcp';
  return TRANSPORT_MAP[raw.trim().toLowerCase()] ?? 'tcp';
}

interface TransportAndSecurity {
  transport: {
    type: TransportType;
    path?: string;
    host?: string;
    serviceName?: string;
    mode?: string;
  };
  security: {
    type: SecurityType;
    sni?: string;
    alpn?: string[];
    fingerprint?: string;
    publicKey?: string;
    shortId?: string;
    allowInsecure?: boolean;
  };
}

function readTransportAndSecurity(params: URLSearchParams): TransportAndSecurity {
  const type = readTransportType(params.get('type') ?? params.get('net'));
  const pathRaw = params.get('path');
  const hostRaw = params.get('host') ?? params.get('obfsParam') ?? undefined;
  const serviceRaw = params.get('serviceName');
  const securityRaw = (params.get('security') ?? params.get('tls') ?? 'none').toLowerCase();
  const type2: SecurityType =
    securityRaw === 'reality' ? 'reality' : securityRaw === 'tls' || securityRaw === 'xtls' ? 'tls' : 'none';
  const alpnRaw = params.get('alpn');
  const insecure = parseBool(params.get('allowInsecure') ?? params.get('insecure') ?? params.get('allow_insecure'));

  const transport: TransportAndSecurity['transport'] = { type };
  if (pathRaw) transport.path = decodeSafe(pathRaw);
  if (hostRaw) transport.host = hostRaw;
  if (serviceRaw || (type === 'grpc' && pathRaw)) {
    transport.serviceName = decodeSafe((serviceRaw ?? pathRaw) as string);
  }
  const mode = params.get('mode');
  if (mode) transport.mode = mode;

  const sni = params.get('sni') ?? params.get('peer') ?? (type2 !== 'none' ? hostRaw : undefined);
  const security: TransportAndSecurity['security'] = { type: type2 };
  if (sni) security.sni = sni;
  if (alpnRaw) {
    const alpn = alpnRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (alpn.length > 0) security.alpn = alpn;
  }
  const fp = params.get('fp');
  if (fp) security.fingerprint = fp;
  const pbk = params.get('pbk');
  if (pbk) security.publicKey = pbk;
  const sid = params.get('sid');
  if (sid) security.shortId = sid;
  if (insecure) security.allowInsecure = true;
  return { transport, security };
}

function baseName(name: string | undefined, host: string, port: number): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : `${host}:${port}`;
}

function parseUuidLink(
  raw: string,
  url: URL,
  protocol: 'vless' | 'vmess',
  options: ReturnType<typeof resolveOptions>,
): ParseResult<ParsedProfile> {
  const id = decodeSafe(url.username);
  if (!isUuid(id)) {
    return fail('INVALID_UUID', `${protocol.toUpperCase()} needs a valid UUID user id`, 'id');
  }
  const host = normalizeHost(url.hostname);
  if (!host) return fail('INVALID_HOST', 'Host is missing from the link', 'host');
  const port = parsePort(url.port);
  if (port === null) {
    return fail(url.port ? 'INVALID_PORT' : 'MISSING_PORT', 'A valid port (1-65535) is required', 'port');
  }
  const encryption = url.searchParams.get('encryption');
  if (encryption && encryption.toLowerCase() !== 'none') {
    return fail('UNSUPPORTED_PROTOCOL_VERSION', 'Only VLESS/TCP without legacy encryption is supported');
  }
  const { transport, security } = readTransportAndSecurity(url.searchParams);
  const flow = url.searchParams.get('flow') ?? undefined;
  const draft = buildDraft(
    {
      name: baseName(fragmentName(url), host, port),
      protocol,
      host,
      port,
      credentials: {
        kind: 'uuid',
        uuid: id,
        ...(flow ? { flow } : {}),
      },
      transport,
      security,
      unknown: collectUnknown(url.searchParams, new Set()),
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* VMess                                                               */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function parseVmessQuery(raw: string, payload: string, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  let url: URL;
  try {
    url = new URL(`vmess://${payload}`);
  } catch {
    return fail('MALFORMED', 'VMess link could not be parsed');
  }
  const result = parseUuidLink(raw, url, 'vmess', options);
  return result;
}

function parseVmess(raw: string, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const body = raw.slice('vmess://'.length);
  const hashIndex = body.indexOf('#');
  const payload = (hashIndex >= 0 ? body.slice(0, hashIndex) : body).trim();
  const hashName = hashIndex >= 0 ? decodeSafe(body.slice(hashIndex + 1)).trim() : undefined;
  if (!payload) return fail('EMPTY', 'VMess link is empty');

  if (payload.includes('@')) {
    return parseVmessQuery(raw, payload, options);
  }

  const decoded = decodeBase64String(payload);
  if (!decoded) return fail('BASE64', 'VMess payload is not valid base64');
  let json: unknown;
  try {
    json = JSON.parse(decoded);
  } catch {
    return fail('JSON', 'VMess payload is not valid JSON');
  }
  const obj = asRecord(json);
  if (!obj) return fail('JSON', 'VMess payload must be a JSON object');

  const hostRaw = str(obj['add']);
  const port = parsePort(str(obj['port']));
  const id = str(obj['id']);
  if (!hostRaw) return fail('INVALID_HOST', 'VMess JSON is missing "add"', 'add');
  if (port === null) return fail('INVALID_PORT', 'VMess JSON is missing a valid "port"', 'port');
  if (!id || !isUuid(id)) return fail('INVALID_UUID', 'VMess JSON is missing a valid "id"', 'id');

  const host = normalizeHost(hostRaw);
  const net = str(obj['net']);
  const type = readTransportType(net);
  const tlsRaw = (str(obj['tls']) ?? '').toLowerCase();
  const securityType: SecurityType = tlsRaw === 'reality' ? 'reality' : tlsRaw === 'tls' ? 'tls' : 'none';
  const wsHost = str(obj['host']);
  const path = str(obj['path']);
  const sni = str(obj['sni']) ?? (securityType !== 'none' ? wsHost : undefined);
  const alpnRaw = str(obj['alpn']);
  const alpn = alpnRaw
    ? alpnRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : undefined;
  const ps = str(obj['ps']) ?? hashName;
  const unknown: Record<string, string> = {};
  for (const key of ['aid', 'scy', 'v', 'type', 'sni']) {
    const value = str(obj[key]);
    if (value !== undefined) unknown[key] = value;
  }

  const draft = buildDraft(
    {
      name: baseName(ps, host, port),
      protocol: 'vmess',
      host,
      port,
      credentials: { kind: 'uuid', uuid: id },
      transport: {
        type,
        ...(path ? { path } : {}),
        ...(wsHost ? { host: wsHost } : {}),
        ...(type === 'grpc' && path ? { serviceName: path } : {}),
      },
      security: {
        type: securityType,
        ...(sni ? { sni } : {}),
        ...(alpn ? { alpn } : {}),
        ...(str(obj['fp']) ? { fingerprint: str(obj['fp']) as string } : {}),
      },
      unknown,
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* Trojan                                                              */
/* ------------------------------------------------------------------ */

function parseTrojan(raw: string, url: URL, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const password = decodeSafe(url.username);
  if (!password) return fail('INVALID_PASSWORD', 'Trojan link is missing the password', 'password');
  const host = normalizeHost(url.hostname);
  if (!host) return fail('INVALID_HOST', 'Host is missing from the link', 'host');
  const port = parsePort(url.port);
  if (port === null) {
    return fail(url.port ? 'INVALID_PORT' : 'MISSING_PORT', 'A valid port (1-65535) is required', 'port');
  }
  const { transport, security } = readTransportAndSecurity(url.searchParams);
  if (security.type === 'none' && !url.searchParams.get('security')) {
    security.type = 'tls';
    const sni = url.searchParams.get('sni') ?? url.searchParams.get('peer');
    if (sni) security.sni = sni;
    else if (transport.host) security.sni = transport.host;
  }
  const draft = buildDraft(
    {
      name: baseName(fragmentName(url), host, port),
      protocol: 'trojan',
      host,
      port,
      credentials: { kind: 'password', password },
      transport,
      security,
      unknown: collectUnknown(url.searchParams, new Set()),
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* Shadowsocks                                                         */
/* ------------------------------------------------------------------ */

const SS_METHOD_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;

function splitHostPort(value: string): { host: string; port: number } | null {
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end < 0) return null;
    const host = trimmed.slice(1, end);
    const rest = trimmed.slice(end + 1);
    if (!rest.startsWith(':')) return null;
    const port = parsePort(rest.slice(1));
    return port === null ? null : { host, port };
  }
  const lastColon = trimmed.lastIndexOf(':');
  if (lastColon <= 0) return null;
  const host = trimmed.slice(0, lastColon);
  const port = parsePort(trimmed.slice(lastColon + 1));
  if (!host || port === null) return null;
  return { host, port };
}

function parseShadowsocks(raw: string, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const body = raw.slice('ss://'.length);
  const hashIndex = body.indexOf('#');
  const main = hashIndex >= 0 ? body.slice(0, hashIndex) : body;
  const name = hashIndex >= 0 ? decodeSafe(body.slice(hashIndex + 1)).trim() : undefined;
  const queryIndex = main.indexOf('?');
  const queryRaw = queryIndex >= 0 ? main.slice(queryIndex + 1) : '';
  const withoutQuery = queryIndex >= 0 ? main.slice(0, queryIndex) : main;
  const plugin = new URLSearchParams(queryRaw).get('plugin') ?? undefined;

  let method: string | undefined;
  let password: string | undefined;
  let hostPart: string | undefined;

  const atIndex = withoutQuery.lastIndexOf('@');
  if (atIndex >= 0) {
    const userinfo = withoutQuery.slice(0, atIndex);
    hostPart = withoutQuery.slice(atIndex + 1);
    const decodedUserinfo = decodeSafe(userinfo);
    if (decodedUserinfo.includes(':')) {
      const separator = decodedUserinfo.indexOf(':');
      method = decodedUserinfo.slice(0, separator);
      password = decodedUserinfo.slice(separator + 1);
    } else {
      const decoded = decodeBase64String(userinfo);
      if (decoded && decoded.includes(':')) {
        const separator = decoded.indexOf(':');
        method = decoded.slice(0, separator);
        password = decoded.slice(separator + 1);
      }
    }
  } else {
    const decoded = decodeBase64String(withoutQuery);
    if (decoded) {
      const innerAt = decoded.lastIndexOf('@');
      if (innerAt >= 0) {
        const userinfo = decoded.slice(0, innerAt);
        hostPart = decoded.slice(innerAt + 1);
        const separator = userinfo.indexOf(':');
        if (separator > 0) {
          method = userinfo.slice(0, separator);
          password = userinfo.slice(separator + 1);
        }
      }
    }
  }

  if (!method || !password || !hostPart) {
    return fail('MALFORMED', 'Shadowsocks link is missing method, password or host');
  }
  if (!SS_METHOD_RE.test(method)) {
    return fail('INVALID_METHOD', `Unsupported Shadowsocks method "${method}"`, 'method');
  }
  const parsedEndpoint = splitHostPort(hostPart);
  if (!parsedEndpoint) return fail('MALFORMED', 'Shadowsocks link has an invalid host:port');
  const host = normalizeHost(parsedEndpoint.host);

  const unknown: Record<string, string> = {};
  if (plugin) unknown['plugin'] = decodeSafe(plugin);

  const draft = buildDraft(
    {
      name: baseName(name, host, parsedEndpoint.port),
      protocol: 'shadowsocks',
      host,
      port: parsedEndpoint.port,
      credentials: { kind: 'method-password', method, password },
      unknown,
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

function parseShadowsocksR(raw: string, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const payload = raw.slice('ssr://'.length).trim();
  const decoded = decodeBase64String(payload);
  if (!decoded) return fail('BASE64', 'ShadowsocksR link is not valid base64');
  const [mainPart, queryPart = ''] = decoded.split('/?', 2);
  const parts = (mainPart ?? '').split(':');
  if (parts.length < 6) return fail('MALFORMED', 'ShadowsocksR payload is incomplete');
  const secretRaw = parts[5] ?? '';
  const password = decodeBase64String(secretRaw) ?? secretRaw;
  const host = normalizeHost(parts[0] ?? '');
  const port = parsePort(parts[1]);
  const method = parts[3] ?? '';
  if (!host || port === null || !method || !password) {
    return fail('MALFORMED', 'ShadowsocksR payload is incomplete');
  }
  const query = new URLSearchParams(queryPart);
  const remarksRaw = query.get('remarks');
  const remarks = remarksRaw ? decodeBase64String(remarksRaw) ?? undefined : undefined;
  const draft = buildDraft(
    {
      name: baseName(remarks ?? undefined, host, port),
      protocol: 'shadowsocksr',
      host,
      port,
      credentials: { kind: 'method-password', method, password },
      unknown: {
        protocol: parts[2] ?? '',
        obfs: parts[4] ?? '',
        ...(query.get('obfsparam') ? { obfsparam: query.get('obfsparam') as string } : {}),
      },
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* Hysteria2                                                           */
/* ------------------------------------------------------------------ */

function parseHysteria2(raw: string, url: URL, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const host = normalizeHost(url.hostname);
  if (!host) return fail('INVALID_HOST', 'Host is missing from the link', 'host');
  const port = parsePort(url.port);
  if (port === null) {
    return fail(url.port ? 'INVALID_PORT' : 'MISSING_PORT', 'A valid port (1-65535) is required', 'port');
  }
  const auth = [decodeSafe(url.username), decodeSafe(url.password)].filter(Boolean).join(':');
  const params = url.searchParams;
  const sni = params.get('sni') ?? params.get('peer') ?? undefined;
  const alpnRaw = params.get('alpn');
  const alpn = alpnRaw
    ? alpnRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : undefined;
  const insecure = parseBool(params.get('insecure'));
  const unknown: Record<string, string> = {};
  for (const key of ['obfs', 'obfs-password', 'pinSHA256', 'ech', 'mport']) {
    const value = params.get(key);
    if (value) unknown[key] = value;
  }
  const draft = buildDraft(
    {
      name: baseName(fragmentName(url), host, port),
      protocol: 'hysteria2',
      host,
      port,
      credentials: { kind: 'password', password: auth || 'anonymous' },
      transport: { type: 'quic', ...(params.get('mport') ? { mode: 'port-hopping' } : {}) },
      security: {
        type: 'tls',
        ...(sni ? { sni } : {}),
        ...(alpn ? { alpn } : {}),
        ...(insecure ? { allowInsecure: true } : {}),
      },
      unknown,
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* WireGuard                                                           */
/* ------------------------------------------------------------------ */

function parseWireGuard(raw: string, url: URL, options: ReturnType<typeof resolveOptions>): ParseResult<ParsedProfile> {
  const host = normalizeHost(url.hostname);
  if (!host) return fail('INVALID_HOST', 'Host is missing from the link', 'host');
  const port = parsePort(url.port);
  if (port === null) {
    return fail(url.port ? 'INVALID_PORT' : 'MISSING_PORT', 'A valid port (1-65535) is required', 'port');
  }
  const params = url.searchParams;
  const unknown: Record<string, string> = {};
  for (const key of ['publickey', 'address', 'mtu', 'dns', 'allowedips', 'reserved', 'privatekey']) {
    const value = params.get(key);
    if (value) unknown[key] = value;
  }
  const privateKey = decodeSafe(url.username) || (params.get('privatekey') ?? '');
  const draft = buildDraft(
    {
      name: baseName(fragmentName(url), host, port),
      protocol: 'wireguard',
      host,
      port,
      credentials: privateKey ? { kind: 'password', password: privateKey } : { kind: 'none' },
      transport: { type: 'tcp' },
      unknown,
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* SOCKS / HTTP proxies (the connectable families)                     */
/* ------------------------------------------------------------------ */

function connectKindForScheme(scheme: string): ConnectKind {
  switch (scheme) {
    case 'socks4':
    case 'socks4a':
      return 'socks4';
    case 'http':
      return 'http';
    case 'https':
      return 'https';
    default:
      return 'socks5';
  }
}

function defaultPortForScheme(scheme: string): number | null {
  if (scheme === 'socks' || scheme.startsWith('socks')) return 1080;
  return null;
}

function parseSocksLike(
  raw: string,
  url: URL,
  scheme: string,
  options: ReturnType<typeof resolveOptions>,
): ParseResult<ParsedProfile> {
  const host = normalizeHost(url.hostname);
  if (!host) return fail('INVALID_HOST', 'Host is missing from the link', 'host');
  const explicitPort = url.port;
  const port = parsePort(explicitPort) ?? defaultPortForScheme(scheme);
  if (port === null) {
    return fail(
      'MISSING_PORT',
      `${scheme.toUpperCase()} links need an explicit port, for example ${scheme}://${host}:8080`,
      'port',
    );
  }
  const connectKind = connectKindForScheme(scheme);
  const username = decodeSafe(url.username) || undefined;
  const password = decodeSafe(url.password) || undefined;
  const protocol = connectKind === 'socks4' ? 'socks4' : connectKind === 'https' ? 'https' : connectKind === 'http' ? 'http' : 'socks5';
  const draft = buildDraft(
    {
      name: baseName(fragmentName(url), host, port),
      protocol,
      host,
      port,
      connectKind,
      credentials:
        username || password
          ? {
              kind: 'password',
              ...(password ? { password } : {}),
              ...(username ? { username } : {}),
            }
          : { kind: 'none' },
      transport: { type: 'tcp' },
      unknown: collectUnknown(url.searchParams, new Set()),
      rawUri: raw,
    },
    options,
  );
  return ok(draft);
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function parseShareLink(rawInput: string, options?: ParseOptions): ParseResult<ParsedProfile> {
  const optionsResolved = resolveOptions(options);
  const cleaned = rawInput.trim().replace(/^<(.*)>$/s, '$1').trim();
  if (!cleaned) return fail('EMPTY', 'Paste a configuration link first');
  if (new TextEncoder().encode(cleaned).length > optionsResolved.maxBytes) {
    return fail('TOO_LARGE', 'Configuration link is too large');
  }
  if (/[\r\n]/.test(cleaned)) {
    return fail('MALFORMED', 'Import one link per line');
  }
  const scheme = detectScheme(cleaned);
  if (!scheme) return fail('UNSUPPORTED_SCHEME', 'Unsupported or missing URI scheme');

  if (scheme === 'vmess') return parseVmess(cleaned, optionsResolved);
  if (scheme === 'ss') return parseShadowsocks(cleaned, optionsResolved);
  if (scheme === 'ssr') return parseShadowsocksR(cleaned, optionsResolved);

  let url: URL;
  try {
    url = new URL(cleaned);
  } catch {
    const portMatch = /:(\d{1,6})(?:[/?#]|$)/.exec(cleaned);
    if (portMatch) {
      const port = Number(portMatch[1]);
      if (port > 65535 || port < 1) return fail('INVALID_PORT', 'Port must be between 1 and 65535', 'port');
    }
    return fail('MALFORMED', 'The link is not a valid URI');
  }

  switch (scheme) {
    case 'vless':
      return parseUuidLink(cleaned, url, 'vless', optionsResolved);
    case 'trojan':
      return parseTrojan(cleaned, url, optionsResolved);
    case 'hysteria2':
    case 'hy2':
      return parseHysteria2(cleaned, url, optionsResolved);
    case 'wireguard':
    case 'wg':
      return parseWireGuard(cleaned, url, optionsResolved);
    case 'socks':
    case 'socks5':
    case 'socks5h':
    case 'socks4':
    case 'socks4a':
    case 'http':
    case 'https':
      return parseSocksLike(cleaned, url, scheme, optionsResolved);
    default:
      return fail('UNSUPPORTED_SCHEME', `Unsupported scheme "${scheme}"`);
  }
}
