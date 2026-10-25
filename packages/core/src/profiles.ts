import type { ExportBundle, Profile, ProfileSourceType } from '@v2rb/shared';
import {
  profileFingerprint,
  parseInput,
  toShareLink,
  type ParseFailure,
  type ParsedProfile,
} from '@v2rb/parser';
import { buildExportBundle, parseExportBundle, type DatabaseStore } from '@v2rb/storage';
import { AppError } from './errors';

export interface AddResult {
  added: Profile[];
  duplicates: Profile[];
  failures: ParseFailure[];
}

export interface RemoveResult {
  removed: Profile | null;
  clearedActive: boolean;
  wasConnected: boolean;
}

export const MAX_PROFILES = 2000;

export interface ProfileServiceOptions {
  now?: () => number;
  newId?: () => string;
}

export class ProfileService {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(
    private readonly store: DatabaseStore,
    options: ProfileServiceOptions = {},
  ) {
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
  }

  async addFromText(
    input: string,
    source: ProfileSourceType = 'uri',
    subscriptionId?: string,
  ): Promise<AddResult> {
    const parsed = parseInput(input, { source, maxBytes: 1024 * 1024 });
    if (!parsed.ok) {
      throw new AppError('PARSE', parsed.error.message, parsed.error.code);
    }
    return this.addDrafts(parsed.profiles, source, subscriptionId, parsed.failures);
  }

