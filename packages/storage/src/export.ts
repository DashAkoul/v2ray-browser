import { APP_NAME, EXPORT_FORMAT, EXPORT_VERSION, type ExportBundle, type Profile, type Settings, type Subscription } from '@v2rb/shared';
import { profileSchema, subscriptionSchema } from './schema';
import type { Database } from './types';

/**
 * Build an export bundle. Without secrets the bundle is a shareable inventory:
 * credentials and raw links are stripped, so it can be committed or pasted.
 */
export function buildExportBundle(db: Database, includeSecrets: boolean): ExportBundle {
  const profiles: Profile[] = db.profiles.map((profile) => {
    if (includeSecrets) return structuredClone(profile);
    const { rawUri: _rawUri, ...rest } = profile;
    return {
      ...structuredClone(rest),
      credentials: { kind: 'none' },
      unknown: {},
    };
  });
  const bundle: ExportBundle = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: Date.now(),
    app: APP_NAME,
    profiles,
  };
  if (includeSecrets) {
    bundle.settings = structuredClone(db.settings);
    bundle.subscriptions = structuredClone(db.subscriptions);
  }
  return bundle;
}

export interface ParsedBundle {
  profiles: Profile[];
  subscriptions: Subscription[];
  settings?: Partial<Settings>;
  rejected: number;
}

export type BundleParseResult = { ok: true; value: ParsedBundle } | { ok: false; error: string };

/** Validate an imported bundle without trusting any field. */
export function parseExportBundle(input: unknown): BundleParseResult {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Import file must contain a JSON object' };
  }
  const record = input as Record<string, unknown>;
  if (record['format'] !== EXPORT_FORMAT) {
    return { ok: false, error: 'Not a V2Ray Browser export file' };
  }
  const version = record['version'];
  if (typeof version !== 'number' || version > EXPORT_VERSION) {
    return { ok: false, error: 'Export file was created by a newer version' };
  }
  const rawProfiles = Array.isArray(record['profiles']) ? record['profiles'] : [];
  if (rawProfiles.length > 10000) {
    return { ok: false, error: 'Export file contains too many profiles' };
  }
  const profiles: Profile[] = [];
  let rejected = 0;
  for (const entry of rawProfiles) {
    const parsed = profileSchema.safeParse(entry);
    if (parsed.success) profiles.push(parsed.data);
    else rejected += 1;
  }
  const subscriptions: Subscription[] = [];
  for (const entry of Array.isArray(record['subscriptions']) ? record['subscriptions'] : []) {
    const parsed = subscriptionSchema.safeParse(entry);
    if (parsed.success) subscriptions.push(parsed.data);
  }
  const settings =
    typeof record['settings'] === 'object' && record['settings'] !== null
      ? (record['settings'] as Partial<Settings>)
      : undefined;
  if (profiles.length === 0 && subscriptions.length === 0) {
    return { ok: false, error: 'No valid configuration found in this file' };
  }
  return { ok: true, value: { profiles, subscriptions, settings, rejected } };
}
