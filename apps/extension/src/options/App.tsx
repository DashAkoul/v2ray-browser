import { useEffect, useState } from 'react';
import { Badge, Button, Logo, Tabs, ToastStack, useToasts } from '@v2rb/ui';
import { I18nProvider, useI18n } from '../i18n';
import { useAppSnapshot, useTheme } from '../shared/useAppSnapshot';
import type { AppSnapshot } from '../shared/protocol';
import { AboutSection } from './sections/AboutSection';
import { ConfigsSection } from './sections/ConfigsSection';
import { DiagnosticsSection } from './sections/DiagnosticsSection';
import { SettingsSection } from './sections/SettingsSection';
import { SubscriptionsSection } from './sections/SubscriptionsSection';
import './options.css';

const TAB_IDS = ['configs', 'subscriptions', 'settings', 'diagnostics', 'about'] as const;
type TabId = (typeof TAB_IDS)[number];

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

function readHash(): { tab: TabId; add: boolean } {
  const raw = window.location.hash.replace('#', '');
  if (raw === 'add') return { tab: 'configs', add: true };
  return { tab: isTabId(raw) ? raw : 'configs', add: false };
}

function OptionsContent({ snapshot, onSnapshot }: { snapshot: AppSnapshot; onSnapshot: (next: AppSnapshot) => void }) {
  const { t } = useI18n();
  const { toasts, push, dismiss } = useToasts();
  const [tab, setTab] = useState<TabId>(() => readHash().tab);
  const [addRequested, setAddRequested] = useState(() => readHash().add);
  useTheme(snapshot.settings.theme);

  useEffect(() => {
    if (window.location.hash === '#add') {
      window.history.replaceState(null, '', window.location.pathname);
    }
    const onHashChange = () => {
      const next = readHash();
      setTab(next.tab);
      if (next.add) setAddRequested(true);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${t('app.name')} — ${t(`nav.${tab}` as 'nav.configs')}`;
  }, [tab, t]);

  return (
    <div className="options">
      <header className="topbar">
        <div className="brand">
          <Logo size={34} />
          <div>
            <h1>{t('app.name')}</h1>
            <p>{t('app.tagline')}</p>
          </div>
        </div>
        <div className="topbar__meta">
          <Badge tone="neutral">{t('about.version', { version: snapshot.version })}</Badge>
          <span className="vb-tiny vb-muted">{t('popup.browserOnlyNote')}</span>
        </div>
      </header>

      <nav className="topnav" aria-label={t('common.settings')}>
        <Tabs
          label={t('common.settings')}
          value={tab}
          onChange={(id) => {
            const next = isTabId(id) ? id : 'configs';
            setTab(next);
            window.history.replaceState(null, '', `#${next}`);
          }}
          items={[
            { id: 'configs', label: t('nav.configs') },
            { id: 'subscriptions', label: t('nav.subscriptions') },
            { id: 'settings', label: t('nav.settings') },
            { id: 'diagnostics', label: t('nav.diagnostics') },
            { id: 'about', label: t('nav.about') },
          ]}
        />
      </nav>

      <main className="options__content">
        {tab === 'configs' ? (
          <ConfigsSection
            snapshot={snapshot}
            onSnapshot={onSnapshot}
            push={push}
            autoOpenAdd={addRequested}
          />
        ) : null}
        {tab === 'subscriptions' ? <SubscriptionsSection snapshot={snapshot} onSnapshot={onSnapshot} push={push} /> : null}
        {tab === 'settings' ? <SettingsSection snapshot={snapshot} onSnapshot={onSnapshot} push={push} /> : null}
        {tab === 'diagnostics' ? <DiagnosticsSection snapshot={snapshot} onSnapshot={onSnapshot} push={push} /> : null}
        {tab === 'about' ? <AboutSection snapshot={snapshot} onSnapshot={onSnapshot} push={push} /> : null}
      </main>

      <footer className="options__footer">
        <span>{t('popup.browserOnlyNote')}</span>
        <a href="https://github.com/DashAkoul/v2ray-browser" target="_blank" rel="noreferrer noopener">
          {t('about.repo')}
        </a>
      </footer>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Fallback({ error, onRetry, loading }: { error: string | null; onRetry: () => void; loading: boolean }) {
  const { t } = useI18n();
  return (
    <div className="options options--fallback">
      <Logo size={44} />
      <h1>{t('errors.title')}</h1>
      <p className="vb-muted">{error ?? t('common.loading')}</p>
      {!loading ? (
        <Button variant="primary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function OptionsApp() {
  const data = useAppSnapshot();
  const { snapshot, loading, error, refresh, applySnapshot } = data;

  if (!snapshot) {
    return (
      <I18nProvider setting="auto">
        <Fallback error={error} onRetry={() => void refresh()} loading={loading} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider setting={snapshot.settings.locale}>
      <OptionsContent snapshot={snapshot} onSnapshot={applySnapshot} />
    </I18nProvider>
  );
}
