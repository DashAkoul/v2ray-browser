import { useCallback, useMemo, useState } from 'react';
import type { ConnectionError, Profile } from '@v2rb/shared';
import { endpointLabel } from '@v2rb/parser';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  Logo,
  PlusIcon,
  PowerIcon,
  ServerIcon,
  StatusPill,
  ToastStack,
  GearIcon,
  useToasts,
} from '@v2rb/ui';
import { I18nProvider, errorMessage, useI18n, type Translate } from '../i18n';
import { openOptionsPage, rpc } from '../shared/client';
import type { AppSnapshot } from '../shared/protocol';
import { useAppSnapshot, useTheme } from '../shared/useAppSnapshot';
import './popup.css';

function statusTone(phase: AppSnapshot['connection']['phase'], verification: string) {
  if (phase === 'error') return 'error' as const;
  if (phase === 'applying') return 'pending' as const;
  if (phase === 'active') return 'active' as const;
  if (verification === 'pending') return 'pending' as const;
  return 'idle' as const;
}

function statusLabel(t: Translate, snapshot: AppSnapshot): string {
  const { connection } = snapshot;
  if (connection.phase === 'error') return t('status.error');
  if (connection.phase === 'applying') return t('status.connecting');
  if (connection.phase === 'active') {
    if (connection.verification === 'pending') return t('status.verifying');
    if (connection.verification === 'failed') return t('status.unverified');
    return t('status.connected');
  }
  return t('status.idle');
}

function connectableInBrowser(profile: Profile | null, snapshot: AppSnapshot | null): boolean {
  if (!profile?.connectKind || !snapshot) return false;
  const caps = snapshot.capabilities;
  if (!caps) return false;
  return caps.supportedConnectKinds.includes(profile.connectKind);
}

