import { z } from 'zod';
import type { ConnectionError } from '@v2rb/shared';
import {
  CONNECT_KINDS,
  DEFAULT_SETTINGS,
  PROTOCOLS,
  TRANSPORT_TYPES,
  type Database,
  type Settings,
} from './types';

const credentialsSchema = z.object({
  kind: z.enum(['none', 'uuid', 'password', 'method-password']),
  uuid: z.string().optional(),
  password: z.string().optional(),
  method: z.string().optional(),
  flow: z.string().optional(),
  username: z.string().optional(),
});

const transportSchema = z.object({
  type: z.enum(TRANSPORT_TYPES),
  path: z.string().optional(),
  host: z.string().optional(),
  serviceName: z.string().optional(),
  mode: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

const securitySchema = z.object({
  type: z.enum(['none', 'tls', 'reality']),
  sni: z.string().optional(),
  alpn: z.array(z.string()).optional(),
  fingerprint: z.string().optional(),
  publicKey: z.string().optional(),
  shortId: z.string().optional(),
  allowInsecure: z.boolean().optional(),
});

const sourceSchema = z.object({
  type: z.enum(['manual', 'uri', 'paste', 'file', 'clipboard', 'subscription', 'config']),
  subscriptionId: z.string().optional(),
  importedAt: z.number(),
});

export const profileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(200),
  protocol: z.enum(PROTOCOLS),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535),
  credentials: credentialsSchema,
  transport: transportSchema,
  security: securitySchema,
  tags: z.array(z.string().max(40)).max(30),
  group: z.string().max(80).optional(),
  source: sourceSchema,
  rawUri: z.string().max(20000).optional(),
  unknown: z.record(z.string(), z.string()),
  connectKind: z.enum(CONNECT_KINDS).optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastUsedAt: z.number().optional(),
});

export const subscriptionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  url: z.string().min(1).max(4000),
  enabled: z.boolean(),
  lastUpdatedAt: z.number().optional(),
  lastError: z.string().max(500).optional(),
  profileCount: z.number().int().min(0),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const settingsSchema = z.object({
  locale: z.enum(['auto', 'en', 'fa']),
  theme: z.enum(['system', 'light', 'dark']),
  activeProfileId: z.string().nullable(),
  bypassList: z.array(z.string().max(200)).max(100),
  healthCheck: z.object({
    enabled: z.boolean(),
    url: z.string().max(2000),
    timeoutMs: z.number().int().min(500).max(60000),
  }),
  webRtcLeakGuard: z.boolean(),
  subscriptionAutoRefresh: z.object({
    enabled: z.boolean(),
    staleAfterHours: z.number().int().min(1).max(720),
  }),
  onboardingCompleted: z.boolean(),
});

const runtimeSchema = z.object({
  intent: z.enum(['on', 'off']),
  profileId: z.string().nullable(),
  appliedAt: z.number().optional(),
  snapshot: z.unknown().optional(),
  lastError: z.unknown().optional(),
});

export const databaseSchema = z.object({
  schemaVersion: z.number().int().min(1),
  settings: settingsSchema,
  profiles: z.array(profileSchema),
  subscriptions: z.array(subscriptionSchema),
  runtime: runtimeSchema,
});

export interface NormalizeResult {
  db: Database;
  repaired: boolean;
  droppedProfiles: number;
  droppedSubscriptions: number;
}

