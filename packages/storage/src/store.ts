import { DEFAULT_SETTINGS, DB_SCHEMA_VERSION } from '@v2rb/shared';
import { migrate } from './migrations';
import type { Database, StorageArea, StorageIssue } from './types';

export const DB_KEY = 'v2rb.db';
export const CORRUPT_KEY_PREFIX = 'v2rb.corrupt.';

export function createEmptyDatabase(): Database {
  return {
    schemaVersion: DB_SCHEMA_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    profiles: [],
    subscriptions: [],
    runtime: { intent: 'off', profileId: null },
  };
}

export interface StoreOptions {
  now?: () => number;
  /** Maximum quarantined copiess kept in storage. */
  maxQuarantine?: number;
}

/**
 * Single-writer database on top of a StorageArea. All mutations are serialized
 * through an in-memory queue so two UI surfaces cannot clobber each other, and
 * each mutation is written as one atomic set() of the whole document.
 */
export class DatabaseStore {
  private cache: Database | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private issues: StorageIssue[] = [];
  private readonly now: () => number;
  private readonly maxQuarantine: number;

  constructor(
    private readonly area: StorageArea,
    options: StoreOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.maxQuarantine = options.maxQuarantine ?? 3;
  }

  getIssues(): StorageIssue[] {
    return [...this.issues];
  }

  private recordIssue(kind: StorageIssue['kind'], message: string): void {
    this.issues.push({ kind, message, at: this.now() });
    if (this.issues.length > 20) this.issues.shift();
  }

  async read(): Promise<Database> {
    if (this.cache) return this.cache;
    const stored = await this.area.get([DB_KEY]);
    const raw = stored[DB_KEY];
    if (raw === undefined) {
      this.cache = createEmptyDatabase();
      return this.cache;
    }
    const result = migrate(raw);
    if (result.repaired || result.futureVersion) {
      const detail = JSON.stringify({
        fromVersion: result.fromVersion,
        droppedProfiles: result.droppedProfiles,
        droppedSubscriptions: result.droppedSubscriptions,
        futureVersion: result.futureVersion,
      });
      this.recordIssue('repaired', `Stored data was repaired (${detail})`);
      await this.quarantine(raw);
      await this.area.set({ [DB_KEY]: result.db });
    }
    this.cache = result.db;
    return this.cache;
  }

  /** Serialized read-modify-write. The mutator may mutate the draft in place. */
  async mutate<T>(mutator: (db: Database) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const db = await this.read();
      const draft = structuredClone(db);
      const result = await mutator(draft);
      draft.schemaVersion = DB_SCHEMA_VERSION;
      try {
        await this.area.set({ [DB_KEY]: draft });
      } catch (error) {
        this.recordIssue('write-failed', error instanceof Error ? error.message : 'Unknown write failure');
        throw error;
      }
      this.cache = draft;
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async replace(next: Database): Promise<void> {
    await this.mutate((draft) => {
      draft.settings = next.settings;
      draft.profiles = next.profiles;
      draft.subscriptions = next.subscriptions;
      draft.runtime = next.runtime;
    });
  }

  /** Drop the in-memory cache so the next read comes from storage. */
  invalidate(): void {
    this.cache = null;
  }

  private async quarantine(raw: unknown): Promise<void> {
    try {
      const all = await this.area.get([DB_KEY]);
      const keys = Object.keys(all).filter((key) => key.startsWith(CORRUPT_KEY_PREFIX)).sort();
      while (keys.length >= this.maxQuarantine) {
        const oldest = keys.shift();
        if (oldest) await this.area.remove([oldest]);
      }
      await this.area.set({ [`${CORRUPT_KEY_PREFIX}${this.now()}`]: raw });
    } catch {
      this.recordIssue('corrupt', 'Could not back up unreadable stored data');
    }
  }
}

/** Adapt chrome.storage.local / browser.storage.local (promise-based in MV3). */
export function createAreaAdapter(area: {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}): StorageArea {
  return {
    get: <T>(keys: string[]) => area.get(keys) as Promise<Record<string, T | undefined>>,
    set: (values) => area.set(values),
    remove: (keys) => area.remove(keys),
    clear: () => area.clear(),
  };
}

/** In-memory area used by tests and as a fallback when storage is unavailable. */
export class MemoryStorageArea implements StorageArea {
  private data = new Map<string, unknown>();

  constructor(seed: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(seed)) this.data.set(key, structuredClone(value));
  }

  async get<T>(keys: string[]): Promise<Record<string, T | undefined>> {
    if (keys.length === 0) {
      const all: Record<string, T | undefined> = {};
      for (const [key, value] of this.data) all[key] = value as T;
      return all;
    }
    const result: Record<string, T | undefined> = {};
    for (const key of keys) result[key] = this.data.get(key) as T | undefined;
    return result;
  }

  async set(values: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(values)) this.data.set(key, structuredClone(value));
  }

  async remove(keys: string[]): Promise<void> {
    for (const key of keys) this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.data);
  }
}
