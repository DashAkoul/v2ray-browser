import { describe, expect, it, vi } from 'vitest';
import { DatabaseStore, MemoryStorageArea } from '@v2rb/storage';
import { ProfileService, SettingsService, SubscriptionService } from '../src/index';

const UUID = '11111111-2222-3333-4444-555555555555';
const VLESS = `vless://${UUID}@example.com:443?type=ws&security=tls#VL`;
const SOCKS = 'socks5://127.0.0.1:1080#Local';
const TROJAN = 'trojan://pw@t.example.com:443#T';

function setup() {
  const area = new MemoryStorageArea();
  const store = new DatabaseStore(area);
  let counter = 0;
  const profiles = new ProfileService(store, {
    now: () => 1000 + counter,
    newId: () => `id-${(counter += 1)}`,
  });
  return { area, store, profiles };
}

describe('ProfileService', () => {
  it('adds parsed profiles and rejects duplicates', async () => {
    const { profiles } = setup();
    const first = await profiles.addFromText(`${VLESS}\n${SOCKS}`, 'paste');
    expect(first.added).toHaveLength(2);
    expect(first.failures).toHaveLength(0);
    const second = await profiles.addFromText(VLESS);
    expect(second.added).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
    expect(second.duplicates[0]?.protocol).toBe('vless');
  });

  it('surfaces parse errors as AppError', async () => {
    const { profiles } = setup();
    await expect(profiles.addFromText('garbage')).rejects.toMatchObject({ code: 'PARSE' });
  });

  it('keeps valid lines when part of a list fails', async () => {
    const { profiles } = setup();
    const result = await profiles.addFromText(`${VLESS}\nnot-a-link`, 'paste');
    expect(result.added).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
  });

  it('validates updates', async () => {
    const { profiles } = setup();
    const added = await profiles.addFromText(SOCKS);
    const id = added.added[0]?.id as string;
    const updated = await profiles.update(id, { name: 'Renamed', port: 1081, tags: [' work ', ''] });
    expect(updated.name).toBe('Renamed');
    expect(updated.port).toBe(1081);
    expect(updated.tags).toEqual(['work']);
    await expect(profiles.update(id, { port: 0 })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(profiles.update(id, { name: '   ' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(profiles.update('missing', { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('clears the active id and reports a connected profile on removal', async () => {
    const { profiles, store } = setup();
    const added = await profiles.addFromText(SOCKS);
    const id = added.added[0]?.id as string;
    await profiles.setActive(id);
    await store.mutate((db) => {
      db.runtime = { intent: 'on', profileId: id };
    });
    const result = await profiles.remove(id);
    expect(result.clearedActive).toBe(true);
    expect(result.wasConnected).toBe(true);
    const db = await store.read();
    expect(db.settings.activeProfileId).toBeNull();
    expect(db.profiles).toHaveLength(0);
  });

  it('exports without secrets and imports the bundle', async () => {
    const { profiles } = setup();
    await profiles.addFromText(`${SOCKS}\n${TROJAN}`, 'paste');
    const shared = await profiles.exportBundle(false);
    expect(JSON.stringify(shared)).not.toContain('pw@');
    const target = setup();
    const imported = await target.profiles.importBundle(shared, 'merge');
    expect(imported.added).toBe(2);
    expect(imported.skipped).toBe(0);
    const again = await target.profiles.importBundle(shared, 'merge');
    expect(again.added).toBe(0);
    expect(again.skipped).toBe(2);
  });

  it('replaces everything on a replace import', async () => {
    const { profiles } = setup();
    await profiles.addFromText(VLESS);
    const source = setup();
    await source.profiles.addFromText(SOCKS);
    const bundle = await source.profiles.exportBundle(true);
    const result = await profiles.importBundle(bundle, 'replace');
    expect(result.added).toBe(1);
    const after = await profiles.exportBundle(true);
    expect(after.profiles).toHaveLength(1);
    expect(after.profiles[0]?.protocol).toBe('socks5');
  });
});

describe('SettingsService', () => {
  it('updates valid settings and clamps numeric ranges', async () => {
    const { store } = setup();
    const settings = new SettingsService(store);
    const updated = await settings.update({
      theme: 'dark',
      bypassList: [' <local> ', '', '*.corp.example'],
      healthCheck: { enabled: true, url: 'https://example.com/204', timeoutMs: 999999 },
    });
    expect(updated.theme).toBe('dark');
    expect(updated.bypassList).toEqual(['<local>', '*.corp.example']);
    expect(updated.healthCheck.timeoutMs).toBe(60000);
  });

  it('rejects invalid settings', async () => {
    const { store } = setup();
    const settings = new SettingsService(store);
    await expect(settings.update({ theme: 'neon' as 'dark' })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      settings.update({ healthCheck: { enabled: true, url: 'file:///etc/passwd', timeoutMs: 1000 } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('SubscriptionService', () => {
  function subscriptionSetup(body: string | (() => Promise<Response>)) {
    const area = new MemoryStorageArea();
    const store = new DatabaseStore(area);
    const fetchFn =
      typeof body === 'string'
        ? (vi.fn(async () => new Response(body, { status: 200 })) as unknown as typeof fetch)
        : (vi.fn(body) as unknown as typeof fetch);
    const service = new SubscriptionService(store, {
      fetchFn,
      now: () => 5000,
      newId: (() => {
        let index = 0;
        return () => `sub-${(index += 1)}`;
      })(),
      timeoutMs: 5000,
    });
    return { store, service, fetchFn };
  }

  it('validates subscription URLs', async () => {
    const { service } = subscriptionSetup('');
    await expect(service.add('file:///tmp/list.txt')).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(service.add('https://user:pass@example.com/list')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('downloads, parses and stores profiles', async () => {
    const { service, store } = subscriptionSetup(`${SOCKS}\n${TROJAN}`);
    const subscription = await service.add('https://example.com/sub.txt', 'My sub');
    const result = await service.refresh(subscription.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.added).toBe(2);
      expect(result.subscription.profileCount).toBe(2);
    }
    const db = await store.read();
    expect(db.profiles).toHaveLength(2);
    expect(db.profiles.every((profile) => profile.source.subscriptionId === subscription.id)).toBe(true);
  });

  it('keeps previous profiles when a refresh fails', async () => {
    const { service, store } = subscriptionSetup(`${SOCKS}`);
    const subscription = await service.add('https://example.com/sub.txt');
    await service.refresh(subscription.id);
    const failing = subscriptionSetup(async () => new Response('nope', { status: 502 }));
    const failService = new SubscriptionService(store, { ...failing, fetchFn: failing.fetchFn });
    const result = await failService.refresh(subscription.id);
    expect(result.ok).toBe(false);
    const db = await store.read();
    expect(db.profiles).toHaveLength(1);
    expect(db.subscriptions[0]?.lastError).toContain('502');
  });

  it('replaces the previous subscription profiles instead of duplicating them', async () => {
    const { service, store } = subscriptionSetup(`${SOCKS}`);
    const subscription = await service.add('https://example.com/sub.txt');
    await service.refresh(subscription.id);
    const updated = subscriptionSetup(`${SOCKS}\n${TROJAN}`);
    const service2 = new SubscriptionService(store, { fetchFn: updated.fetchFn, now: () => 6000 });
    const result = await service2.refresh(subscription.id);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.added).toBe(2);
    const db = await store.read();
    expect(db.profiles).toHaveLength(2);
  });

  it('rejects oversized responses without losing data', async () => {
    const { service, store } = subscriptionSetup(async () => {
      const response = new Response('#'.repeat(10), { status: 200 });
      Object.defineProperty(response.headers, 'get', {
        value: (name: string) => (name.toLowerCase() === 'content-length' ? String(2 * 1024 * 1024) : null),
      });
      return response;
    });
    const subscription = await service.add('https://example.com/big.txt');
    const result = await service.refresh(subscription.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('too large');
    expect((await store.read()).subscriptions[0]?.lastError).toContain('too large');
  });

  it('removes a subscription together with its profiles', async () => {
    const { service, store } = subscriptionSetup(`${SOCKS}\n${TROJAN}`);
    const subscription = await service.add('https://example.com/sub.txt');
    await service.refresh(subscription.id);
    const removed = await service.remove(subscription.id);
    expect(removed.removed).toBe(true);
    expect(removed.profilesRemoved).toBe(2);
    const db = await store.read();
    expect(db.subscriptions).toHaveLength(0);
    expect(db.profiles).toHaveLength(0);
  });
});
