export interface HealthCheckOptions {
  url: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}

export interface HealthCheckResult {
  ok: boolean;
  latencyMs: number;
  detail?: string;
}

/**
 * Reachability probe that runs inside the browser, so it traverses whatever
 * proxy the browser currently has applied. This is evidence that egress works,
 * not merely that a setting was written.
 */
export async function checkProxyHealth(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { ok: false, latencyMs: 0, detail: 'fetch is unavailable' };
  }
  let target: URL;
  try {
    target = new URL(options.url);
  } catch {
    return { ok: false, latencyMs: 0, detail: 'Health check URL is invalid' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, latencyMs: 0, detail: 'Health check URL must use http or https' };
  }

  const started = Date.now();
  const controller = new AbortController();
  const timeout = Math.max(500, Math.min(options.timeoutMs, 60000));
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchFn(target.toString(), {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'follow',
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    if (response.ok || response.type === 'opaque' || response.status === 0) {
      return { ok: true, latencyMs };
    }
    return { ok: false, latencyMs, detail: `HTTP ${response.status}` };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      latencyMs,
      detail: aborted ? 'Timed out' : error instanceof Error ? error.message : 'Network error',
    };
  } finally {
    clearTimeout(timer);
  }
}
