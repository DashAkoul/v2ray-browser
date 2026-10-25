/** Base64 helpers that accept URL-safe alphabets, missing padding and whitespace. */

const STRIP_WHITESPACE = /[\s\u200b]+/g;

export function normalizeBase64(input: string): string {
  let value = input.replace(STRIP_WHITESPACE, '').replace(/-/g, '+').replace(/_/g, '/');
  const remainder = value.length % 4;
  if (remainder === 2) value += '==';
  else if (remainder === 3) value += '=';
  else if (remainder === 1) return '';
  return value;
}

export function decodeBase64String(input: string): string | null {
  const normalized = normalizeBase64(input);
  if (!normalized) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text;
  } catch {
    return null;
  }
}

export function encodeBase64String(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function looksLikeBase64(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.includes('://')) return false;
  if (!/^[A-Za-z0-9+/=_\-\s]+$/.test(trimmed)) return false;
  return decodeBase64String(trimmed) !== null;
}
