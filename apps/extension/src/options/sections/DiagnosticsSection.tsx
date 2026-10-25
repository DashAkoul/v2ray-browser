import { useCallback, useEffect, useState } from 'react';
import type { DiagnosticsReport } from '@v2rb/shared';
import { sanitizeText } from '@v2rb/parser';
import { Badge, Button, RefreshIcon } from '@v2rb/ui';
import { errorMessage, useI18n } from '../../i18n';
import { copyText } from '../../shared/clipboard';
import { rpc } from '../../shared/client';
import type { SectionProps } from '../../shared/uiTypes';

function yesNo(value: boolean, t: (key: 'common.yes' | 'common.no') => string): string {
  return value ? t('common.yes') : t('common.no');
}

export function DiagnosticsSection({ snapshot, push }: SectionProps) {
  const { t } = useI18n();
  const [report, setReport] = useState<DiagnosticsReport | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setReport(await rpc<DiagnosticsReport>({ type: 'diagnostics/get' }));
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    } finally {
      setBusy(false);
    }
  }, [push, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyReport = async () => {
    if (!report) return;
    const clean = sanitizeText(JSON.stringify({ ...report, snapshotIssues: snapshot.issues }, null, 2));
    const ok = await copyText(clean);
    push(ok ? t('diag.copied') : t('errors.generic'), ok ? 'success' : 'error');
  };

  const capabilities = report?.capabilities ?? snapshot.capabilities;

  return (
    <section className="section" aria-labelledby="diag-title">
      <header className="section__header">
        <div>
          <h2 id="diag-title">{t('diag.title')}</h2>
          <p className="section__subtitle">{t('diag.subtitle')}</p>
        </div>
        <div className="vb-row">
          <Button size="sm" variant="ghost" icon={<RefreshIcon size={14} />} loading={busy} onClick={() => void load()}>
            {t('common.refresh')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void copyReport()} disabled={!report}>
            {t('diag.copy')}
          </Button>
        </div>
      </header>

      <div className="diag-grid">
        <div className="settings-card">
          <h3>{t('diag.storage')}</h3>
          <dl className="kv">
            <dt>{t('diag.browser')}</dt>
            <dd>{report?.browser ?? snapshot.browser}</dd>
            <dt>{t('diag.version')}</dt>
            <dd className="vb-mono">{report?.appVersion ?? snapshot.version}</dd>
            <dt>{t('configs.title')}</dt>
            <dd>{report?.profileCount ?? snapshot.profiles.length}</dd>
            <dt>{t('subs.title')}</dt>
            <dd>{report?.subscriptionCount ?? snapshot.subscriptions.length}</dd>
            <dt>{t('diag.proxyApi')}</dt>
            <dd>
              <Badge tone={capabilities?.proxyApi ? 'success' : 'danger'}>
                {yesNo(Boolean(capabilities?.proxyApi), t)}
              </Badge>
            </dd>
            <dt>{t('diag.controllable')}</dt>
            <dd>
              <Badge tone={capabilities?.controllable ? 'success' : 'warning'}>
                {yesNo(Boolean(capabilities?.controllable), t)}
              </Badge>
            </dd>
            <dt>{t('diag.incognito')}</dt>
            <dd>
              <Badge tone={capabilities?.incognitoAccess ? 'success' : 'warning'}>
                {yesNo(Boolean(capabilities?.incognitoAccess), t)}
              </Badge>
            </dd>
            <dt>{t('diag.webRtcGuard')}</dt>
            <dd>
              <Badge tone={capabilities?.webRtcGuard ? 'success' : 'neutral'}>
                {yesNo(Boolean(capabilities?.webRtcGuard), t)}
              </Badge>
            </dd>
            <dt>{t('diag.supportedKinds')}</dt>
            <dd className="vb-mono">{capabilities?.supportedConnectKinds.join(', ') || t('common.none')}</dd>
            <dt>{t('diag.authSupport')}</dt>
            <dd className="vb-mono">{capabilities?.authSupported.join(', ') || t('common.none')}</dd>
          </dl>
        </div>

        <div className="settings-card">
          <h3>{t('diag.probeTitle')}</h3>
          <p className="vb-tiny vb-muted">{t('diag.probeHint')}</p>
          <ul className="probe-list">
            {(report?.probe ?? []).map((probe) => (
              <li key={probe.id} className="probe-item">
                <div className="probe-item__head">
                  <span className="probe-item__label">{probe.label}</span>
                  <Badge tone={probe.available ? 'success' : 'neutral'}>{yesNo(probe.available, t)}</Badge>
                </div>
                <div className="probe-item__detail vb-tiny vb-muted">{probe.detail}</div>
              </li>
            ))}
          </ul>
        </div>

        <div className="settings-card">
          <h3>{t('diag.issues')}</h3>
          {report && report.issues.length > 0 ? (
            <ul className="issue-list">
              {report.issues.map((issue, index) => (
                <li key={index} className="vb-small">
                  {issue}
                </li>
              ))}
            </ul>
          ) : (
            <p className="vb-small vb-muted">{t('diag.noIssues')}</p>
          )}
        </div>

        <div className="settings-card">
          <h3>{t('diag.lastError')}</h3>
          {report?.lastError ? (
            <div className="diag-error">
              <Badge tone="danger">{report.lastError.code}</Badge>
              <div className="vb-small">{report.lastError.message}</div>
              {report.lastError.detail ? <div className="vb-tiny vb-muted">{report.lastError.detail}</div> : null}
            </div>
          ) : (
            <p className="vb-small vb-muted">{t('common.none')}</p>
          )}
        </div>
      </div>
    </section>
  );
}
