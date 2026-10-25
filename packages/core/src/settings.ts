import type { Settings } from '@v2rb/shared';
import type { DatabaseStore } from '@v2rb/storage';
import { AppError } from './errors';

export class SettingsService {
  constructor(private readonly store: DatabaseStore) {}

  async update(patch: Partial<Settings>): Promise<Settings> {
    return this.store.mutate((db) => {
      if (patch.locale !== undefined) {
        if (patch.locale !== 'auto' && patch.locale !== 'en' && patch.locale !== 'fa') {
          throw new AppError('VALIDATION', 'Unsupported language');
        }
        db.settings.locale = patch.locale;
      }
      if (patch.theme !== undefined) {
        if (patch.theme !== 'system' && patch.theme !== 'light' && patch.theme !== 'dark') {
          throw new AppError('VALIDATION', 'Unsupported theme');
        }
        db.settings.theme = patch.theme;
      }
      if (patch.activeProfileId !== undefined) {
        if (patch.activeProfileId !== null && !db.profiles.some((profile) => profile.id === patch.activeProfileId)) {
          throw new AppError('NOT_FOUND', 'Configuration not found');
        }
        db.settings.activeProfileId = patch.activeProfileId;
      }
      if (patch.bypassList !== undefined) {
        if (!Array.isArray(patch.bypassList)) throw new AppError('VALIDATION', 'Bypass list must be a list');
        db.settings.bypassList = patch.bypassList
          .map((entry) => String(entry).trim())
          .filter((entry) => entry.length > 0 && entry.length <= 200)
          .slice(0, 100);
      }
      if (patch.healthCheck !== undefined) {
        const { enabled, url, timeoutMs } = patch.healthCheck;
        if (typeof enabled !== 'boolean') throw new AppError('VALIDATION', 'Invalid health check flag');
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new AppError('VALIDATION', 'Health check URL is invalid');
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          throw new AppError('VALIDATION', 'Health check URL must use http or https');
        }
        if (!Number.isFinite(timeoutMs)) throw new AppError('VALIDATION', 'Invalid timeout');
        db.settings.healthCheck = {
          enabled,
          url: parsedUrl.toString(),
          timeoutMs: Math.max(500, Math.min(Math.round(timeoutMs), 60000)),
        };
      }
      if (patch.webRtcLeakGuard !== undefined) {
        db.settings.webRtcLeakGuard = Boolean(patch.webRtcLeakGuard);
      }
      if (patch.subscriptionAutoRefresh !== undefined) {
        const { enabled, staleAfterHours } = patch.subscriptionAutoRefresh;
        if (typeof enabled !== 'boolean' || !Number.isFinite(staleAfterHours)) {
          throw new AppError('VALIDATION', 'Invalid auto refresh settings');
        }
        db.settings.subscriptionAutoRefresh = {
          enabled,
          staleAfterHours: Math.max(1, Math.min(Math.round(staleAfterHours), 720)),
        };
      }
      if (patch.onboardingCompleted !== undefined) {
        db.settings.onboardingCompleted = Boolean(patch.onboardingCompleted);
      }
      return structuredClone(db.settings);
    });
  }
}
