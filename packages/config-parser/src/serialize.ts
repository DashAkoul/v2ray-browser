import type { Profile } from '@v2rb/shared';
import { encodeBase64String } from './base64';

export type SerializableProfile = Pick<
  Profile,
  'protocol' | 'host' | 'port' | 'credentials' | 'transport' | 'security' | 'name' | 'rawUri' | 'unknown'
> & { connectKind?: Profile['connectKind'] };

function formatHost(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

function query(entries: Array<[string, string | undefined]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

function nameSuffix(name: string): string {
  return name ? `#${encodeURIComponent(name)}` : '';
}

function base64Url(value: string): string {
  return encodeBase64String(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function transportParams(profile: SerializableProfile): Array<[string, string | undefined]> {
  const { transport, security } = profile;
  const entries: Array<[string, string | undefined]> = [
    ['type', transport.type === 'mkcp' ? 'kcp' : transport.type],
    ['security', security.type],
    ['sni', security.sni],
    ['alpn', security.alpn?.join(',')],
    ['fp', security.fingerprint],
    ['pbk', security.publicKey],
    ['sid', security.shortId],
    ['host', transport.host],
    ['path', transport.path],
    ['serviceName', transport.serviceName],
    ['mode', transport.mode],
  ];
  if (security.allowInsecure) entries.push(['allowInsecure', '1']);
  return entries;
}

function uuidLink(profile: SerializableProfile, scheme: 'vless' | 'vmess'): string {
  const uuid = profile.credentials.uuid ?? '';
  const entries = transportParams(profile);
  if (profile.credentials.flow) entries.push(['flow', profile.credentials.flow]);
  return `${scheme}://${encodeURIComponent(uuid)}@${formatHost(profile.host)}:${profile.port}${query(entries)}${nameSuffix(profile.name)}`;
}

function vmessLink(profile: SerializableProfile): string {
  const payload: Record<string, string> = {
    v: '2',
    ps: profile.name,
    add: profile.host,
    port: String(profile.port),
    id: profile.credentials.uuid ?? '',
    aid: '0',
    scy: 'auto',
    net: profile.transport.type === 'mkcp' ? 'kcp' : profile.transport.type,
    type: 'none',
    host: profile.transport.host ?? '',
    path: profile.transport.path ?? '',
    tls: profile.security.type === 'none' ? '' : profile.security.type,
  };
  if (profile.transport.serviceName) payload['path'] = profile.transport.serviceName;
  if (profile.security.sni) payload['sni'] = profile.security.sni;
  if (profile.security.alpn) payload['alpn'] = profile.security.alpn.join(',');
  if (profile.security.fingerprint) payload['fp'] = profile.security.fingerprint;
  if (profile.unknown['scy']) payload['scy'] = profile.unknown['scy'];
  return `vmess://${encodeBase64String(JSON.stringify(payload))}`;
}

function trojanLink(profile: SerializableProfile): string {
  const password = encodeURIComponent(profile.credentials.password ?? '');
  const entries = transportParams(profile);
  return `trojan://${password}@${formatHost(profile.host)}:${profile.port}${query(entries)}${nameSuffix(profile.name)}`;
}

function shadowsocksLink(profile: SerializableProfile): string {
  const method = profile.credentials.method ?? '';
  const password = profile.credentials.password ?? '';
  const userinfo = method.startsWith('2022-')
    ? `${encodeURIComponent(method)}:${encodeURIComponent(password)}`
    : base64Url(`${method}:${password}`);
  const plugin = profile.unknown['plugin'];
  const queryText = plugin ? `?plugin=${encodeURIComponent(plugin)}` : '';
  return `ss://${userinfo}@${formatHost(profile.host)}:${profile.port}${queryText}${nameSuffix(profile.name)}`;
}

function hysteria2Link(profile: SerializableProfile): string {
  const auth = encodeURIComponent(profile.credentials.password ?? 'anonymous');
  const entries: Array<[string, string | undefined]> = [
    ['sni', profile.security.sni],
    ['alpn', profile.security.alpn?.join(',')],
    ['insecure', profile.security.allowInsecure ? '1' : undefined],
    ['obfs', profile.unknown['obfs']],
    ['obfs-password', profile.unknown['obfs-password']],
  ];
  return `hysteria2://${auth}@${formatHost(profile.host)}:${profile.port}/${query(entries)}${nameSuffix(profile.name)}`;
}

function proxyLink(profile: SerializableProfile): string {
  const scheme = profile.connectKind ?? (profile.protocol === 'socks5' ? 'socks5' : profile.protocol);
  const username = profile.credentials.username;
  const password = profile.credentials.password;
  const userinfo = username || password
    ? `${encodeURIComponent(username ?? '')}${password ? `:${encodeURIComponent(password)}` : ''}@`
    : '';
  return `${scheme}://${userinfo}${formatHost(profile.host)}:${profile.port}${nameSuffix(profile.name)}`;
}

/** Best-effort canonical link; falls back to the verbatim imported URI. */
export function toShareLink(profile: SerializableProfile): string {
  switch (profile.protocol) {
    case 'vless':
      return uuidLink(profile, 'vless');
    case 'vmess':
      return vmessLink(profile);
    case 'trojan':
      return trojanLink(profile);
    case 'shadowsocks':
      return shadowsocksLink(profile);
    case 'hysteria2':
      return hysteria2Link(profile);
    case 'socks5':
    case 'socks4':
    case 'http':
    case 'https':
      return proxyLink(profile);
    case 'shadowsocksr':
    case 'wireguard':
      return profile.rawUri ?? `${profile.protocol}://${profile.credentials.password ?? ''}@${formatHost(profile.host)}:${profile.port}`;
    default:
      return profile.rawUri ?? `${profile.host}:${profile.port}`;
  }
}
