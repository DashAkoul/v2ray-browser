import { describe, expect, it } from 'vitest';
import {
  encodeBase64String,
  parseInput,
  parseShareLink,
  parseSubscriptionBody,
  toShareLink,
  SUBSCRIPTION_MAX_BYTES,
} from '../src/index';

const UUID = '11111111-2222-3333-4444-555555555555';
const VLESS = `vless://${UUID}@example.com:443?type=ws&security=tls&path=%2Fws&sni=example.com#VL`;
const VMESS_JSON = JSON.stringify({
  v: '2',
  ps: 'vm',
  add: 'vm.example.com',
  port: '8443',
  id: UUID,
  net: 'tcp',
  tls: 'tls',
});
const VMESS = `vmess://${encodeBase64String(VMESS_JSON)}`;

describe('parseInput', () => {
  it('parses a single link', () => {
    const result = parseInput(VLESS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('single');
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]?.protocol).toBe('vless');
    }
  });

  it('parses a newline separated list and reports failures', () => {
    const result = parseInput(`${VLESS}\nnot-a-link\n${VMESS}`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profiles).toHaveLength(2);
      expect(result.failures).toHaveLength(1);
      expect(result.format).toBe('line-list');
    }
  });

  it('parses a base64 wrapped subscription list', () => {
    const body = encodeBase64String(`${VLESS}\n${VMESS}`);
    const result = parseInput(body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('base64-list');
      expect(result.profiles.map((profile) => profile.protocol)).toEqual(['vless', 'vmess']);
    }
  });

  it('parses a JSON array of links', () => {
    const result = parseInput(JSON.stringify([VLESS, VMESS]));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profiles).toHaveLength(2);
  });

  it('parses Xray style client JSON outbounds', () => {
    const config = {
      outbounds: [
        { protocol: 'freedom', tag: 'direct' },
        {
          protocol: 'vless',
          tag: 'xray-node',
          settings: { vnext: [{ address: 'x.example.com', port: 443, users: [{ id: UUID, flow: 'xtls-rprx-vision' }] }] },
          streamSettings: {
            network: 'ws',
            security: 'tls',
            tlsSettings: { serverName: 'x.example.com', alpn: ['h2', 'http/1.1'], fingerprint: 'chrome' },
            wsSettings: { path: '/ray', headers: { Host: 'x.example.com' } },
          },
        },
      ],
    };
    const result = parseInput(JSON.stringify(config));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.format).toBe('client-config');
      expect(result.profiles).toHaveLength(1);
      expect(result.profiles[0]).toMatchObject({
        protocol: 'vless',
        name: 'xray-node',
        host: 'x.example.com',
        port: 443,
        transport: { type: 'ws', path: '/ray' },
        security: { type: 'tls', sni: 'x.example.com' },
      });
    }
  });

  it('parses sing-box style outbounds', () => {
    const config = {
      outbounds: [
        { type: 'direct', tag: 'direct' },
        {
          type: 'trojan',
          tag: 'sb',
          server: 'sb.example.com',
          server_port: 443,
          password: 'pw',
          tls: { enabled: true, server_name: 'sb.example.com' },
          transport: { type: 'ws', path: '/sb' },
        },
        {
          type: 'socks',
          tag: 'local',
          server: '127.0.0.1',
          server_port: 1080,
          version: '5',
        },
      ],
    };
    const result = parseInput(JSON.stringify(config));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profiles).toHaveLength(2);
      expect(result.profiles[0]?.protocol).toBe('trojan');
      expect(result.profiles[1]?.connectKind).toBe('socks5');
    }
  });

  it('reports JSON configuration without supported outbounds', () => {
    const result = parseInput(JSON.stringify({ outbounds: [{ protocol: 'freedom' }] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NOTHING_FOUND');
  });

  it('rejects unsupported text', () => {
    const result = parseInput('hello world');
    expect(result.ok).toBe(false);
  });
});

describe('subscription limits', () => {
  it('parses a realistic body', () => {
    const body = encodeBase64String([VLESS, VMESS].join('\n'));
    const result = parseSubscriptionBody(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.profiles).toHaveLength(2);
  });

  it('rejects payloads above the size cap', () => {
    const huge = 'a'.repeat(SUBSCRIPTION_MAX_BYTES + 10);
    const result = parseSubscriptionBody(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOO_LARGE');
  });
});

describe('serialization round trip', () => {
  const cases = [
    VLESS,
    VMESS,
    'trojan://p%40ss@t.example.com:443?sni=t.example.com#T',
    'socks5://user:pass@127.0.0.1:1080#Local',
    'https://proxy.example.com:8443#TLS',
    'hysteria2://token@hy.example.com:443?sni=hy.example.com#H2',
  ];

  for (const link of cases) {
    it(`round trips ${link.slice(0, 18)}...`, () => {
      const first = parseShareLink(link);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const serialized = toShareLink(first.value);
      const second = parseShareLink(serialized);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.value.protocol).toBe(first.value.protocol);
      expect(second.value.host).toBe(first.value.host);
      expect(second.value.port).toBe(first.value.port);
      expect(second.value.credentials.uuid ?? second.value.credentials.password).toBe(
        first.value.credentials.uuid ?? first.value.credentials.password,
      );
    });
  }

  it('preserves the original URI for legacy SSR profiles', () => {
    const inner = `1.2.3.4:8388:origin:aes-256-cfb:plain:${encodeBase64String('p').replace(/=+$/, '')}/?remarks=`;
    const link = `ssr://${encodeBase64String(inner)}`;
    const parsed = parseShareLink(link);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(toShareLink(parsed.value)).toBe(link);
  });
});
