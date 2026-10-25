import type { Subscription } from '@v2rb/shared';
import { parseSubscriptionBody, profileFingerprint, sanitizeText, SUBSCRIPTION_MAX_BYTES } from '@v2rb/parser';
import type { DatabaseStore } from '@v2rb/storage';
import { AppError } from './errors';

export const SUBSCRIPTION_TIMEOUT_MS = 15000;

export interface SubscriptionServiceOptions {
  fetchFn?: typeof fetch;
  now?: () => number;
  newId?: () => string;
  timeoutMs?: number;
}

export type RefreshResult =
  | { ok: true; added: number; removed: number; subscription: Subscription; needsReconcile: boolean }
  | { ok: false; error: string; subscription: Subscription | null };

export class SubscriptionService {
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly timeoutMs: number;

  constructor(
    private readonly store: DatabaseStore,
    options: SubscriptionServiceOptions = {},
  ) {
    this.fetchFn = options.fetchFn ?? (typeof fetch === 'function' ? fetch : undefined);
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? (() => crypto.randomUUID());
    this.timeoutMs = options.timeoutMs ?? SUBSCRIPTION_TIMEOUT_MS;
  }

  async add(input: string, name?: string): Promise<Subscription> {
    const url = this.validateUrl(input);
    const timestamp = this.now();
    return this.store.mutate((db) => {
      if (db.subscriptions.length >= 50) {
        throw new AppError('LIMIT', 'Subscription limit reached');
      }
      if (db.subscriptions.some((subscription) => subscription.url === url)) {
        throw new AppError('DUPLICATE', 'This subscription is already added');
      }
      const subscription: Subscription = {
        id: this.newId(),
        name: (name ?? '').trim() || new URL(url).hostname,
        url,
        enabled: true,
        profileCount: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      db.subscriptions.push(subscription);
      return structuredClone(subscription);
    });
  }

  async remove(id: string): Promise<{ removed: boolean; profilesRemoved: number; needsReconcile: boolean }> {
    return this.store.mutate((db) => {
      const index = db.subscriptions.findIndex((subscription) => subscription.id === id);
      if (index < 0) return { removed: false, profilesRemoved: 0, needsReconcile: false };
      db.subscriptions.splice(index, 1);
      const before = db.profiles.length;
      const connected = db.profiles.find((profile) => profile.source.subscriptionId === id && profile.id === db.runtime.profileId);
      db.profiles = db.profiles.filter((profile) => profile.source.subscriptionId !== id);
      if (db.settings.activeProfileId && !db.profiles.some((profile) => profile.id === db.settings.activeProfileId)) {
        db.settings.activeProfileId = null;
      }
      return {
        removed: true,
        profilesRemoved: before - db.profiles.length,
        needsReconcile: Boolean(connected),
      };
    });
  }

  async refresh(id: string): Promise<RefreshResult> {
    const db = await this.store.read();
    const subscription = db.subscriptions.find((entry) => entry.id === id);
    if (!subscription) throw new AppError('NOT_FOUND', 'Subscription not found');
    try {
      const body = await this.fetchBody(subscription.url);
      const parsed = parseSubscriptionBody(body);
      if (!parsed.ok) {
        return await this.recordFailure(subscription, `Could not parse subscription: ${parsed.error.message}`);
      }
      if (parsed.profiles.length === 0) {
        return await this.recordFailure(subscription, 'Subscription did not contain any supported configuration');
      }
      const timestamp = this.now();
      return await this.store.mutate((draft) => {
        const target = draft.subscriptions.find((entry) => entry.id === id);
        if (!target) throw new AppError('NOT_FOUND', 'Subscription not found');
        const previousIds = new Set<string>();
        const fingerprints = new Set<string>();
        for (const profile of draft.profiles) {
          if (profile.source.subscriptionId === id) previousIds.add(profile.id);
          else fingerprints.add(profileFingerprint(profile));
        }
        const wasConnected = draft.runtime.intent === 'on' && draft.runtime.profileId !== null && previousIds.has(draft.runtime.profileId);
        const kept = draft.profiles.filter((profile) => profile.source.subscriptionId !== id);
        let added = 0;
        for (const parsedProfile of parsed.profiles) {
          const fingerprint = profileFingerprint(parsedProfile);
          if (fingerprints.has(fingerprint)) continue;
          fingerprints.add(fingerprint);
          kept.push({
            ...parsedProfile,
            id: this.newId(),
            source: { type: 'subscription', subscriptionId: id, importedAt: timestamp },
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          added += 1;
        }
        draft.profiles = kept;
        if (draft.settings.activeProfileId && !kept.some((profile) => profile.id === draft.settings.activeProfileId)) {
          draft.settings.activeProfileId = null;
        }
        target.lastUpdatedAt = timestamp;
        target.updatedAt = timestamp;
        target.profileCount = added;
        delete target.lastError;
        return {
          ok: true as const,
          added,
          removed: previousIds.size,
          subscription: structuredClone(target),
          needsReconcile: wasConnected,
        };
      });
    } catch (error) {
      const message = error instanceof AppError ? error.message : sanitizeText(error instanceof Error ? error.message : 'Subscription request failed');
      return await this.recordFailure(subscription, message);
    }
  }

  /** Refresh subscriptions older than the configured threshold. Returns how many were refreshed. */
  async refreshStale(staleAfterHours: number): Promise<number> {
    const db = await this.store.read();
    const threshold = this.now() - staleAfterHours * 3600_000;
    const stale = db.subscriptions.filter(
      (subscription) => subscription.enabled && (subscription.lastUpdatedAt ?? 0) < threshold,
    );
    let refreshed = 0;
    for (const subscription of stale) {
      const result = await this.refresh(subscription.id);
      if (result.ok) refreshed += 1;
    }
    return refreshed;
  }

  private async recordFailure(subscription: Subscription, message: string): Promise<RefreshResult> {
    const clean = sanitizeText(message).slice(0, 300);
    await this.store.mutate((db) => {
      const target = db.subscriptions.find((entry) => entry.id === subscription.id);
      if (target) {
        target.lastError = clean;
        target.updatedAt = this.now();
      }
    });
    return { ok: false, error: clean, subscription: { ...subscription, lastError: clean } };
  }

  private validateUrl(input: string): string {
    let url: URL;
    try {
      url = new URL(input.trim());
    } catch {
      throw new AppError('VALIDATION', 'Subscription URL is invalid');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new AppError('VALIDATION', 'Subscription URL must use http or https');
    }
    if (url.username || url.password) {
      throw new AppError('VALIDATION', 'Subscription URL must not contain credentials');
    }
    return url.toString();
  }

  private async fetchBody(url: string): Promise<string> {
    if (!this.fetchFn) throw new AppError('SUBSCRIPTION', 'Network access is unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchFn(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        headers: { Accept: 'text/plain, */*' },
      });
      if (!response.ok) {
        throw new AppError('SUBSCRIPTION', `Subscription returned HTTP ${response.status}`);
      }
      return await readLimited(response, SUBSCRIPTION_MAX_BYTES);
    } catch (error) {
      if (error instanceof AppError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new AppError('SUBSCRIPTION', aborted ? 'Subscription request timed out' : 'Could not download subscription');
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new AppError('LIMIT', 'Subscription response is too large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > maxBytes) {
      throw new AppError('LIMIT', 'Subscription response is too large');
    }
    return text;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('LIMIT', 'Subscription response is too large');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}
