import type {
  ParsedProfile,
  ParseErrorCode,
  ParseIssue,
  ParseResult,
  ProfileSourceType,
} from './types';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(
  code: ParseErrorCode,
  message: string,
  field?: string,
): ParseResult<T> {
  const issue: ParseIssue = { code, message };
  if (field !== undefined) issue.field = field;
  return { ok: false, error: issue };
}

export function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Strip IPv6 brackets, lowercase, trim. */
export function normalizeHost(raw: string): string {
  let host = raw.trim();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  return host.toLowerCase();
}

export function isIpv6(host: string): boolean {
  return host.includes(':') && !host.includes('.');
}

export function formatHostForUri(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export function parsePort(raw: string | number | undefined | null): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const text = String(raw).trim();
  if (!/^\d{1,5}$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isInteger(value) || value < 1 || value > 65535) return null;
  return value;
}

export function parseBool(raw: string | boolean | number | undefined | null): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw === undefined || raw === null) return false;
  const text = String(raw).trim().toLowerCase();
  return text === '1' || text === 'true' || text === 'yes';
}

export function splitCommaList(raw: string | undefined | null): string[] | undefined {
  if (!raw) return undefined;
  const items = raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

export function parseQueryString(raw: string): URLSearchParams {
  return new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
}

export interface ParseOptions {
  source?: ProfileSourceType;
  now?: number;
  maxBytes?: number;
}

export const DEFAULT_MAX_BYTES = 64 * 1024;

export function resolveOptions(options: ParseOptions | undefined): {
  source: ProfileSourceType;
  now: number;
  maxBytes: number;
} {
  return {
    source: options?.source ?? 'uri',
    now: options?.now ?? Date.now(),
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_BYTES,
  };
}

export interface DraftInput {
  name?: string;
  protocol: ParsedProfile['protocol'];
  host: string;
  port: number;
  credentials?: ParsedProfile['credentials'];
  transport?: Partial<ParsedProfile['transport']>;
  security?: Partial<ParsedProfile['security']>;
  unknown?: Record<string, string>;
  rawUri?: string;
  connectKind?: ParsedProfile['connectKind'];
}

export function buildDraft(input: DraftInput, options: ReturnType<typeof resolveOptions>): ParsedProfile {
  const host = normalizeHost(input.host);
  const transport: ParsedProfile['transport'] = {
    type: input.transport?.type ?? 'tcp',
    ...(input.transport?.path !== undefined ? { path: input.transport.path } : {}),
    ...(input.transport?.host !== undefined ? { host: input.transport.host } : {}),
    ...(input.transport?.serviceName !== undefined
      ? { serviceName: input.transport.serviceName }
      : {}),
    ...(input.transport?.mode !== undefined ? { mode: input.transport.mode } : {}),
    ...(input.transport?.headers !== undefined ? { headers: input.transport.headers } : {}),
  };
  const security: ParsedProfile['security'] = {
    type: input.security?.type ?? 'none',
    ...(input.security?.sni !== undefined ? { sni: input.security.sni } : {}),
    ...(input.security?.alpn !== undefined ? { alpn: input.security.alpn } : {}),
    ...(input.security?.fingerprint !== undefined
      ? { fingerprint: input.security.fingerprint }
      : {}),
    ...(input.security?.publicKey !== undefined ? { publicKey: input.security.publicKey } : {}),
    ...(input.security?.shortId !== undefined ? { shortId: input.security.shortId } : {}),
    ...(input.security?.allowInsecure !== undefined
      ? { allowInsecure: input.security.allowInsecure }
      : {}),
  };
  const profile: ParsedProfile = {
    name: (input.name ?? '').trim() || `${host}:${input.port}`,
    protocol: input.protocol,
    host,
    port: input.port,
    credentials: input.credentials ?? { kind: 'none' },
    transport,
    security,
    tags: [],
    source: { type: options.source, importedAt: options.now },
    unknown: input.unknown ?? {},
    ...(input.rawUri !== undefined ? { rawUri: input.rawUri } : {}),
    ...(input.connectKind !== undefined ? { connectKind: input.connectKind } : {}),
  };
  return profile;
}

export function fragmentName(url: URL): string | undefined {
  const raw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (!raw) return undefined;
  const decoded = decodeSafe(raw).trim();
  return decoded.length > 0 ? decoded : undefined;
}

const KNOWN_COMMON_KEYS = new Set([
  'type',
  'security',
  'tls',
  'sni',
  'peer',
  'host',
  'path',
  'serviceName',
  'mode',
  'alpn',
  'fp',
  'pbk',
  'sid',
  'spx',
  'flow',
  'headerType',
  'allowInsecure',
  'insecure',
  'allow_insecure',
  'encryption',
  'remark',
]);

export function collectUnknown(
  params: URLSearchParams,
  handled: Set<string>,
): Record<string, string> {
  const unknown: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (handled.has(key) || KNOWN_COMMON_KEYS.has(key)) continue;
    unknown[key] = value;
  }
  return unknown;
}
