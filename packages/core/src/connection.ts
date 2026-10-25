import type {
  ConnectionError,
  ConnectionErrorCode,
  ConnectionState,
  HealthCheckSettings,
  Profile,
  ProxyCapabilities,
} from '@v2rb/shared';
import {
  ProxyAdapterError,
  describeTarget,
  type AdapterErrorCode,
  type ProxyAdapter,
  type ProxySnapshot,
  type ProxyTarget,
} from '@v2rb/adapters';
import type { DatabaseStore } from '@v2rb/storage';
import { checkProxyHealth } from './health';

const ERROR_CODE_MAP: Record<AdapterErrorCode, ConnectionErrorCode> = {
  UNAVAILABLE: 'PROXY_API_UNAVAILABLE',
  CONTROLLED: 'CONTROLLED_BY_OTHER',
  INCOGNITO_REQUIRED: 'FIREFOX_INCOGNITO_REQUIRED',
  UNSUPPORTED_KIND: 'UNSUPPORTED_IN_BROWSER',
  AUTH_UNSUPPORTED: 'AUTH_UNSUPPORTED',
  APPLY_FAILED: 'APPLY_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED',
  RESTORE_FAILED: 'RESTORE_FAILED',
};

export function initialConnectionState(): ConnectionState {
  return {
    phase: 'idle',
    profileId: null,
    profileName: null,
    profileProtocol: null,
    endpoint: null,
    appliedAt: null,
    verification: 'none',
    latencyMs: null,
    error: null,
    capabilities: null,
  };
}

export function targetFromProfile(profile: Profile, bypassList: string[]): ProxyTarget | null {
  if (!profile.connectKind) return null;
  return {
    connectKind: profile.connectKind,
    host: profile.host,
    port: profile.port,
    ...(profile.credentials.username ? { username: profile.credentials.username } : {}),
    ...(profile.credentials.password ? { password: profile.credentials.password } : {}),
    bypassList,
  };
}

export type ConnectionResult =
  | { ok: true; state: ConnectionState }
  | { ok: false; error: ConnectionError };

