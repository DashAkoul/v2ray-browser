import type { Profile, RuntimeState, Settings, Subscription } from '@v2rb/shared';

export {
  DB_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  PROTOCOLS,
  CONNECT_KINDS,
  TRANSPORT_TYPES,
} from '@v2rb/shared';
export type { Profile, RuntimeState, Settings, Subscription } from '@v2rb/shared';

export interface Database {
  schemaVersion: number;
  settings: Settings;
  profiles: Profile[];
  subscriptions: Subscription[];
  runtime: RuntimeState;
}

/** Minimal promise-based storage area, compatible with chrome.storage.local and browser.storage.local. */
export interface StorageArea {
  get<T = unknown>(keys: string[]): Promise<Record<string, T | undefined>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface StorageIssue {
  kind: 'corrupt' | 'repaired' | 'write-failed';
  message: string;
  at: number;
}

export interface ExportOptions {
  includeSecrets: boolean;
}
