import type { RpcRequest } from '@v2rb/shared';
import { getExtApi, type MessageListener } from './browser';
import { isStateMessage, type AppSnapshot, type RpcResponse } from './protocol';

export class RpcError extends Error {
  readonly code: string;
  readonly detail: string | undefined;

  constructor(code: string, message: string, detail?: string) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.detail = detail;
  }
}

export async function rpc<T>(request: RpcRequest): Promise<T> {
  const response = (await getExtApi().runtime.sendMessage(request)) as RpcResponse<T> | undefined;
  if (!response) throw new RpcError('NO_RESPONSE', 'The background process did not respond');
  if (!response.ok) throw new RpcError(response.error.code, response.error.message, response.error.detail);
  return response.data;
}

export function subscribeToState(listener: (snapshot: AppSnapshot) => void): () => void {
  const api = getExtApi();
  const handler: MessageListener = (message) => {
    if (isStateMessage(message)) listener(message.snapshot);
  };
  api.runtime.onMessage.addListener(handler);
  return () => api.runtime.onMessage.removeListener?.(handler);
}

export function openOptionsPage(hash?: string): void {
  const api = getExtApi();
  const target = hash ? `options.html${hash}` : 'options.html';
  const fallback = () => window.open(api.runtime.getURL(target), '_blank');
  try {
    const result = api.runtime.openOptionsPage?.();
    if (result && typeof result.catch === 'function') {
      void result.catch(fallback);
    }
  } catch {
    fallback();
  }
}

export function extensionUrl(path: string): string {
  return getExtApi().runtime.getURL(path);
}
