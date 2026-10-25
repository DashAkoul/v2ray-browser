import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startOriginServer, startSocks5Server, type OriginFixture, type SocksFixture } from './fixtures/servers';

const EXTENSION_PATH = resolve(process.cwd(), 'dist/chrome');
const UUID = '11111111-2222-3333-4444-555555555555';

interface Snapshot {
  profiles: Array<{ id: string; name: string; connectKind?: string }>;
  settings: { activeProfileId: string | null };
  connection: { phase: string; profileId: string | null; verification: string };
}

interface RpcEnvelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

let context: BrowserContext;
let extensionId: string;
let userDataDir: string;
let socks: SocksFixture;
let origin: OriginFixture;

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string; userDataDir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'v2rb-e2e-'));
  const browserContext = await chromium.launchPersistentContext(dir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
      '--no-first-run',
    ],
  });
  let [worker] = browserContext.serviceWorkers();
  if (!worker) {
    worker = await browserContext.waitForEvent('serviceworker', { timeout: 20_000 }).catch(() => undefined);
  }
  if (!worker) {
    await browserContext.close();
    throw new Error('Extension service worker did not start; cannot determine extension id');
  }
  return { context: browserContext, extensionId: new URL(worker.url()).host, userDataDir: dir };
}

async function rpc<T>(page: Page, request: unknown): Promise<T> {
  const response = (await page.evaluate(async (message) => {
    const scope = globalThis as unknown as {
      chrome?: { runtime: { sendMessage(payload: unknown): Promise<unknown> } };
      browser?: { runtime: { sendMessage(payload: unknown): Promise<unknown> } };
    };
    const api = scope.browser ?? scope.chrome;
    if (!api) throw new Error('WebExtension API is unavailable in this page');
    return await api.runtime.sendMessage(message);
  }, request)) as RpcEnvelope;
  if (!response || response.ok !== true) {
    throw new Error(response?.error?.message ?? 'Extension RPC failed');
  }
  return response.data as T;
}

async function openOptions(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForSelector('.options');
  return page;
}

async function openPopup(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForSelector('.popup');
  return page;
}