export interface ConnectionControllerOptions {
  store: DatabaseStore;
  adapter: ProxyAdapter;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export class ConnectionController {
  private state: ConnectionState = initialConnectionState();
  private capabilities: ProxyCapabilities | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(state: ConnectionState) => void>();
  private initialized = false;
  private readonly store: DatabaseStore;
  private readonly adapter: ProxyAdapter;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => number;

  constructor(options: ConnectionControllerOptions) {
    this.store = options.store;
    this.adapter = options.adapter;
    this.fetchFn = options.fetchFn;
    this.now = options.now ?? (() => Date.now());
  }

  getState(): ConnectionState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: ConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = structuredClone(this.state);
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // listeners must never break the controller
      }
    }
  }

  private setState(patch: Partial<ConnectionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private errorFrom(error: unknown): ConnectionError {
    if (error instanceof ProxyAdapterError) {
      return {
        code: ERROR_CODE_MAP[error.code] ?? 'UNKNOWN',
        message: error.message,
        ...(error.detail ? { detail: error.detail } : {}),
        at: this.now(),
      };
    }
    return {
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Unexpected proxy error',
      at: this.now(),
    };
  }

  private fail(error: ConnectionError): ConnectionResult {
    this.setState({ phase: 'error', error, verification: 'none', latencyMs: null });
    return { ok: false, error };
  }

  private failWith(code: ConnectionErrorCode, message: string, detail?: string): ConnectionResult {
    return this.fail({ code, message, ...(detail ? { detail } : {}), at: this.now() });
  }

  async refreshCapabilities(): Promise<ProxyCapabilities | null> {
    try {
      this.capabilities = await this.adapter.getCapabilities();
    } catch {
      this.capabilities = null;
    }
    this.setState({ capabilities: this.capabilities });
    return this.capabilities;
  }

  /**
   * Reconcile our recorded intent with the browser's actual state. Called on
   * startup / service-worker wake so a restart never leaves the browser in an
   * unknown proxy state.
   */
  async reconcile(): Promise<ConnectionState> {
    return this.run(async () => {
      await this.refreshCapabilities();
      const db = await this.store.read();
      this.initialized = true;
      if (db.runtime.intent === 'on') {
        const profile = db.profiles.find((entry) => entry.id === db.runtime.profileId);
        if (!profile || !profile.connectKind) {
          await this.safeRestore(db.runtime.snapshot as ProxySnapshot | undefined);
          await this.store.mutate((draft) => {
            draft.runtime = { intent: 'off', profileId: null };
          });
          this.setState({ ...initialConnectionState(), capabilities: this.capabilities });
          return this.getState();
        }
        const target = targetFromProfile(profile, db.settings.bypassList);
        if (!target) {
          this.setState({ ...initialConnectionState(), capabilities: this.capabilities });
          return this.getState();
        }
        let applied = await this.adapter.verifyApplied(target);
        if (!applied) {
          try {
            await this.adapter.apply(target);
            applied = await this.adapter.verifyApplied(target);
          } catch {
            applied = false;
          }
        }
        if (!applied) {
          await this.safeRestore(db.runtime.snapshot as ProxySnapshot | undefined);
          await this.store.mutate((draft) => {
            draft.runtime = { intent: 'off', profileId: null };
          });
          this.setState({
            ...initialConnectionState(),
            capabilities: this.capabilities,
            error: {
              code: 'VERIFY_FAILED',
              message: 'The previously active proxy could not be re-applied',
              at: this.now(),
            },
          });
          return this.getState();
        }
        this.setState({
          phase: 'active',
          profileId: profile.id,
          profileName: profile.name,
          profileProtocol: profile.protocol,
          endpoint: describeTarget(target),
          appliedAt: db.runtime.appliedAt ?? this.now(),
          verification: db.settings.healthCheck.enabled ? 'pending' : 'skipped',
          latencyMs: null,
          error: null,
          capabilities: this.capabilities,
        });
        if (db.settings.healthCheck.enabled) {
          void this.runHealthCheck(db.settings.healthCheck, profile.id);
        }
        return this.getState();
      }

      if (db.runtime.snapshot !== undefined) {
        await this.safeRestore(db.runtime.snapshot as ProxySnapshot | undefined);
        await this.store.mutate((draft) => {
          delete draft.runtime.snapshot;
        });
      }
      this.setState({ ...initialConnectionState(), capabilities: this.capabilities });
      return this.getState();
    });
  }

  async connect(profileId: string): Promise<ConnectionResult> {
    return this.run(async () => {
      if (!this.initialized) {
        await this.refreshCapabilities();
        this.initialized = true;
      }
      const db = await this.store.read();
      const profile = db.profiles.find((entry) => entry.id === profileId);
      if (!profile) return this.failWith('PROFILE_NOT_FOUND', 'Configuration not found');
      if (!profile.connectKind) {
        return this.failWith(
          'PROFILE_NOT_CONNECTABLE',
          'This configuration can be stored and exported, but a browser-only extension cannot run its protocol',
          profile.protocol.toUpperCase(),
        );
      }
      const target = targetFromProfile(profile, db.settings.bypassList);
      if (!target) return this.failWith('PROFILE_NOT_CONNECTABLE', 'This configuration has no usable endpoint');
      const capabilities = this.capabilities ?? (await this.refreshCapabilities());
      if (!capabilities) {
        return this.failWith('PROXY_API_UNAVAILABLE', 'The browser proxy API is not available');
      }
      if (!capabilities.proxyApi) {
        return this.failWith('PROXY_API_UNAVAILABLE', 'The browser proxy API is not available');
      }
      if (!capabilities.supportedConnectKinds.includes(target.connectKind)) {
        return this.failWith(
          'UNSUPPORTED_IN_BROWSER',
          `${capabilities.browser} cannot route through a ${target.connectKind.toUpperCase()} endpoint`,
          capabilities.notes.join(' '),
        );
      }
      const needsAuth = Boolean(target.username || target.password);
      if (needsAuth && !capabilities.authSupported.includes(target.connectKind)) {
        return this.failWith(
          'AUTH_UNSUPPORTED',
          'This browser cannot supply proxy credentials from an extension',
          'Remove the username/password from the endpoint, or authenticate outside the extension.',
        );
      }

      this.setState({
        phase: 'applying',
        error: null,
        profileId: profile.id,
        profileName: profile.name,
        profileProtocol: profile.protocol,
        endpoint: describeTarget(target),
        verification: 'none',
        latencyMs: null,
      });

      const existingSnapshot = db.runtime.intent === 'on' ? (db.runtime.snapshot as ProxySnapshot | undefined) : undefined;
      let snapshot = existingSnapshot;
      if (!snapshot) {
        try {
          snapshot = await this.adapter.capture();
        } catch (error) {
          return this.fail(this.errorFrom(error));
        }
      }

      try {
        await this.adapter.apply(target);
      } catch (error) {
        await this.safeRestore(snapshot);
        return this.fail(this.errorFrom(error));
      }

      let verified = false;
      try {
        verified = await this.adapter.verifyApplied(target);
      } catch {
        verified = false;
      }
      if (!verified) {
        await this.safeRestore(snapshot);
        return this.failWith(
          'VERIFY_FAILED',
          'The browser did not keep the requested proxy configuration',
          'Another extension or policy may be overriding proxy settings.',
        );
      }

      const appliedAt = this.now();
      await this.store.mutate((draft) => {
        draft.runtime = { intent: 'on', profileId: profile.id, appliedAt, snapshot: snapshot as unknown };
        draft.settings.activeProfileId = profile.id;
        const stored = draft.profiles.find((entry) => entry.id === profile.id);
        if (stored) stored.lastUsedAt = appliedAt;
      });

      if (db.settings.webRtcLeakGuard && capabilities.webRtcGuard) {
        await this.adapter.setLeakProtection(true);
      }

      this.setState({
        phase: 'active',
        profileId: profile.id,
        profileName: profile.name,
        profileProtocol: profile.protocol,
        endpoint: describeTarget(target),
        appliedAt,
        verification: db.settings.healthCheck.enabled ? 'pending' : 'skipped',
        latencyMs: null,
        error: null,
        capabilities,
      });

      if (db.settings.healthCheck.enabled) {
        void this.runHealthCheck(db.settings.healthCheck, profile.id);
      }
      return { ok: true, state: this.getState() };
    });
  }

  async disconnect(): Promise<ConnectionResult> {
    return this.run(async () => {
      const db = await this.store.read();
      if (db.runtime.intent === 'off' && db.runtime.snapshot === undefined) {
        this.setState({ ...initialConnectionState(), capabilities: this.capabilities });
        return { ok: true, state: this.getState() };
      }
      try {
        await this.adapter.restore(db.runtime.snapshot as ProxySnapshot | undefined);
      } catch (error) {
        return this.fail(this.errorFrom(error));
      }
      if (db.settings.webRtcLeakGuard && this.capabilities?.webRtcGuard) {
        await this.adapter.setLeakProtection(false);
      }
      await this.store.mutate((draft) => {
        draft.runtime = { intent: 'off', profileId: null };
      });
      this.setState({ ...initialConnectionState(), capabilities: this.capabilities });
      return { ok: true, state: this.getState() };
    });
  }

  async recheck(): Promise<ConnectionResult> {
    const state = this.getState();
    if (state.phase !== 'active' || !state.profileId) {
      return this.failWith('NO_ACTIVE_PROFILE', 'No active connection to verify');
    }
    const db = await this.store.read();
    this.setState({ verification: 'pending', latencyMs: null });
    await this.runHealthCheck(db.settings.healthCheck, state.profileId);
    return { ok: true, state: this.getState() };
  }

  private async runHealthCheck(settings: HealthCheckSettings, profileId: string): Promise<void> {
    if (!settings.enabled) {
      this.setState({ verification: 'skipped' });
      return;
    }
    const result = await checkProxyHealth({
      url: settings.url,
      timeoutMs: settings.timeoutMs,
      ...(this.fetchFn ? { fetchFn: this.fetchFn } : {}),
    });
    if (this.state.phase !== 'active' || this.state.profileId !== profileId) return;
    this.setState({
      verification: result.ok ? 'ok' : 'failed',
      latencyMs: result.ok ? result.latencyMs : null,
      error: result.ok
        ? null
        : {
            code: 'TIMEOUT',
            message: 'Proxy is applied but the test request did not succeed',
            ...(result.detail ? { detail: result.detail } : {}),
            at: this.now(),
          },
    });
  }

  private async safeRestore(snapshot: ProxySnapshot | undefined): Promise<void> {
    try {
      await this.adapter.restore(snapshot);
    } catch {
      // Best effort: the caller surfaces the primary failure.
    }
  }
}