  async addDrafts(
    drafts: ParsedProfile[],
    source: ProfileSourceType = 'uri',
    subscriptionId?: string,
    failures: ParseFailure[] = [],
  ): Promise<AddResult> {
    if (drafts.length === 0) {
      return { added: [], duplicates: [], failures };
    }
    return this.store.mutate((db) => {
      const byFingerprint = new Map<string, Profile>();
      for (const profile of db.profiles) {
        byFingerprint.set(profileFingerprint(profile), profile);
      }
      const added: Profile[] = [];
      const duplicates: Profile[] = [];
      const newFailures = [...failures];
      for (const draft of drafts) {
        if (db.profiles.length + added.length >= MAX_PROFILES) {
          newFailures.push({
            input: draft.name,
            error: { code: 'TOO_LARGE', message: `Profile limit of ${MAX_PROFILES} reached` },
          });
          continue;
        }
        const fingerprint = profileFingerprint(draft);
        const existing = byFingerprint.get(fingerprint);
        if (existing) {
          duplicates.push(existing);
          continue;
        }
        const timestamp = this.now();
        const profile: Profile = {
          ...draft,
          id: this.newId(),
          source: {
            type: source,
            importedAt: timestamp,
            ...(subscriptionId ? { subscriptionId } : {}),
          },
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        db.profiles.push(profile);
        byFingerprint.set(fingerprint, profile);
        added.push(profile);
      }
      return { added, duplicates, failures: newFailures };
    });
  }

  async update(id: string, patch: Partial<Profile>): Promise<Profile> {
    return this.store.mutate((db) => {
      const profile = db.profiles.find((entry) => entry.id === id);
      if (!profile) throw new AppError('NOT_FOUND', 'Configuration not found');
      if (patch.name !== undefined) {
        const name = patch.name.trim();
        if (!name) throw new AppError('VALIDATION', 'Name cannot be empty');
        if (name.length > 200) throw new AppError('VALIDATION', 'Name is too long');
        profile.name = name;
      }
      if (patch.host !== undefined) {
        const host = patch.host.trim().toLowerCase();
        if (!host || host.length > 253 || /\s/.test(host)) {
          throw new AppError('VALIDATION', 'Host is invalid');
        }
        profile.host = host.replace(/^\[|\]$/g, '');
      }
      if (patch.port !== undefined) {
        if (!Number.isInteger(patch.port) || patch.port < 1 || patch.port > 65535) {
          throw new AppError('VALIDATION', 'Port must be between 1 and 65535');
        }
        profile.port = patch.port;
      }
      if (patch.tags !== undefined) {
        profile.tags = patch.tags
          .map((tag) => tag.trim())
          .filter((tag) => tag.length > 0 && tag.length <= 40)
          .slice(0, 30);
      }
      if (patch.group !== undefined) {
        const group = patch.group.trim();
        if (group.length > 80) throw new AppError('VALIDATION', 'Group name is too long');
        profile.group = group || undefined;
      }
      if (patch.credentials) {
        profile.credentials = { ...profile.credentials, ...patch.credentials };
      }
      if (patch.security) {
        profile.security = { ...profile.security, ...patch.security };
      }
      if (patch.transport) {
        profile.transport = { ...profile.transport, ...patch.transport };
      }
      profile.updatedAt = this.now();
      return structuredClone(profile);
    });
  }

  async remove(id: string): Promise<RemoveResult> {
    return this.store.mutate((db) => {
      const index = db.profiles.findIndex((entry) => entry.id === id);
      if (index < 0) return { removed: null, clearedActive: false, wasConnected: false };
      const [removed] = db.profiles.splice(index, 1);
      const clearedActive = db.settings.activeProfileId === id;
      if (clearedActive) db.settings.activeProfileId = null;
      return {
        removed: removed ?? null,
        clearedActive,
        wasConnected: db.runtime.intent === 'on' && db.runtime.profileId === id,
      };
    });
  }

  async setActive(id: string | null): Promise<void> {
    await this.store.mutate((db) => {
      if (id !== null && !db.profiles.some((profile) => profile.id === id)) {
        throw new AppError('NOT_FOUND', 'Configuration not found');
      }
      db.settings.activeProfileId = id;
    });
  }

  async clearAll(): Promise<number> {
    return this.store.mutate((db) => {
      const count = db.profiles.length;
      db.profiles = [];
      db.settings.activeProfileId = null;
      return count;
    });
  }

  async exportBundle(includeSecrets: boolean): Promise<ExportBundle> {
    const db = await this.store.read();
    return buildExportBundle(db, includeSecrets);
  }

  async importBundle(input: unknown, mode: 'merge' | 'replace'): Promise<{ added: number; skipped: number }> {
    const parsed = parseExportBundle(input);
    if (!parsed.ok) throw new AppError('VALIDATION', parsed.error);
    return this.store.mutate((db) => {
      if (mode === 'replace') {
        db.profiles = [];
        db.settings.activeProfileId = null;
      }
      const fingerprints = new Set(db.profiles.map((profile) => profileFingerprint(profile)));
      let added = 0;
      let skipped = parsed.value.rejected;
      for (const profile of parsed.value.profiles) {
        if (db.profiles.length >= MAX_PROFILES) {
          skipped += 1;
          continue;
        }
        const fingerprint = profileFingerprint(profile);
        if (fingerprints.has(fingerprint)) {
          skipped += 1;
          continue;
        }
        fingerprints.add(fingerprint);
        const timestamp = this.now();
        db.profiles.push({
          ...profile,
          id: this.newId(),
          createdAt: profile.createdAt || timestamp,
          updatedAt: timestamp,
        });
        added += 1;
      }
      const settingsPatch = parsed.value.settings;
      if (settingsPatch && typeof settingsPatch === 'object') {
        if (settingsPatch.theme === 'system' || settingsPatch.theme === 'light' || settingsPatch.theme === 'dark') {
          db.settings.theme = settingsPatch.theme;
        }
        if (settingsPatch.locale === 'auto' || settingsPatch.locale === 'en' || settingsPatch.locale === 'fa') {
          db.settings.locale = settingsPatch.locale;
        }
        if (Array.isArray(settingsPatch.bypassList)) {
          db.settings.bypassList = settingsPatch.bypassList.filter((item): item is string => typeof item === 'string').slice(0, 100);
        }
      }
      return { added, skipped };
    });
  }

  async shareLink(profile: Profile): Promise<string> {
    return profile.rawUri ?? toShareLink(profile);
  }
}
