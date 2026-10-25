import { describe, expect, it, vi } from 'vitest';
import type { ProxyCapabilities, Profile } from '@v2rb/shared';
import {
  ProxyAdapterError,
  type ProxyAdapter,
  type ProxySnapshot,
  type ProxyTarget,
} from '@v2rb/adapters';
import { DatabaseStore, MemoryStorageArea } from '@v2rb/storage';
import { ConnectionController } from '../src/index';

const CHROME_CAPS: ProxyCapabilities = {
  browser: 'chrome',
  proxyApi: true,
  controllable: true,
  incognitoAccess: true,
  webRtcGuard: true,
  supportedConnectKinds: ['socks5', 'socks4', 'http', 'https'],
  authSupported: [],
  notes: [],
};

class FakeAdapter implements ProxyAdapter {
  readonly browser = 'chrome' as const;
  applied: ProxyTarget | null = null;
  capabilities: ProxyCapabilities = structuredClone(CHROME_CAPS);
  failApply = false;
  failVerify = false;
  failRestore = false;
  restores: Array<ProxySnapshot | undefined> = [];

  async getCapabilities(): Promise<ProxyCapabilities> {
    return this.capabilities;
  }

  async capture(): Promise<ProxySnapshot> {
    return { browser: 'chrome', capturedAt: 1, proxy: { mode: 'system' } };
  }

  async apply(target: ProxyTarget): Promise<void> {
    if (this.failApply) throw new ProxyAdapterError('APPLY_FAILED', 'apply boom');
    this.applied = target;
  }

  async verifyApplied(target: ProxyTarget): Promise<boolean> {
    if (this.failVerify) return false;
    return this.applied?.host === target.host && this.applied?.port === target.port;
  }

  async restore(snapshot: ProxySnapshot | undefined): Promise<void> {
    this.restores.push(snapshot);
    if (this.failRestore) throw new ProxyAdapterError('RESTORE_FAILED', 'restore boom');
    this.applied = null;
  }

  async setLeakProtection(): Promise<boolean> {
    return true;
  }
}

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Socks node',
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    credentials: { kind: 'none' },
    transport: { type: 'tcp' },
    security: { type: 'none' },
    tags: [],
    source: { type: 'uri', importedAt: 1 },
    unknown: {},
    connectKind: 'socks5',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

async function setup(profiles: Profile[] = [profile()]) {
  const area = new MemoryStorageArea();
  const store = new DatabaseStore(area);
  await store.mutate((db) => {
    db.profiles = profiles;
  });
  const adapter = new FakeAdapter();
  const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  const controller = new ConnectionController({ store, adapter, fetchFn, now: () => 1000 });
  return { area, store, adapter, controller, fetchFn };
}

describe('ConnectionController', () => {
  it('connects, verifies and records the runtime intent', async () => {
    const { store, adapter, controller } = await setup();
    const result = await controller.connect('p1');
    expect(result.ok).toBe(true);
    expect(controller.getState().phase).toBe('active');
    expect(['pending', 'ok']).toContain(controller.getState().verification);
    expect(adapter.applied?.host).toBe('127.0.0.1');
    const db = await store.read();
    expect(db.runtime.intent).toBe('on');
    expect(db.runtime.profileId).toBe('p1');
    expect(db.runtime.snapshot).toBeDefined();
    expect(db.settings.activeProfileId).toBe('p1');
  });

  it('rejects profiles that a browser-only extension cannot run', async () => {
    const vless = profile({ id: 'v1', protocol: 'vless', connectKind: undefined });
    const { controller } = await setup([vless]);
    const result = await controller.connect('v1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROFILE_NOT_CONNECTABLE');
    expect(controller.getState().phase).toBe('error');
  });

  it('rejects proxy credentials when the browser cannot supply them', async () => {
    const authProfile = profile({ credentials: { kind: 'password', username: 'u', password: 'p' } });
    const { controller } = await setup([authProfile]);
    const result = await controller.connect('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AUTH_UNSUPPORTED');
  });

  it('rolls back and reports apply failures', async () => {
    const { adapter, controller, store } = await setup();
    adapter.failApply = true;
    const result = await controller.connect('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('APPLY_FAILED');
    expect(adapter.restores).toHaveLength(1);
    const db = await store.read();
    expect(db.runtime.intent).toBe('off');
  });

  it('rolls back when the browser does not keep the configuration', async () => {
    const { adapter, controller } = await setup();
    adapter.failVerify = true;
    const result = await controller.connect('p1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('VERIFY_FAILED');
    expect(adapter.restores).toHaveLength(1);
    expect(controller.getState().phase).toBe('error');
  });

  it('restores the captured snapshot on disconnect', async () => {
    const { adapter, controller, store } = await setup();
    await controller.connect('p1');
    const result = await controller.disconnect();
    expect(result.ok).toBe(true);
    expect(adapter.restores).toHaveLength(1);
    expect(adapter.restores[0]?.proxy).toEqual({ mode: 'system' });
    const db = await store.read();
    expect(db.runtime.intent).toBe('off');
    expect(controller.getState().phase).toBe('idle');
  });

  it('keeps the intent and surfaces errors when restore fails', async () => {
    const { adapter, controller, store } = await setup();
    await controller.connect('p1');
    adapter.failRestore = true;
    const result = await controller.disconnect();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RESTORE_FAILED');
    const db = await store.read();
    expect(db.runtime.intent).toBe('on');
  });

  it('re-applies the proxy after a restart when the browser lost the setting', async () => {
    const { adapter, controller, store } = await setup();
    await controller.connect('p1');
    adapter.applied = null;
    const state = await controller.reconcile();
    expect(state.phase).toBe('active');
    const applied = adapter.applied as ProxyTarget | null;
    expect(applied?.port).toBe(1080);
    expect((await store.read()).runtime.intent).toBe('on');
  });

  it('clears a stale intent and restores settings when the profile is gone', async () => {
    const { adapter, controller, store } = await setup();
    await controller.connect('p1');
    await store.mutate((db) => {
      db.profiles = [];
    });
    const state = await controller.reconcile();
    expect(state.phase).toBe('idle');
    expect(adapter.restores).toHaveLength(1);
    expect((await store.read()).runtime.intent).toBe('off');
  });

  it('keeps the connection active when the health check fails', async () => {
    const area = new MemoryStorageArea();
    const store = new DatabaseStore(area);
    await store.mutate((db) => {
      db.profiles = [profile()];
    });
    const adapter = new FakeAdapter();
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const controller = new ConnectionController({ store, adapter, fetchFn, now: () => 1000 });
    const result = await controller.connect('p1');
    expect(result.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const state = controller.getState();
    expect(state.phase).toBe('active');
    expect(state.verification).toBe('failed');
  });

  it('marks verification ok with latency when the probe succeeds', async () => {
    const area = new MemoryStorageArea();
    const store = new DatabaseStore(area);
    await store.mutate((db) => {
      db.profiles = [profile()];
    });
    const adapter = new FakeAdapter();
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const controller = new ConnectionController({ store, adapter, fetchFn, now: () => 1000 });
    await controller.connect('p1');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.getState().verification).toBe('ok');
  });
});
