import { useState, type FormEvent } from 'react';
import type { Subscription } from '@v2rb/shared';
import { Badge, Button, ConfirmDialog, EmptyState, Field, LinkIcon, RefreshIcon, TextInput, TrashIcon, IconButton } from '@v2rb/ui';
import { errorMessage, useI18n } from '../../i18n';
import { rpc } from '../../shared/client';
import { requestHostPermission } from '../../shared/browser';
import { formatDateTime } from '../../shared/useAppSnapshot';
import type { SectionProps } from '../../shared/uiTypes';
import type { AppSnapshot } from '../../shared/protocol';

interface SubscriptionResponse {
  snapshot: AppSnapshot;
  refresh: { ok: boolean; error?: string; added?: number };
}

function displayUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}/…`;
  } catch {
    return '…';
  }
}

export function SubscriptionsSection({ snapshot, onSnapshot, push }: SectionProps) {
  const { t, locale } = useI18n();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Subscription | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleError = (caught: unknown) => {
    const code = (caught as { code?: string }).code;
    const detail = (caught as { detail?: string }).detail;
    push(errorMessage(t, code, detail ?? (caught instanceof Error ? caught.message : undefined)), 'error');
  };

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    try {
      const granted = await requestHostPermission(url.trim());
      if (!granted) {
        push(t('subs.permissionDenied'), 'error');
        return;
      }
      const response = await rpc<SubscriptionResponse>({
        type: 'subscription/add',
        url: url.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      onSnapshot(response.snapshot);
      if (response.refresh.ok) {
        push(t('subs.addedToast'), 'success');
      } else {
        push(response.refresh.error ?? t('errors.SUBSCRIPTION'), 'warning');
      }
      setUrl('');
      setName('');
    } catch (caught) {
      handleError(caught);
      if ((caught as { code?: string }).code === 'PERMISSION') push(t('subs.permissionHint'), 'info');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async (subscription: Subscription) => {
    setRefreshing(subscription.id);
    try {
      const response = await rpc<SubscriptionResponse>({ type: 'subscription/refresh', id: subscription.id });
      onSnapshot(response.snapshot);
      if (response.refresh.ok) {
        push(t('subs.updatedToast'), 'success');
      } else {
        push(response.refresh.error ?? t('errors.SUBSCRIPTION'), 'error');
      }
    } catch (caught) {
      handleError(caught);
    } finally {
      setRefreshing(null);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      onSnapshot(await rpc<AppSnapshot>({ type: 'subscription/remove', id: deleting.id }));
      setDeleting(null);
      push(t('common.done'), 'success');
    } catch (caught) {
      handleError(caught);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <section className="section" aria-labelledby="subs-title">
      <header className="section__header">
        <div>
          <h2 id="subs-title">{t('subs.title')}</h2>
          <p className="section__subtitle">{t('subs.subtitle')}</p>
        </div>
        <Badge tone="neutral">{snapshot.subscriptions.length}</Badge>
      </header>

      <form className="card-form" onSubmit={(event) => void add(event)}>
        <h3 className="card-form__title">{t('subs.addTitle')}</h3>
        <div className="form-grid">
          <Field label={t('subs.urlLabel')} hint={t('subs.urlHint')}>
            <TextInput
              type="url"
              value={url}
              placeholder="https://example.com/subscription"
              onChange={(event) => setUrl(event.target.value)}
              required
              dir="ltr"
            />
          </Field>
          <Field label={t('subs.nameLabel')}>
            <TextInput
              value={name}
              placeholder={t('subs.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
            />
          </Field>
        </div>
        <div className="card-form__actions">
          <Button type="submit" size="sm" variant="primary" loading={busy} disabled={!url.trim()}>
            {t('subs.addButton')}
          </Button>
          <span className="vb-tiny vb-muted">{t('subs.autoRefreshNote')}</span>
        </div>
      </form>

      {snapshot.subscriptions.length === 0 ? (
        <EmptyState icon={<LinkIcon size={22} />} title={t('subs.emptyTitle')} description={t('subs.emptyBody')} />
      ) : (
        <div className="sub-list">
          {snapshot.subscriptions.map((subscription) => (
            <article key={subscription.id} className="sub-card">
              <div className="sub-card__main">
                <div className="sub-card__top">
                  <h3 className="vb-truncate">{subscription.name}</h3>
                  <Badge tone={subscription.lastError ? 'danger' : 'success'}>
                    {t('subs.profiles', { count: subscription.profileCount })}
                  </Badge>
                </div>
                <div className="sub-card__url vb-mono" dir="ltr">
                  {displayUrl(subscription.url)}
                </div>
                <div className="sub-card__meta">
                  {subscription.lastUpdatedAt
                    ? t('subs.lastUpdated', { date: formatDateTime(subscription.lastUpdatedAt, locale) })
                    : t('subs.never')}
                </div>
                {subscription.lastError ? (
                  <div className="sub-card__error" role="status">
                    <strong>{t('subs.error')}:</strong> {subscription.lastError}
                  </div>
                ) : null}
              </div>
              <div className="sub-card__actions">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RefreshIcon size={13} />}
                  loading={refreshing === subscription.id}
                  onClick={() => void refresh(subscription)}
                >
                  {t('subs.refresh')}
                </Button>
                <IconButton label={t('common.delete')} size="sm" onClick={() => setDeleting(subscription)}>
                  <TrashIcon size={15} />
                </IconButton>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('subs.deleteTitle')}
        description={t('subs.deleteBody', {
          name: deleting?.name ?? '',
          count: deleting?.profileCount ?? 0,
        })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deleteBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />
    </section>
  );
}