function mergeSettings(raw: unknown): { settings: Settings; repaired: boolean } {
  const parsed = settingsSchema.safeParse(raw);
  if (parsed.success) return { settings: parsed.data, repaired: false };
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const healthCheck =
    typeof candidate['healthCheck'] === 'object' && candidate['healthCheck'] !== null
      ? (candidate['healthCheck'] as Record<string, unknown>)
      : {};
  const autoRefresh =
    typeof candidate['subscriptionAutoRefresh'] === 'object' && candidate['subscriptionAutoRefresh'] !== null
      ? (candidate['subscriptionAutoRefresh'] as Record<string, unknown>)
      : {};
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    locale: (['auto', 'en', 'fa'] as unknown[]).includes(candidate['locale'])
      ? (candidate['locale'] as Settings['locale'])
      : DEFAULT_SETTINGS.locale,
    theme: (['system', 'light', 'dark'] as unknown[]).includes(candidate['theme'])
      ? (candidate['theme'] as Settings['theme'])
      : DEFAULT_SETTINGS.theme,
    activeProfileId: typeof candidate['activeProfileId'] === 'string' ? candidate['activeProfileId'] : null,
    bypassList: Array.isArray(candidate['bypassList'])
      ? (candidate['bypassList'] as unknown[]).filter((item): item is string => typeof item === 'string')
      : DEFAULT_SETTINGS.bypassList,
    healthCheck: {
      enabled:
        typeof healthCheck['enabled'] === 'boolean' ? healthCheck['enabled'] : DEFAULT_SETTINGS.healthCheck.enabled,
      url: typeof healthCheck['url'] === 'string' ? healthCheck['url'] : DEFAULT_SETTINGS.healthCheck.url,
      timeoutMs:
        typeof healthCheck['timeoutMs'] === 'number'
          ? Math.min(Math.max(healthCheck['timeoutMs'], 500), 60000)
          : DEFAULT_SETTINGS.healthCheck.timeoutMs,
    },
    webRtcLeakGuard:
      typeof candidate['webRtcLeakGuard'] === 'boolean'
        ? candidate['webRtcLeakGuard']
        : DEFAULT_SETTINGS.webRtcLeakGuard,
    subscriptionAutoRefresh: {
      enabled:
        typeof autoRefresh['enabled'] === 'boolean'
          ? autoRefresh['enabled']
          : DEFAULT_SETTINGS.subscriptionAutoRefresh.enabled,
      staleAfterHours:
        typeof autoRefresh['staleAfterHours'] === 'number'
          ? Math.min(Math.max(autoRefresh['staleAfterHours'], 1), 720)
          : DEFAULT_SETTINGS.subscriptionAutoRefresh.staleAfterHours,
    },
    onboardingCompleted:
      typeof candidate['onboardingCompleted'] === 'boolean'
        ? candidate['onboardingCompleted']
        : DEFAULT_SETTINGS.onboardingCompleted,
  };
  return { settings: merged, repaired: true };
}

/**
 * Repair stored data instead of discarding it: settings merge with defaults and
 * individual corrupt profiles/subscriptions are dropped while valid entries
 * survive. Never throws.
 */
export function normalizeDatabase(raw: unknown): NormalizeResult {
  const candidate = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const { settings, repaired: settingsRepaired } = mergeSettings(candidate['settings']);

  let droppedProfiles = 0;
  const profiles = [];
  for (const entry of Array.isArray(candidate['profiles']) ? candidate['profiles'] : []) {
    const parsed = profileSchema.safeParse(entry);
    if (parsed.success) profiles.push(parsed.data);
    else droppedProfiles += 1;
  }

  let droppedSubscriptions = 0;
  const subscriptions = [];
  for (const entry of Array.isArray(candidate['subscriptions']) ? candidate['subscriptions'] : []) {
    const parsed = subscriptionSchema.safeParse(entry);
    if (parsed.success) subscriptions.push(parsed.data);
    else droppedSubscriptions += 1;
  }

  const runtimeParsed = runtimeSchema.safeParse(candidate['runtime']);
  const runtime = runtimeParsed.success
    ? {
        intent: runtimeParsed.data.intent,
        profileId: runtimeParsed.data.profileId,
        ...(runtimeParsed.data.appliedAt !== undefined ? { appliedAt: runtimeParsed.data.appliedAt } : {}),
        ...(runtimeParsed.data.snapshot !== undefined ? { snapshot: runtimeParsed.data.snapshot } : {}),
        ...(runtimeParsed.data.lastError
          ? { lastError: runtimeParsed.data.lastError as ConnectionError }
          : {}),
      }
    : { intent: 'off' as const, profileId: null };

  const version = typeof candidate['schemaVersion'] === 'number' ? candidate['schemaVersion'] : 1;
  const db: Database = {
    schemaVersion: Math.max(1, Math.min(version, 1)),
    settings,
    profiles,
    subscriptions,
    runtime,
  };
  const repaired = settingsRepaired || droppedProfiles > 0 || droppedSubscriptions > 0 || !runtimeParsed.success;
  return { db, repaired, droppedProfiles, droppedSubscriptions };
}
