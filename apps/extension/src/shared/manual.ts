export type ManualSecurity = 'none' | 'tls' | 'reality';
export type ManualTransport = 'tcp' | 'ws' | 'grpc';

export interface ManualDraft {
  protocol: string;
  name: string;
  host: string;
  port: string;
  uuid: string;
  password: string;
  username: string;
  method: string;
  security: ManualSecurity;
  transport: ManualTransport;
  path: string;
  sni: string;
}

export const EMPTY_MANUAL_DRAFT: ManualDraft = {
  protocol: 'socks5',
  name: '',
  host: '',
  port: '',
  uuid: '',
  password: '',
  username: '',
  method: 'aes-256-gcm',
  security: 'none',
  transport: 'tcp',
  path: '',
  sni: '',
};

const CORE_PROTOCOLS = new Set(['vless', 'vmess', 'trojan', 'hysteria2', 'wireguard']);

export function protocolNeedsUuid(protocol: string): boolean {
  return protocol === 'vless' || protocol === 'vmess';
}

export function protocolNeedsMethod(protocol: string): boolean {
  return protocol === 'shadowsocks' || protocol === 'shadowsocksr';
}

export function protocolUsesSecurity(protocol: string): boolean {
  return CORE_PROTOCOLS.has(protocol);
}

export function protocolUsesCredentials(protocol: string): boolean {
  return ['socks5', 'socks4', 'http', 'https'].includes(protocol);
}

export type ManualErrorKey = 'add.required' | 'add.invalidPort' | 'errors.generic';

export type ManualBuildResult = { ok: true; link: string } | { ok: false; error: ManualErrorKey };

/** Validation key names match i18n keys so the dialog can localize them. */
export function buildManualLink(draft: ManualDraft): ManualBuildResult {
  const host = draft.host.trim();
  if (!host) return { ok: false, error: 'add.required' };
  const port = Number(draft.port.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'add.invalidPort' };

  const name = draft.name.trim();
  const fragment = name ? `#${encodeURIComponent(name)}` : '';
  const hostPart = host.includes(':') ? `[${host}]` : host;
  const protocol = draft.protocol;

  if (protocol === 'socks5' || protocol === 'socks4' || protocol === 'http' || protocol === 'https') {
    const userinfo =
      draft.username || draft.password
        ? `${encodeURIComponent(draft.username)}${draft.password ? `:${encodeURIComponent(draft.password)}` : ''}@`
        : '';
    return { ok: true, link: `${protocol}://${userinfo}${hostPart}:${port}${fragment}` };
  }

  const params = new URLSearchParams();
  if (protocolUsesSecurity(protocol)) {
    if (draft.security !== 'none') params.set('security', draft.security);
    if (draft.sni) params.set('sni', draft.sni.trim());
    if (draft.transport !== 'tcp') {
      params.set('type', draft.transport);
      if (draft.path) params.set(draft.transport === 'grpc' ? 'serviceName' : 'path', draft.path.trim());
    }
  }
  const query = params.toString() ? `?${params.toString()}` : '';

  if (protocol === 'vless' || protocol === 'vmess') {
    if (!draft.uuid.trim()) return { ok: false, error: 'add.required' };
    return { ok: true, link: `${protocol}://${encodeURIComponent(draft.uuid.trim())}@${hostPart}:${port}${query}${fragment}` };
  }
  if (protocol === 'trojan') {
    if (!draft.password) return { ok: false, error: 'add.required' };
    return { ok: true, link: `trojan://${encodeURIComponent(draft.password)}@${hostPart}:${port}${query}${fragment}` };
  }
  if (protocol === 'hysteria2') {
    if (!draft.password) return { ok: false, error: 'add.required' };
    return { ok: true, link: `hysteria2://${encodeURIComponent(draft.password)}@${hostPart}:${port}${query}${fragment}` };
  }
  if (protocol === 'wireguard') {
    if (!draft.password) return { ok: false, error: 'add.required' };
    return { ok: true, link: `wireguard://${encodeURIComponent(draft.password)}@${hostPart}:${port}${fragment}` };
  }
  if (protocol === 'shadowsocks' || protocol === 'shadowsocksr') {
    if (!draft.method.trim() || !draft.password) return { ok: false, error: 'add.required' };
    const userinfo = `${encodeURIComponent(draft.method.trim())}:${encodeURIComponent(draft.password)}`;
    return { ok: true, link: `${protocol}://${userinfo}@${hostPart}:${port}${fragment}` };
  }
  return { ok: false, error: 'errors.generic' };
}
