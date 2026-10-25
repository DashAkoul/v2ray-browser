import { describe, expect, it } from 'vitest';
import {
  DatabaseStore,
  MemoryStorageArea,
  buildExportBundle,
  createEmptyDatabase,
  parseExportBundle,
  DB_KEY,
  type Database,
} from '../src/index';
import type { Profile } from '@v2rb/shared';

function validProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'p1',
    name: 'Local SOCKS',
    protocol: 'socks5',
    host: '127.0.0.1',
    port: 1080,
    credentials: { kind: 'password', username: 'u', password: 'secret' },
    transport: { type: 'tcp' },
    security: { type: 'none' },
    tags: ['local'],
    source: { type: 'uri', importedAt: 1 },
    rawUri: 'socks5://u:secret@127.0.0.1:1080#Local',
    unknown: {},
    connectKind: 'socks5',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('DatabaseStore', () => {
  it('returns defaults when storage is empty', async () => {
    const store = new DatabaseStore(new MemoryStorageArea());
    const db = await store.read();
    expect(db.profiles).toEqual([]);
    expect(db.settings.theme).toBe('system');
    expect(db.runtime.intent).toBe('off');
  });

  it('persists mutations and reloads them from a fresh store instance', async () => {
    const area = new MemoryStorageArea();
    const store = new DatabaseStore(area);
    await store.mutate((db) => {
      db.profiles.push(validProfile());
      db.settings.activeProfileId = 'p1';
    });
    const reloaded = new DatabaseStore(area);
    const db = await reloaded.read();
    expect(db.profiles).toHaveLength(1);
    expect(db.profiles[0]?.name).toBe('Local SOCKS');
    expect(db.settings.activeProfileId).toBe('p1');
  });

  it('serializes concurrent mutations without losing writes', async () => {
    const store = new DatabaseStore(new MemoryStorageArea());
    await Promise.all([
      store.mutate(async (db) => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        db.profiles.push(validProfile({ id: 'a' }));
      }),
      store.mutate((db) => {
        db.profiles.push(validProfile({ id: 'b' }));
      }),
    ]);
    const db = await store.read();
    expect(db.profiles.map((profile) => profile.id).sort()).toEqual(['a', 'b']);
  });

  it('repairs missing settings fields without losing profiles', async () => {
    const area = new MemoryStorageArea({
      [DB_KEY]: {
        schemaVersion: 1,
        settings: { theme: 'dark' },
        profiles: [validProfile()],
        subscriptions: [],
      },
    });
    const store = new DatabaseStore(area);
    const db = await store.read();
    expect(db.settings.theme).toBe('dark');
    expect(db.settings.healthCheck.enabled).toBe(true);
    expect(db.profiles).toHaveLength(1);
    expect(db.runtime.intent).toBe('off');
  });

  it('drops corrupt profiles but keeps valid ones and quarantines the original', async () => {
    const area = new MemoryStorageArea({
      [DB_KEY]: {
        schemaVersion: 1,
        settings: {},
        profiles: [validProfile(), { id: 'broken' }, { ...validProfile({ id: 'p2' }), port: 99999 }],
        subscriptions: [{ id: 's', url: 'https://x' }],
      },
    });
    const store = new DatabaseStore(area);
    const db = await store.read();
    expect(db.profiles).toHaveLength(1);
    expect(db.subscriptions).toHaveLength(0);
    expect(store.getIssues().some((issue) => issue.kind === 'repaired')).toBe(true);
    const keys = Object.keys(area.snapshot());
    expect(keys.some((key) => key.startsWith('v2rb.corrupt.'))).toBe(true);
  });

  it('recovers from a completely unreadable document', async () => {
    const area = new MemoryStorageArea({ [DB_KEY]: 'not-an-object' });
    const store = new DatabaseStore(area);
    const db = await store.read();
    expect(db.profiles).toEqual([]);
    expect(db.schemaVersion).toBe(1);
  });
});

describe('export and import', () => {
  const db: Database = { ...createEmptyDatabase(), profiles: [validProfile()] };

  it('includes secrets only when requested', () => {
    const withSecrets = buildExportBundle(db, true);
    expect(withSecrets.profiles[0]?.credentials.password).toBe('secret');
    expect(withSecrets.profiles[0]?.rawUri).toContain('socks5://');

    const withoutSecrets = buildExportBundle(db, false);
    expect(withoutSecrets.profiles[0]?.credentials).toEqual({ kind: 'none' });
    expect(withoutSecrets.profiles[0]?.rawUri).toBeUndefined();
    expect(withoutSecrets.subscriptions).toBeUndefined();
  });

  it('round trips a secrets export', () => {
    const bundle = buildExportBundle(db, true);
    const parsed = parseExportBundle(JSON.parse(JSON.stringify(bundle)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.profiles).toHaveLength(1);
      expect(parsed.value.profiles[0]?.credentials.password).toBe('secret');
    }
  });

  it('rejects foreign files', () => {
    expect(parseExportBundle({ hello: 'world' }).ok).toBe(false);
    expect(parseExportBundle(null).ok).toBe(false);
  });

  it('rejects bundles from a newer version', () => {
    const result = parseExportBundle({
      format: 'v2ray-browser.export',
      version: 99,
      profiles: [validProfile()],
    });
    expect(result.ok).toBe(false);
  });

  it('reports invalid profile entries while importing valid ones', () => {
    const result = parseExportBundle({
      format: 'v2ray-browser.export',
      version: 1,
      profiles: [validProfile(), { id: 'x', protocol: 'nope' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.profiles).toHaveLength(1);
      expect(result.value.rejected).toBe(1);
    }
  });
});