function PopupContent({
  data,
  snapshot,
}: {
  data: ReturnType<typeof useAppSnapshot>;
  snapshot: AppSnapshot;
}) {
  const { applySnapshot, refresh } = data;
  const { t } = useI18n();
  const { toasts, push, dismiss } = useToasts();
  const [busy, setBusy] = useState(false);
  useTheme(snapshot.settings.theme);

  const active = snapshot.profiles.find((profile) => profile.id === snapshot.settings.activeProfileId) ?? null;
  const connected = snapshot.connection.phase === 'active';
  const activeConnected = connected && snapshot.connection.profileId === active?.id;
  const canConnect = connectableInBrowser(active, snapshot);
  const capabilityBlocked = Boolean(active?.connectKind) && !canConnect;
  const error = snapshot.connection.error;

  const selectProfile = useCallback(
    async (id: string) => {
      try {
        const next = await rpc<AppSnapshot>({ type: 'profile/set-active', id });
        applySnapshot(next);
      } catch (caught) {
        const code = (caught as { code?: string }).code;
        push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
      }
    },
    [applySnapshot, push, t],
  );

  const toggleConnection = useCallback(async () => {
    if (!active) return;
    setBusy(true);
    try {
      const next = activeConnected
        ? await rpc<AppSnapshot>({ type: 'connection/disconnect' })
        : await rpc<AppSnapshot>({ type: 'connection/connect', profileId: active.id });
      applySnapshot(next);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [active, activeConnected, applySnapshot, push, refresh, t]);

  const sortedProfiles = useMemo(() => {
    return [...snapshot.profiles].sort((a, b) => {
      if (a.id === snapshot.settings.activeProfileId) return -1;
      if (b.id === snapshot.settings.activeProfileId) return 1;
      return (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt);
    });
  }, [snapshot.profiles, snapshot.settings.activeProfileId]);

  const visible = sortedProfiles.slice(0, 8);

  return (
    <div className="popup">
      <header className="popup__header">
        <div className="popup__brand">
          <Logo size={26} />
          <div>
            <div className="popup__title">{t('app.name')}</div>
            <div className="popup__tagline">{t('app.tagline')}</div>
          </div>
        </div>
        <div className="popup__header-actions">
          <IconButton label={t('popup.openSettings')} size="sm" onClick={() => openOptionsPage()}>
            <GearIcon size={16} />
          </IconButton>
        </div>
      </header>

      <section className={`popup__status ${connected ? 'popup__status--connected' : ''}`}>
        <div className="popup__status-head">
          <StatusPill status={statusTone(snapshot.connection.phase, snapshot.connection.verification)}>
            {statusLabel(t, snapshot)}
          </StatusPill>
          {connected && snapshot.connection.endpoint ? (
            <span className="popup__endpoint vb-mono">{snapshot.connection.endpoint}</span>
          ) : null}
        </div>

        {active ? (
          <div className="popup__active">
            <div className="popup__active-row">
              <span className="popup__active-name vb-truncate">{active.name}</span>
              <Badge tone={active.connectKind ? 'accent' : 'neutral'}>{t(`protocol.${active.protocol}`)}</Badge>
            </div>
            <div className="popup__active-meta vb-mono">{endpointLabel(active)}</div>
            {!active.connectKind ? (
              <p className="popup__notice">{t('popup.configOnlyNotice')}</p>
            ) : capabilityBlocked ? (
              <p className="popup__notice popup__notice--warning">{t('popup.connectUnavailable')}</p>
            ) : null}
          </div>
        ) : (
          <div className="popup__empty-active">
            <div className="popup__empty-title">{t('popup.noActiveConfig')}</div>
            <div className="vb-small vb-muted">{t('popup.selectHint')}</div>
          </div>
        )}

        {connected && snapshot.connection.verification === 'ok' ? (
          <div className="popup__verify popup__verify--ok">
            {t('popup.verificationOk', { ms: snapshot.connection.latencyMs ?? 0 })}
          </div>
        ) : null}
        {connected && snapshot.connection.verification === 'failed' ? (
          <div className="popup__verify popup__verify--warn">{t('popup.verificationFailed')}</div>
        ) : null}

        {error && snapshot.connection.phase === 'error' ? (
          <ErrorBox error={error} t={t} />
        ) : null}

        <Button
          variant={activeConnected ? 'secondary' : 'primary'}
          size="md"
          full
          loading={busy || snapshot.connection.phase === 'applying'}
          disabled={!active || (!activeConnected && !canConnect)}
          icon={<PowerIcon size={15} />}
          onClick={() => void toggleConnection()}
        >
          {activeConnected ? t('popup.disconnect') : busy ? t('popup.connecting') : t('popup.connect')}
        </Button>
      </section>

      <section className="popup__list">
        <div className="popup__list-head">
          <span className="popup__list-title">
            {t('popup.configsTitle')}
            <span className="popup__count">{snapshot.profiles.length}</span>
          </span>
          <div className="vb-row">
            <Button size="sm" variant="ghost" onClick={() => openOptionsPage('#add')} icon={<PlusIcon size={14} />}>
              {t('popup.addConfig')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openOptionsPage()}>
              {t('popup.manageAll')}
            </Button>
          </div>
        </div>

        {snapshot.profiles.length === 0 ? (
          <EmptyState
            icon={<ServerIcon size={20} />}
            title={t('popup.emptyTitle')}
            description={t('popup.emptyBody')}
            action={
              <Button size="sm" variant="primary" onClick={() => openOptionsPage('#add')}>
                {t('popup.addFirst')}
              </Button>
            }
          />
        ) : (
          <ul className="popup__profiles vb-scroll" role="list">
            {visible.map((profile) => {
              const isActive = profile.id === snapshot.settings.activeProfileId;
              const isConnectedRow = connected && snapshot.connection.profileId === profile.id;
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    className={`popup__profile ${isActive ? 'popup__profile--active' : ''}`}
                    onClick={() => void selectProfile(profile.id)}
                    aria-pressed={isActive}
                  >
                    <span className={`popup__radio ${isActive ? 'popup__radio--on' : ''}`} aria-hidden="true" />
                    <span className="popup__profile-body">
                      <span className="popup__profile-top">
                        <span className="popup__profile-name vb-truncate">{profile.name}</span>
                        {isConnectedRow ? <Badge tone="success">{t('configs.active')}</Badge> : null}
                      </span>
                      <span className="popup__profile-meta vb-mono vb-truncate">{endpointLabel(profile)}</span>
                    </span>
                    <Badge tone={profile.connectKind ? 'accent' : 'neutral'}>{t(`protocol.${profile.protocol}`)}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {snapshot.profiles.length > visible.length ? (
          <button type="button" className="popup__more" onClick={() => openOptionsPage()}>
            {t('popup.manageAll')} ({snapshot.profiles.length})
          </button>
        ) : null}
      </section>

      <footer className="popup__footer">
        <span className="vb-tiny vb-muted">{t('popup.browserOnlyNote')}</span>
        <span className="vb-tiny vb-muted">{t('about.version', { version: snapshot.version })}</span>
      </footer>

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function ErrorBox({ error, t }: { error: ConnectionError; t: Translate }) {
  return (
    <div className="popup__error" role="alert">
      <div className="popup__error-title">{errorMessage(t, error.code)}</div>
      {error.detail ? <div className="popup__error-detail vb-tiny">{error.detail}</div> : null}
      <div className="popup__error-hint vb-tiny">{t('popup.errorHint')}</div>
    </div>
  );
}

function PopupLoading() {
  return (
    <div className="popup popup--loading">
      <div className="popup__skeleton-header" />
      <div className="popup__skeleton-card" />
      <div className="popup__skeleton-row" />
      <div className="popup__skeleton-row" />
      <div className="popup__skeleton-row" />
    </div>
  );
}

export function PopupApp() {
  const data = useAppSnapshot();
  const { snapshot, error, refresh } = data;

  if (!snapshot) {
    return (
      <I18nProvider setting="auto">
        <PopupFallback error={error} onRetry={() => void refresh()} loading={data.loading} />
      </I18nProvider>
    );
  }

  return (
    <I18nProvider setting={snapshot.settings.locale}>
      <PopupContent data={data} snapshot={snapshot} />
    </I18nProvider>
  );
}

function PopupFallback({ error, onRetry, loading }: { error: string | null; onRetry: () => void; loading: boolean }) {
  const { t } = useI18n();
  if (loading) return <PopupLoading />;
  return (
    <div className="popup popup--fallback">
      <Logo size={34} />
      <h2>{t('errors.title')}</h2>
      <p className="vb-small vb-muted">{error ?? t('errors.generic')}</p>
      <Button size="sm" variant="primary" onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  );
}
