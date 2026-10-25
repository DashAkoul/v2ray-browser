import { describe, expect, it } from 'vitest';
import { parseShareLink, encodeBase64String, maskUri, sanitizeText, profileFingerprint } from '../src/index';

const UUID = '11111111-2222-3333-4444-555555555555';

function mustParse(link: string) {
  const result = parseShareLink(link);
  if (!result.ok) throw new Error(`expected parse to succeed: ${result.error.code}`);
  return result.value;
}

describe('VLESS links', () => {
  it('parses a full websocket + TLS link', () => {
    const link =
      `vless://${UUID}@example.com:443?type=ws&security=tls&sni=cdn.example.com` +
      '&path=%2Fws&host=cdn.example.com&fp=chrome&alpn=h2%2Chttp%2F1.1&flow=xtls-rprx-vision#My%20Node';
    const profile = mustParse(link);
    expect(profile.protocol).toBe('vless');
    expect(profile.host).toBe('example.com');
    expect(profile.port).toBe(443);
    expect(profile.credentials.uuid).toBe(UUID);
    expect(profile.credentials.flow).toBe('xtls-rprx-vision');
    expect(profile.transport).toMatchObject({ type: 'ws', path: '/ws', host: 'cdn.example.com' });
    expect(profile.security).toMatchObject({ type: 'tls', sni: 'cdn.example.com', fingerprint: 'chrome' });
    expect(profile.security.alpn).toEqual(['h2', 'http/1.1']);
    expect(profile.name).toBe('My Node');
    expect(profile.connectKind).toBeUndefined();
  });

  it('parses REALITY parameters', () => {
    const profile = mustParse(
      `vless://${UUID}@1.2.3.4:443?security=reality&pbk=PUBKEY&sid=ab12&fp=safari&sni=www.example.com&type=tcp#R`,
    );
    expect(profile.security.type).toBe('reality');
    expect(profile.security.publicKey).toBe('PUBKEY');
    expect(profile.security.shortId).toBe('ab12');
    expect(profile.security.fingerprint).toBe('safari');
  });

  it('rejects an invalid UUID', () => {
    const result = parseShareLink('vless://not-a-uuid@example.com:443');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_UUID');
  });

  it('rejects a missing port', () => {
    const result = parseShareLink(`vless://${UUID}@example.com`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_PORT');
  });

  it('rejects an out of range port', () => {
    const result = parseShareLink(`vless://${UUID}@example.com:70000`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_PORT');
  });

  it('rejects unsupported legacy encryption', () => {
    const result = parseShareLink(`vless://${UUID}@example.com:443?encryption=aes-128-gcm`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
  });

  it('accepts ipv6 hosts', () => {
    const profile = mustParse(`vless://${UUID}@[2001:db8::1]:443?type=tcp#v6`);
    expect(profile.host).toBe('2001:db8::1');
  });
});

describe('VMess links', () => {
  it('parses the base64 JSON form', () => {
    const payload = {
      v: '2',
      ps: 'vm node',
      add: 'vm.example.com',
      port: '8443',
      id: UUID,
      aid: '0',
      net: 'ws',
      type: 'none',
      host: 'h.example.com',
      path: '/v',
      tls: 'tls',
      sni: 's.example.com',
      alpn: 'h2',
    };
    const profile = mustParse(`vmess://${encodeBase64String(JSON.stringify(payload))}`);
    expect(profile.protocol).toBe('vmess');
    expect(profile.host).toBe('vm.example.com');
    expect(profile.port).toBe(8443);
    expect(profile.credentials.uuid).toBe(UUID);
    expect(profile.transport).toMatchObject({ type: 'ws', path: '/v', host: 'h.example.com' });
    expect(profile.security).toMatchObject({ type: 'tls', sni: 's.example.com' });
    expect(profile.name).toBe('vm node');
  });

  it('parses the query form with grpc service name', () => {
    const profile = mustParse(`vmess://${UUID}@example.com:443?type=grpc&security=tls&serviceName=svc#VM`);
    expect(profile.transport.type).toBe('grpc');
    expect(profile.transport.serviceName).toBe('svc');
  });

  it('rejects invalid base64', () => {
    const result = parseShareLink('vmess://!!!not-base64!!!');
    expect(result.ok).toBe(false);
  });

  it('rejects base64 that is not JSON', () => {
    const result = parseShareLink(`vmess://${encodeBase64String('hello world')}`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('JSON');
  });
});

describe('Trojan links', () => {
  it('parses password, transport and defaults to TLS', () => {
    const profile = mustParse('trojan://p%40ssw0rd@t.example.com:443?sni=t.example.com&type=ws&path=%2Ft#T');
    expect(profile.protocol).toBe('trojan');
    expect(profile.credentials.password).toBe('p@ssw0rd');
    expect(profile.security.type).toBe('tls');
    expect(profile.transport).toMatchObject({ type: 'ws', path: '/t' });
  });

  it('rejects a missing password', () => {
    const result = parseShareLink('trojan://t.example.com:443');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_PASSWORD');
  });
});

describe('Shadowsocks links', () => {
  it('parses SIP002 base64 userinfo', () => {
    const userinfo = encodeBase64String('aes-256-gcm:secret').replace(/=+$/, '');
    const profile = mustParse(`ss://${userinfo}@1.2.3.4:8388#SS`);
    expect(profile.protocol).toBe('shadowsocks');
    expect(profile.credentials).toMatchObject({ method: 'aes-256-gcm', password: 'secret' });
    expect(profile.port).toBe(8388);
    expect(profile.name).toBe('SS');
  });

  it('parses the plain percent-encoded AEAD-2022 form', () => {
    const profile = mustParse('ss://2022-blake3-aes-128-gcm:key%2Bwith%3D@1.2.3.4:8389#SS22');
    expect(profile.credentials.method).toBe('2022-blake3-aes-128-gcm');
    expect(profile.credentials.password).toBe('key+with=');
  });

  it('parses the legacy fully base64 encoded form', () => {
    const encoded = encodeBase64String('aes-256-cfb:legacy@5.6.7.8:8388');
    const profile = mustParse(`ss://${encoded}#Legacy`);
    expect(profile.credentials.password).toBe('legacy');
    expect(profile.host).toBe('5.6.7.8');
  });

  it('keeps the plugin parameter', () => {
    const userinfo = encodeBase64String('aes-256-gcm:secret').replace(/=+$/, '');
    const profile = mustParse(`ss://${userinfo}@1.2.3.4:8388?plugin=obfs-local%3Bobfs%3Dhttp#P`);
    expect(profile.unknown['plugin']).toContain('obfs-local');
  });

  it('rejects a malformed link', () => {
    const result = parseShareLink('ss://notbase64@@@');
    expect(result.ok).toBe(false);
  });
});

describe('ShadowsocksR links', () => {
  it('parses the legacy payload', () => {
    const password = encodeBase64String('ssr-pass').replace(/=+$/, '');
    const remarks = encodeBase64String('SSR node').replace(/=+$/, '');
    const inner = `1.2.3.4:8388:origin:aes-256-cfb:plain:${password}/?remarks=${remarks}`;
    const profile = mustParse(`ssr://${encodeBase64String(inner)}`);
    expect(profile.protocol).toBe('shadowsocksr');
    expect(profile.credentials.password).toBe('ssr-pass');
    expect(profile.name).toBe('SSR node');
  });
});

describe('Hysteria2 links', () => {
  it('parses auth, SNI and obfuscation', () => {
    const profile = mustParse(
      'hysteria2://token@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=pw&insecure=1#H2',
    );
    expect(profile.protocol).toBe('hysteria2');
    expect(profile.credentials.password).toBe('token');
    expect(profile.security.type).toBe('tls');
    expect(profile.security.allowInsecure).toBe(true);
    expect(profile.unknown['obfs']).toBe('salamander');
  });

  it('supports the hy2 alias', () => {
    const profile = mustParse('hy2://token@hy.example.com:8443#Alias');
    expect(profile.protocol).toBe('hysteria2');
  });
});

describe('WireGuard links', () => {
  it('stores the private key without exposing it as a name', () => {
    const profile = mustParse('wireguard://cHJpdmF0ZQ==@wg.example.com:51820?publickey=abc&address=10.0.0.2%2F32#WG');
    expect(profile.protocol).toBe('wireguard');
    expect(profile.credentials.password).toBe('cHJpdmF0ZQ==');
    expect(profile.unknown['publickey']).toBe('abc');
  });
});

describe('SOCKS and HTTP proxies', () => {
  it('marks socks5 as connectable with credentials', () => {
    const profile = mustParse('socks5://user:pass@127.0.0.1:1080#Local');
    expect(profile.protocol).toBe('socks5');
    expect(profile.connectKind).toBe('socks5');
    expect(profile.credentials.username).toBe('user');
    expect(profile.credentials.password).toBe('pass');
  });

  it('treats socks5h and socks as socks5', () => {
    expect(mustParse('socks5h://proxy.example.com:1080').connectKind).toBe('socks5');
    expect(mustParse('socks://proxy.example.com').port).toBe(1080);
  });

  it('maps socks4 correctly', () => {
    expect(mustParse('socks4://proxy.example.com:1080').connectKind).toBe('socks4');
  });

  it('supports https (TLS to proxy) endpoints', () => {
    const profile = mustParse('https://proxy.example.com:8443#TLS');
    expect(profile.connectKind).toBe('https');
    expect(profile.protocol).toBe('https');
  });

  it('requires an explicit port for http proxies', () => {
    const result = parseShareLink('http://proxy.example.com');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('MISSING_PORT');
  });
});

describe('rejections', () => {
  it('rejects an unsupported scheme', () => {
    const result = parseShareLink('ftp://example.com/file');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNSUPPORTED_SCHEME');
  });

  it('rejects empty input', () => {
    const result = parseShareLink('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('EMPTY');
  });
});

describe('fingerprints and redaction', () => {
  it('produces stable fingerprints and distinguishes credentials', () => {
    const a = mustParse(`vless://${UUID}@example.com:443?type=ws&path=%2Fa#A`);
    const b = mustParse(`vless://${UUID}@example.com:443?type=ws&path=%2Fb#B`);
    const c = mustParse('vless://22222222-2222-3333-4444-555555555555@example.com:443?type=ws#C');
    expect(profileFingerprint(a)).toBe(profileFingerprint(b));
    expect(profileFingerprint(a)).not.toBe(profileFingerprint(c));
  });

  it('masks userinfo in links and secrets in text', () => {
    const masked = maskUri(`vless://${UUID}@example.com:443#N`);
    expect(masked).not.toContain(UUID);
    expect(masked).toContain('example.com:443');
    const clean = sanitizeText('failed for https://user:pass@host/x?token=abcdef and 11111111-2222-3333-4444-555555555555');
    expect(clean).not.toContain('pass');
    expect(clean).not.toContain('abcdef');
    expect(clean).not.toContain(UUID);
  });
});
