import type {
  ConnectionState,
  ProxyCapabilities,
  Settings,
  Subscription,
  Profile,
} from '@v2rb/shared';
import type { StorageIssue } from '@v2rb/storage';

export interface AppSnapshot {
  connection: ConnectionState;
  settings: Settings;
  profiles: Profile[];
  subscriptions: Subscription[];
  capabilities: ProxyCapabilities | null;
  issues: StorageIssue[];
  browser: 'chrome' | 'firefox';
  version: string;
}

export const STATE_CHANNEL = 'v2rb:state';

export interface StateMessage {
  channel: typeof STATE_CHANNEL;
  snapshot: AppSnapshot;
}

export function isStateMessage(value: unknown): value is StateMessage {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['channel'] === STATE_CHANNEL && typeof record['snapshot'] === 'object';
}

export interface RpcErrorPayload {
  code: string;
  message: string;
  detail?: string;
}

export type RpcResponse<T> = { ok: true; data: T } | { ok: false; error: RpcErrorPayload };
