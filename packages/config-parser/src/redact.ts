import type { Profile } from '@v2rb/shared';

const USERINFO_RE = /([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const TOKEN_PARAM_RE = /([?&](?:token|access_token|api_key|apikey|key|auth|password|passwd)=)[^&#\s]+/gi;
const LONG_B64_RE = /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g;

export const MASK = '••••';

/** Mask the user-info part of any URI while keeping scheme, host and port readable. */
export function maskUri(uri: string): string {
  return uri.replace(USERINFO_RE, `$1${MASK}@`);
}

/** Replace secrets inside free-form text (errors, diagnostics, logs). */
export function sanitizeText(text: string): string {
  return text
    .replace(USERINFO_RE, `$1${MASK}@`)
    .replace(TOKEN_PARAM_RE, `$1${MASK}`)
    .replace(UUID_RE, MASK)
    .replace(LONG_B64_RE, MASK);
}

export function maskSecret(value: string | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return MASK;
  return `${MASK}${value.slice(-4)}`;
}

/** Safe endpoint label for cards and lists. Never includes credentials. */
export function endpointLabel(profile: Pick<Profile, 'host' | 'port'>): string {
  return profile.host.includes(':') ? `[${profile.host}]:${profile.port}` : `${profile.host}:${profile.port}`;
}
