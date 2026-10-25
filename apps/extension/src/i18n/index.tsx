import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { LocaleSetting } from '@v2rb/shared';
import { en, type MessageKey } from './en';
import { fa } from './fa';

export type Locale = 'en' | 'fa';

const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = { en, fa };

export type TranslateVars = Record<string, string | number>;

export type Translate = (key: MessageKey, vars?: TranslateVars) => string;

interface I18nValue {
  locale: Locale;
  dir: 'ltr' | 'rtl';
  t: Translate;
}

const I18nContext = createContext<I18nValue | null>(null);

export function resolveLocale(setting: LocaleSetting): Locale {
  if (setting === 'en' || setting === 'fa') return setting;
  const language = typeof navigator !== 'undefined' ? navigator.language.toLowerCase() : 'en';
  return language.startsWith('fa') ? 'fa' : 'en';
}

export function translate(locale: Locale, key: MessageKey, vars?: TranslateVars): string {
  const template = DICTIONARIES[locale][key] ?? en[key] ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = vars[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function I18nProvider({ setting, children }: { setting: LocaleSetting; children: ReactNode }) {
  const locale = resolveLocale(setting);
  const dir = locale === 'fa' ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir,
      t: (key, vars) => translate(locale, key, vars),
    }),
    [locale, dir],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

const ERROR_KEYS = {
  NO_RESPONSE: 'errors.NO_RESPONSE',
  PROXY_API_UNAVAILABLE: 'errors.PROXY_API_UNAVAILABLE',
  CONTROLLED_BY_OTHER: 'errors.CONTROLLED_BY_OTHER',
  AUTH_UNSUPPORTED: 'errors.AUTH_UNSUPPORTED',
  UNSUPPORTED_IN_BROWSER: 'errors.UNSUPPORTED_IN_BROWSER',
  PROFILE_NOT_CONNECTABLE: 'errors.PROFILE_NOT_CONNECTABLE',
  PROFILE_NOT_FOUND: 'errors.PROFILE_NOT_FOUND',
  FIREFOX_INCOGNITO_REQUIRED: 'errors.FIREFOX_INCOGNITO_REQUIRED',
  APPLY_FAILED: 'errors.APPLY_FAILED',
  VERIFY_FAILED: 'errors.VERIFY_FAILED',
  RESTORE_FAILED: 'errors.RESTORE_FAILED',
  TIMEOUT: 'errors.TIMEOUT',
  NO_ACTIVE_PROFILE: 'errors.NO_ACTIVE_PROFILE',
  VALIDATION: 'errors.VALIDATION',
  PARSE: 'errors.PARSE',
  PERMISSION: 'errors.PERMISSION',
  NOT_FOUND: 'errors.NOT_FOUND',
  LIMIT: 'errors.LIMIT',
  SUBSCRIPTION: 'errors.SUBSCRIPTION',
  DUPLICATE: 'errors.DUPLICATE',
} as const satisfies Record<string, MessageKey>;

export function protocolKey(protocol: string): MessageKey {
  const key = `protocol.${protocol}`;
  return (key in en ? key : 'protocol.vless') as MessageKey;
}

export function errorMessage(t: Translate, code: string | undefined, fallback?: string): string {
  if (code && code in ERROR_KEYS) return t(ERROR_KEYS[code as keyof typeof ERROR_KEYS]);
  return fallback && fallback.length > 0 ? fallback : t('errors.generic');
}
