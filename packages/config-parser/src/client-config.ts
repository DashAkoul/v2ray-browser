import type { ParsedProfile, ParseResult } from './types';
import type { SecurityType, TransportType } from '@v2rb/shared';
import { buildDraft, fail, isUuid, normalizeHost, ok, parsePort, resolveOptions, type ParseOptions } from './util';

type Json = Record<string, unknown>;

function record(value: unknown): Json | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number') return String(value);
  return undefined;
}

function num(value: unknown): number | null {
  return parsePort(value as string | number | undefined);
}

function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function mapTransport(raw: string | undefined): TransportType {
  switch ((raw ?? '').toLowerCase()) {
    case 'ws':
    case 'websocket':
      return 'ws';
    case 'grpc':
      return 'grpc';
    case 'h2':
    case 'http':
      return 'http';
    case 'quic':
      return 'quic';
    case 'kcp':
    case 'mkcp':
      return 'mkcp';
    case 'httpupgrade':
      return 'httpupgrade';
    case 'xhttp':
    case 'splithttp':
      return 'xhttp';
    default:
      return 'tcp';
  }
}

/* ------------------------------------------------------------------ */
/* Xray / v2ray JSON                                                   */
/* ------------------------------------------------------------------ */

function xrayTransport(stream: Json | null): ParsedProfile['transport'] {
  const network = asText(stream?.['network']);
  const type = mapTransport(network);
  const transport: ParsedProfile['transport'] = { type };
  const ws = record(stream?.['wsSettings']);
  const grpc = record(stream?.['grpcSettings']);
  const http = record(stream?.['httpSettings']);
  if (ws) {
    const path = asText(ws['path']);
    if (path) transport.path = path;
    const headers = record(ws['headers']);
    const host = asText(headers?.['Host']) ?? asText(headers?.['host']);
    if (host) transport.host = host;
  }
  if (grpc) {
    const service = asText(grpc['serviceName']);
    if (service) transport.serviceName = service;
  }
  if (http) {
    const path = asText(http['path']);
    if (path) transport.path = path;
    const hosts = arr(http['host']).map((entry) => asText(entry)).filter((entry): entry is string => Boolean(entry));
    if (hosts[0]) transport.host = hosts[0];
  }
  return transport;
}

function xraySecurity(stream: Json | null): ParsedProfile['security'] {
  const raw = (asText(stream?.['security']) ?? 'none').toLowerCase();
  const type: SecurityType = raw === 'reality' ? 'reality' : raw === 'tls' ? 'tls' : 'none';
  const security: ParsedProfile['security'] = { type };
  const tls = record(stream?.['tlsSettings']);
  const reality = record(stream?.['realitySettings']);
  const source = type === 'reality' ? reality : tls;
  if (!source) return security;
  const sni = asText(source['serverName']);
  if (sni) security.sni = sni;
  const alpn = arr(source['alpn']).map((entry) => asText(entry)).filter((entry): entry is string => Boolean(entry));
  if (alpn.length > 0) security.alpn = alpn;
  const fp = asText(source['fingerprint']);
  if (fp) security.fingerprint = fp;
  const pbk = asText(source['publicKey']);
  if (pbk) security.publicKey = pbk;
  const sid = asText(source['shortId']);
  if (sid) security.shortId = sid;
  if (bool(source['allowInsecure'])) security.allowInsecure = true;
  return security;
}

