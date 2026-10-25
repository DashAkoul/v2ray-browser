import {
  ConnectionController,
  ProfileService,
  SettingsService,
  SubscriptionService,
} from '@v2rb/core';
import { createProxyAdapter } from '@v2rb/adapters';
import { DatabaseStore } from '@v2rb/storage';
import { createStorageArea, getExtApi, type MessageListener } from '../shared/browser';
import { STATE_CHANNEL } from '../shared/protocol';
import { buildSnapshot } from './snapshot';
import { handleRequest, toErrorPayload, type RouterServices } from './router';

const api = getExtApi();
const store = new DatabaseStore(createStorageArea());
const adapter = createProxyAdapter();
const controller = new ConnectionController({ store, adapter });
const services: RouterServices = {
  store,
  adapter,
  controller,
  profiles: new ProfileService(store),
  settings: new SettingsService(store),
  subscriptions: new SubscriptionService(store),
};

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let booted = false;

async function broadcast(): Promise<void> {
  try {
    const snapshot = await buildSnapshot(services);
    await api.runtime.sendMessage({ channel: STATE_CHANNEL, snapshot });
  } catch {
    // No UI is open; nothing to broadcast to.
  }
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    void broadcast();
  }, 40);
}

controller.subscribe(() => scheduleBroadcast());

async function bootstrap(): Promise<void> {
  if (booted) return;
  booted = true;
  try {
    await store.read();
    await controller.reconcile();
  } catch (error) {
    console.warn('V2Ray Browser: startup reconciliation failed', error);
  }
  try {
    const db = await store.read();
    if (db.settings.subscriptionAutoRefresh.enabled && db.subscriptions.length > 0) {
      void services.subscriptions
        .refreshStale(db.settings.subscriptionAutoRefresh.staleAfterHours)
        .then((count) => {
          if (count > 0) scheduleBroadcast();
        });
    }
  } catch {
    // Auto refresh is best effort.
  }
  scheduleBroadcast();
}

/**
 * Only this extension's own pages may drive the privileged API. Other extensions
 * carry a different `id`, content scripts report the host page URL, and web pages
 * cannot reach `runtime.onMessage` at all (no externally_connectable). The URL
 * prefix check is defence in depth so no future manifest change widens this by
 * accident. Note that our own pages are often in a tab, so `sender.tab` alone is
 * not a signal to reject; `chrome-extension:` origins serialise as "null", hence
 * the prefix comparison instead of `URL.origin`.
 */
function isTrustedSender(sender: unknown): boolean {
  if (typeof sender !== 'object' || sender === null) return false;
  const record = sender as Record<string, unknown>;
  const id = record['id'];
  if (typeof id === 'string' && api.runtime.id && id !== api.runtime.id) return false;
  const url = record['url'];
  if (typeof url === 'string' && url.length > 0) {
    if (!url.startsWith(api.runtime.getURL(''))) return false;
  }
  return true;
}

const listener: MessageListener = (message, sender, sendResponse) => {
  if (!isTrustedSender(sender)) return false;
  if (typeof message !== 'object' || message === null) return false;
  if ((message as Record<string, unknown>)['channel'] === STATE_CHANNEL) return false;
  void bootstrap()
    .then(() => handleRequest(message, services))
    .then((response) => sendResponse(response))
    .catch((error: unknown) => sendResponse({ ok: false, error: toErrorPayload(error) }));
  return true;
};

api.runtime.onMessage.addListener(listener);

api.runtime.onStartup?.addListener(() => {
  booted = false;
  void bootstrap();
});

api.runtime.onInstalled?.addListener((details) => {
  if (details.reason === 'install') {
    api.runtime.openOptionsPage?.();
  }
});

void bootstrap();