test.describe('V2Ray Browser extension', () => {
  test.beforeAll(async () => {
    socks = await startSocks5Server();
    origin = await startOriginServer();
    const launched = await launchExtension();
    context = launched.context;
    extensionId = launched.extensionId;
    userDataDir = launched.userDataDir;
  });

  test.afterAll(async () => {
    await context?.close();
    await socks?.close();
    await origin?.close();
    if (userDataDir) {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        // Windows may keep profile files locked briefly after close.
      }
    }
  });

  test('adds a configuration through the UI, persists it and deletes it', async () => {
    const page = await openOptions();
    await expect(page.getByRole('heading', { name: 'Configurations' })).toBeVisible();

    await page.getByRole('button', { name: 'Add configuration' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.locator('textarea').fill('socks5://127.0.0.1:1080#UI Config');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog).toBeHidden();

    const card = page.locator('.profile-card', { hasText: 'UI Config' });
    await expect(card).toBeVisible();
    await expect(card.getByText('SOCKS5')).toBeVisible();

    await page.reload();
    await page.waitForSelector('.options');
    await expect(page.locator('.profile-card', { hasText: 'UI Config' })).toBeVisible();

    await page
      .locator('.profile-card', { hasText: 'UI Config' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.profile-card', { hasText: 'UI Config' })).toHaveCount(0);
    await page.close();
  });

  test('rejects malformed input with a readable error', async () => {
    const page = await openOptions();
    await page.getByRole('button', { name: 'Add configuration' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.locator('textarea').fill('this is not a configuration');
    await dialog.getByRole('button', { name: 'Import' }).click();
    await expect(dialog.getByText(/Not a supported configuration link/i)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await page.close();
  });

  test('routes real browser traffic through the SOCKS5 endpoint and restores settings', async () => {
    const page = await openOptions();
    await rpc(page, {
      type: 'settings/update',
      patch: { healthCheck: { enabled: false, url: 'https://www.gstatic.com/generate_204', timeoutMs: 2000 } },
    });
    await rpc(page, { type: 'profile/add', input: `socks5://127.0.0.1:${socks.port}#E2E SOCKS` });
    const snapshot = await rpc<Snapshot>(page, { type: 'state/get' });
    const profile = snapshot.profiles.find((entry) => entry.name === 'E2E SOCKS');
    expect(profile, 'profile was created').toBeTruthy();
    await rpc(page, { type: 'profile/set-active', id: profile?.id });

    const popup = await openPopup();
    const row = popup.getByRole('button', { name: /E2E SOCKS/ });
    await expect(row).toBeVisible();
    await row.click();
    const connect = popup.getByRole('button', { name: 'Connect', exact: true });
    await expect(connect).toBeEnabled();
    await connect.click();
    await expect(popup.getByText('Connected', { exact: true })).toBeVisible();

    const applied = await page.evaluate(async () => {
      const scope = globalThis as unknown as {
        chrome: { proxy: { settings: { get(details?: unknown): Promise<{ value: { mode?: string; rules?: { singleProxy?: { host?: string; port?: number } } } }> } } };
      };
      const current = await scope.chrome.proxy.settings.get({});
      return current.value;
    });
    expect(applied.mode).toBe('fixed_servers');
    expect(applied.rules?.singleProxy?.host).toBe('127.0.0.1');
    expect(applied.rules?.singleProxy?.port).toBe(socks.port);

    const targetUrl = `http://example.test:${origin.port}/probe`;
    const target = await context.newPage();
    await target.goto(targetUrl, { timeout: 20_000 });
    await expect(target.locator('#marker')).toHaveText('PROXY E2E OK');
    expect(socks.connections.some((entry) => entry.host === 'example.test')).toBe(true);
    expect(origin.requests.some((entry) => entry.includes(`example.test:${origin.port}`))).toBe(true);
    await target.close();

    await popup.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(popup.getByText('Not connected')).toBeVisible();

    const restored = await page.evaluate(async () => {
      const scope = globalThis as unknown as {
        chrome: { proxy: { settings: { get(details?: unknown): Promise<{ value: { mode?: string } }> } } };
      };
      const current = await scope.chrome.proxy.settings.get({});
      return current.value;
    });
    expect(restored.mode).not.toBe('fixed_servers');

    const direct = await context.newPage();
    let blocked = false;
    try {
      await direct.goto(targetUrl, { timeout: 6_000 });
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
    await direct.close();
    await popup.close();
    await page.close();
  });

  test('marks VLESS as configuration only and blocks connecting', async () => {
    const page = await openOptions();
    await rpc(page, { type: 'profile/add', input: `vless://${UUID}@example.com:443?type=ws&security=tls#Core Node` });
    const snapshot = await rpc<Snapshot>(page, { type: 'state/get' });
    const core = snapshot.profiles.find((entry) => entry.name === 'Core Node');
    expect(core?.connectKind).toBeUndefined();
    await rpc(page, { type: 'profile/set-active', id: core?.id });

    const popup = await openPopup();
    await popup.getByRole('button', { name: /Core Node/ }).click();
    await expect(popup.getByText(/cannot run it/i)).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Connect', exact: true })).toBeDisabled();
    await popup.close();
    await page.close();
  });

  test('excludes secrets from a shared export and includes them only on request', async () => {
    const page = await openOptions();
    const shared = await rpc<unknown>(page, { type: 'profile/export', includeSecrets: false });
    expect(JSON.stringify(shared)).not.toContain(UUID);
    const full = await rpc<unknown>(page, { type: 'profile/export', includeSecrets: true });
    expect(JSON.stringify(full)).toContain(UUID);
    await page.close();
  });
});