function parseXrayOutbound(outbound: Json, options: ReturnType<typeof resolveOptions>): ParsedProfile | null {
  const protocol = asText(outbound['protocol'])?.toLowerCase();
  if (!protocol) return null;
  const settings = record(outbound['settings']);
  const stream = record(outbound['streamSettings']);
  const tag = asText(outbound['tag']);
  if (!settings) return null;

  if (protocol === 'vless' || protocol === 'vmess') {
    const vnext = record(arr(settings['vnext'])[0]);
    if (!vnext) return null;
    const host = asText(vnext['address']);
    const port = num(vnext['port']);
    const user = record(arr(vnext['users'])[0]);
    const id = asText(user?.['id']);
    if (!host || port === null || !id) return null;
    if (!isUuid(id)) return null;
    const flow = asText(user?.['flow']);
    return buildDraft(
      {
        name: tag ?? `${normalizeHost(host)}:${port}`,
        protocol,
        host,
        port,
        credentials: { kind: 'uuid', uuid: id, ...(flow ? { flow } : {}) },
        transport: xrayTransport(stream),
        security: xraySecurity(stream),
        unknown: { importedFrom: 'xray-json' },
      },
      options,
    );
  }

  if (protocol === 'trojan') {
    const server = record(arr(settings['servers'])[0]);
    const host = asText(server?.['address']);
    const port = num(server?.['port']);
    const password = asText(server?.['password']);
    if (!host || port === null || !password) return null;
    return buildDraft(
      {
        name: tag ?? `${normalizeHost(host)}:${port}`,
        protocol: 'trojan',
        host,
        port,
        credentials: { kind: 'password', password },
        transport: xrayTransport(stream),
        security: { ...xraySecurity(stream), type: 'tls' },
        unknown: { importedFrom: 'xray-json' },
      },
      options,
    );
  }

  if (protocol === 'shadowsocks') {
    const server = record(arr(settings['servers'])[0]);
    const host = asText(server?.['address']);
    const port = num(server?.['port']);
    const method = asText(server?.['method']);
    const password = asText(server?.['password']);
    if (!host || port === null || !method || !password) return null;
    return buildDraft(
      {
        name: tag ?? `${normalizeHost(host)}:${port}`,
        protocol: 'shadowsocks',
        host,
        port,
        credentials: { kind: 'method-password', method, password },
        unknown: { importedFrom: 'xray-json' },
      },
      options,
    );
  }

  if (protocol === 'socks' || protocol === 'http') {
    const server = record(arr(settings['servers'])[0]);
    const host = asText(server?.['address']);
    const port = num(server?.['port']);
    if (!host || port === null) return null;
    const user = record(arr(server?.['users'])[0]);
    const username = asText(user?.['user']);
    const password = asText(user?.['pass']);
    const connectKind = protocol === 'socks' ? 'socks5' : 'http';
    return buildDraft(
      {
        name: tag ?? `${normalizeHost(host)}:${port}`,
        protocol: connectKind === 'socks5' ? 'socks5' : 'http',
        host,
        port,
        connectKind,
        credentials:
          username || password
            ? { kind: 'password', ...(username ? { username } : {}), ...(password ? { password } : {}) }
            : { kind: 'none' },
        unknown: { importedFrom: 'xray-json' },
      },
      options,
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* sing-box JSON                                                       */
/* ------------------------------------------------------------------ */

function singboxTls(tls: Json | null): ParsedProfile['security'] {
  if (!tls || !bool(tls['enabled'])) return { type: 'none' };
  const reality = record(tls['reality']);
  const type: SecurityType = reality && bool(reality['enabled']) ? 'reality' : 'tls';
  const security: ParsedProfile['security'] = { type };
  const sni = asText(tls['server_name']);
  if (sni) security.sni = sni;
  const alpn = arr(tls['alpn']).map((entry) => asText(entry)).filter((entry): entry is string => Boolean(entry));
  if (alpn.length > 0) security.alpn = alpn;
  const utls = record(tls['utls']);
  const fp = asText(utls?.['fingerprint']);
  if (fp) security.fingerprint = fp;
  const publicKey = reality ? asText(reality['public_key']) : undefined;
  if (publicKey) security.publicKey = publicKey;
  const shortId = reality ? asText(reality['short_id']) : undefined;
  if (shortId) security.shortId = shortId;
  if (bool(tls['insecure'])) security.allowInsecure = true;
  return security;
}

function singboxTransport(transport: Json | null): ParsedProfile['transport'] {
  if (!transport) return { type: 'tcp' };
  const type = mapTransport(asText(transport['type']));
  const result: ParsedProfile['transport'] = { type };
  const path = asText(transport['path']);
  if (path) result.path = path;
  const serviceName = asText(transport['service_name']);
  if (serviceName) result.serviceName = serviceName;
  const headers = record(transport['headers']);
  const host = asText(headers?.['Host']) ?? asText(headers?.['host']);
  if (host) result.host = host;
  return result;
}

function parseSingboxOutbound(outbound: Json, options: ReturnType<typeof resolveOptions>): ParsedProfile | null {
  const type = asText(outbound['type'])?.toLowerCase();
  if (!type) return null;
  if (['direct', 'block', 'dns', 'selector', 'urltest'].includes(type)) return null;
  const host = asText(outbound['server']);
  const port = num(outbound['server_port']);
  const tag = asText(outbound['tag']);
  if (!host || port === null) return null;
  const security = singboxTls(record(outbound['tls']));
  const transport = singboxTransport(record(outbound['transport']));
  const base = {
    name: tag ?? `${normalizeHost(host)}:${port}`,
    host,
    port,
    transport,
    security,
    unknown: { importedFrom: 'sing-box-json' },
  };

  if (type === 'vless' || type === 'vmess') {
    const uuid = asText(outbound['uuid']);
    if (!uuid || !isUuid(uuid)) return null;
    const flow = asText(outbound['flow']);
    return buildDraft(
      { ...base, protocol: type, credentials: { kind: 'uuid', uuid, ...(flow ? { flow } : {}) } },
      options,
    );
  }
  if (type === 'trojan') {
    const password = asText(outbound['password']);
    if (!password) return null;
    return buildDraft(
      { ...base, protocol: 'trojan', security: { ...security, type: 'tls' }, credentials: { kind: 'password', password } },
      options,
    );
  }
  if (type === 'shadowsocks') {
    const method = asText(outbound['method']);
    const password = asText(outbound['password']);
    if (!method || !password) return null;
    return buildDraft(
      { ...base, protocol: 'shadowsocks', credentials: { kind: 'method-password', method, password } },
      options,
    );
  }
  if (type === 'socks' || type === 'http') {
    const username = asText(outbound['username']);
    const password = asText(outbound['password']);
    const version = asText(outbound['version']);
    const connectKind = type === 'http' ? 'http' : version === '4' ? 'socks4' : 'socks5';
    return buildDraft(
      {
        ...base,
        protocol: type === 'socks' ? (connectKind === 'socks4' ? 'socks4' : 'socks5') : 'http',
        connectKind,
        credentials:
          username || password
            ? { kind: 'password', ...(username ? { username } : {}), ...(password ? { password } : {}) }
            : { kind: 'none' },
      },
      options,
    );
  }
  if (type === 'hysteria2' || type === 'hy2') {
    const password = asText(outbound['password']) ?? 'anonymous';
    return buildDraft(
      {
        ...base,
        protocol: 'hysteria2',
        transport: { type: 'quic' },
        security: { ...security, type: 'tls' },
        credentials: { kind: 'password', password },
      },
      options,
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

const XRAY_PROTOCOLS = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'socks', 'http']);

export function parseClientConfig(text: string, options?: ParseOptions): ParseResult<ParsedProfile[]> {
  const resolved = resolveOptions(options);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail('JSON', 'Configuration is not valid JSON');
  }
  const root = record(json);
  const rawOutbounds = root ? arr(root['outbounds']) : Array.isArray(json) ? json : [];
  if (rawOutbounds.length === 0) {
    return fail('NOTHING_FOUND', 'No outbound configurations found in this JSON file');
  }
  const profiles: ParsedProfile[] = [];
  for (const entry of rawOutbounds) {
    const outbound = record(entry);
    if (!outbound) continue;
    const protocol = asText(outbound['protocol'])?.toLowerCase();
    const type = asText(outbound['type'])?.toLowerCase();
    let parsed: ParsedProfile | null = null;
    if (protocol && XRAY_PROTOCOLS.has(protocol)) parsed = parseXrayOutbound(outbound, resolved);
    else if (type) parsed = parseSingboxOutbound(outbound, resolved);
    if (parsed) profiles.push(parsed);
  }
  if (profiles.length === 0) {
    return fail('NOTHING_FOUND', 'No supported outbound (VLESS, VMess, Trojan, Shadowsocks, SOCKS, HTTP) was found');
  }
  return ok(profiles);
}
