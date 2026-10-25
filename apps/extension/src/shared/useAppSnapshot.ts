import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThemeSetting } from '@v2rb/shared';
import { rpc, subscribeToState } from './client';
import type { AppSnapshot } from './protocol';

export interface AppSnapshotState {
  snapshot: AppSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  applySnapshot: (snapshot: AppSnapshot) => void;
}

export function useAppSnapshot(): AppSnapshotState {
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await rpc<AppSnapshot>({ type: 'state/get' });
      if (!mounted.current) return;
      setSnapshot(next);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : 'Could not load extension state');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const unsubscribe = subscribeToState((next) => {
      if (!mounted.current) return;
      setSnapshot(next);
      setLoading(false);
      setError(null);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, [load]);

  return {
    snapshot,
    loading,
    error,
    refresh: load,
    applySnapshot: (next) => {
      setSnapshot(next);
      setError(null);
      setLoading(false);
    },
  };
}

export function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting === 'light' || setting === 'dark') return setting;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme(setting: ThemeSetting): void {
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(setting);
    };
    apply();
    if (setting !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: light)');
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [setting]);
}

export function formatDateTime(timestamp: number | undefined, locale: string): string {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
