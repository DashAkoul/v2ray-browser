import type { ParsedProfile, ParseIssue, ParseResult } from './types';
import { detectScheme, parseShareLink } from './links';
import { parseClientConfig } from './client-config';
import { decodeBase64String, looksLikeBase64 } from './base64';
import { resolveOptions, type ParseOptions } from './util';
import { toShareLink } from './serialize';
import { sanitizeText } from './redact';

export * from './types';
export type { ParseOptions } from './util';
export { parseShareLink, detectScheme, isSupportedLink, SHARE_SCHEMES } from './links';
export { parseClientConfig } from './client-config';
export { toShareLink } from './serialize';
export type { SerializableProfile } from './serialize';
export { maskUri, maskSecret, sanitizeText, endpointLabel, MASK } from './redact';
export { decodeBase64String, encodeBase64String, looksLikeBase64 } from './base64';

export type ParseFormat = 'single' | 'line-list' | 'base64-list' | 'client-config' | 'json-list';

export interface ParseFailure {
  input: string;
  error: ParseIssue;
}

export type ParseInputSuccess = {
  ok: true;
  profiles: ParsedProfile[];
  format: ParseFormat;
  failures: ParseFailure[];
};

export type ParseInputResponse = ParseInputSuccess | { ok: false; error: ParseIssue };

export const SUBSCRIPTION_MAX_BYTES = 1024 * 1024;

function failure(code: ParseIssue['code'], message: string): { ok: false; error: ParseIssue } {
  return { ok: false, error: { code, message } };
}

/**
 * Parse one paste/import input. Supports a single share link, a newline
 * separated list, a base64-wrapped list (common subscription payload), an
 * array of links, and Xray/sing-box JSON outbounds.
 */
export function parseInput(input: string, options?: ParseOptions): ParseInputResponse {
  const resolved = resolveOptions(options);
  const trimmed = input.trim();
  if (!trimmed) return failure('EMPTY', 'Nothing to import');
  if (new TextEncoder().encode(trimmed).length > resolved.maxBytes) {
    return failure('TOO_LARGE', 'Input is larger than the allowed limit');
  }

  if (!trimmed.includes('\n') && detectScheme(trimmed)) {
    const single = parseShareLink(trimmed, options);
    if (!single.ok) return { ok: false, error: single.error };
    return { ok: true, profiles: [single.value], format: 'single', failures: [] };
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json: unknown = JSON.parse(trimmed);
      if (Array.isArray(json) && json.every((entry) => typeof entry === 'string')) {
        return parseLines(json as string[], 'json-list', options);
      }
    } catch {
      // fall through to client config parser which reports JSON errors
    }
    const config = parseClientConfig(trimmed, options);
    if (config.ok) return { ok: true, profiles: config.value, format: 'client-config', failures: [] };
    return { ok: false, error: config.error };
  }

  if (looksLikeBase64(trimmed)) {
    const decoded = decodeBase64String(trimmed);
    if (decoded && decoded !== trimmed && decoded.includes('://')) {
      const inner = parseInput(decoded, { ...options, source: resolved.source });
      if (inner.ok) return { ...inner, format: 'base64-list' };
      return inner;
    }
  }

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  if (lines.length > 1) return parseLines(lines, 'line-list', options);

  return failure('UNSUPPORTED_SCHEME', 'Not a supported configuration link');
}

function parseLines(lines: string[], format: ParseFormat, options?: ParseOptions): ParseInputResponse {
  const profiles: ParsedProfile[] = [];
  const failures: ParseFailure[] = [];
  for (const line of lines) {
    const result = parseShareLink(line, options);
    if (result.ok) profiles.push(result.value);
    else failures.push({ input: sanitizeText(line).slice(0, 120), error: result.error });
  }
  if (profiles.length === 0) {
    const first = failures[0];
    if (first) return { ok: false, error: first.error };
    return failure('EMPTY', 'No configuration links found');
  }
  return { ok: true, profiles, format, failures };
}

/** Parse a subscription response body with the subscription size limit. */
export function parseSubscriptionBody(body: string, options?: ParseOptions): ParseInputResponse {
  return parseInput(body, { maxBytes: SUBSCRIPTION_MAX_BYTES, source: 'subscription', ...options });
}

/** Stable identity used to reject accidental duplicates. */
export function profileFingerprint(profile: ParsedProfile | (Pick<ParsedProfile, 'protocol' | 'host' | 'port' | 'credentials' | 'transport' | 'security'>)): string {
  const credentials = profile.credentials;
  let credentialKey = 'none';
  if (credentials.kind === 'uuid') credentialKey = (credentials.uuid ?? '').toLowerCase();
  else if (credentials.kind === 'method-password')
    credentialKey = `${(credentials.method ?? '').toLowerCase()}:${credentials.password ?? ''}`;
  else if (credentials.kind === 'password')
    credentialKey = `${credentials.username ?? ''}:${credentials.password ?? ''}`;
  return [
    profile.protocol,
    profile.host.toLowerCase(),
    String(profile.port),
    credentialKey,
    profile.transport.type,
    profile.security.type,
  ].join('|');
}

export function isDuplicate(
  existing: Array<{ id: string; fingerprint: string }>,
  candidateFingerprint: string,
): { id: string } | null {
  for (const profile of existing) {
    if (profile.fingerprint === candidateFingerprint) return { id: profile.id };
  }
  return null;
}

/** Re-export used by the UI clipboard/export flows. */
export { toShareLink as serializeProfile };

/** Convenience wrapper used by tests and services. */
export function parseOneOrThrow(input: string, options?: ParseOptions): ParseResult<ParsedProfile> {
  return parseShareLink(input, options);
}
