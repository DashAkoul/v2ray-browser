import { createAreaAdapter, type StorageArea } from '@v2rb/storage';

export interface StorageLike {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface PermissionsApi {
  request(details: { origins: string[] }): Promise<boolean>;
  contains(details: { origins: string[] }): Promise<boolean>;
}

export type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

export interface RuntimeApi {
  id?: string;
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  openOptionsPage?(): Promise<void> | void;
  onMessage: {
    addListener(listener: MessageListener): void;
    removeListener?(listener: MessageListener): void;
  };
  onInstalled?: { addListener(listener: (details: { reason: string }) => void): void };
  onStartup?: { addListener(listener: () => void): void };
}

export interface ExtApi {
  runtime: RuntimeApi;
  storage?: { local?: StorageLike };
  permissions?: PermissionsApi;
}

function fromGlobal(name: string): unknown {
  return (globalThis as Record<string, unknown>)[name];
}

export function isFirefoxRuntime(): boolean {
  const candidate = fromGlobal('browser') as { runtime?: { getBrowserInfo?: unknown } } | undefined;
  return Boolean(candidate?.runtime?.getBrowserInfo);
}

export function getExtApi(): ExtApi {
  const browserNamespace = fromGlobal('browser') as Partial<ExtApi> | undefined;
  if (browserNamespace?.runtime?.getURL) return browserNamespace as ExtApi;
  const chromeNamespace = fromGlobal('chrome') as Partial<ExtApi> | undefined;
  if (chromeNamespace?.runtime?.getURL) return chromeNamespace as ExtApi;
  throw new Error('WebExtension APIs are not available in this context');
}

export function createStorageArea(): StorageArea {
  const local = getExtApi().storage?.local;
  if (!local) throw new Error('storage.local is not available');
  return createAreaAdapter(local);
}

export function hostPermissionPattern(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `${url.protocol}//${url.hostname}/*`;
}

export async function hasHostPermission(rawUrl: string): Promise<boolean> {
  try {
    const permissions = getExtApi().permissions;
    if (!permissions) return true;
    return await permissions.contains({ origins: [hostPermissionPattern(rawUrl)] });
  } catch {
    return false;
  }
}

/** Must be invoked from a user gesture in an extension page. */
export async function requestHostPermission(rawUrl: string): Promise<boolean> {
  try {
    const permissions = getExtApi().permissions;
    if (!permissions) return true;
    return await permissions.request({ origins: [hostPermissionPattern(rawUrl)] });
  } catch {
    return false;
  }
}
