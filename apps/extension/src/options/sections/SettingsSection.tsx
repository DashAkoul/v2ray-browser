import { useEffect, useRef, useState } from 'react';
import type { ExportBundle, Settings } from '@v2rb/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  Divider,
  Field,
  Select,
  Switch,
  TextInput,
} from '@v2rb/ui';
import { errorMessage, useI18n } from '../../i18n';
import { rpc } from '../../shared/client';
import { downloadJson } from '../../shared/useAppSnapshot';
import { importFile } from '../../shared/importFile';
import type { SectionProps } from '../../shared/uiTypes';
import type { AppSnapshot } from '../../shared/protocol';

export function SettingsSection({ snapshot, onSnapshot, push }: SectionProps) {
  const { t } = useI18n();
  const settings = snapshot.settings;
  const isFirefox = snapshot.browser === 'firefox';

  const [bypass, setBypass] = useState(settings.bypassList.join('\n'));
  const [healthUrl, setHealthUrl] = useState(settings.healthCheck.url);
  const [healthTimeout, setHealthTimeout] = useState(String(settings.healthCheck.timeoutMs));
  const [staleHours, setStaleHours] = useState(String(settings.subscriptionAutoRefresh.staleAfterHours));
  const [includeSecrets, setIncludeSecrets] = useState(false);
  const [replaceOnImport, setReplaceOnImport] = useState(false);
  const [clearScope, setClearScope] = useState<'profiles' | 'all' | null>(null);
  const [clearBusy, setClearBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setBypass(settings.bypassList.join('\n'));
    setHealthUrl(settings.healthCheck.url);
    setHealthTimeout(String(settings.healthCheck.timeoutMs));
    setStaleHours(String(settings.subscriptionAutoRefresh.staleAfterHours));
  }, [settings]);

  const save = async (patch: Partial<Settings>, announce = true) => {
    try {
      onSnapshot(await rpc<AppSnapshot>({ type: 'settings/update', patch }));
      if (announce) push(t('settings.savedToast'), 'success');
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    }
  };

  const saveBypass = () =>
    void save({
      bypassList: bypass
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    });

  const saveHealth = () =>
    void save({
      healthCheck: {
        enabled: settings.healthCheck.enabled,
        url: healthUrl.trim(),
        timeoutMs: Number(healthTimeout),
      },
    });

  const saveAutoRefresh = (enabled: boolean, hours: number) =>
    void save({ subscriptionAutoRefresh: { enabled, staleAfterHours: hours } });

  const exportData = async () => {
    try {
      const bundle = await rpc<ExportBundle>({ type: 'profile/export', includeSecrets });
      downloadJson(`v2ray-browser-backup-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      push(t('settings.exportedToast'), 'success');
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    }
  };

  const importData = async (file: File) => {
    setImportBusy(true);
    try {
      const result = await importFile(file);
      onSnapshot(result.snapshot);
      push(t('settings.importedToast', { count: result.added }), 'success');
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    } finally {
      setImportBusy(false);
    }
  };

  const importBundleFile = async (file: File) => {
    setImportBusy(true);
    try {
      const text = await file.text();
      const json: unknown = JSON.parse(text);
      const response = await rpc<{ snapshot: AppSnapshot; added: number; skipped: number }>({
        type: 'profile/import-bundle',
        bundle: json,
        mode: replaceOnImport ? 'replace' : 'merge',
      });
      onSnapshot(response.snapshot);
      push(t('settings.importedToast', { count: response.added }), 'success');
    } catch (caught) {
      if (caught instanceof SyntaxError) push(t('settings.invalidImport'), 'error');
      else {
        const code = (caught as { code?: string }).code;
        push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
      }
    } finally {
      setImportBusy(false);
    }
  };

  const clear = async () => {
    if (!clearScope) return;
    setClearBusy(true);
    try {
      onSnapshot(await rpc<AppSnapshot>({ type: 'data/clear', scope: clearScope }));
      push(t('settings.clearDone'), 'success');
      setClearScope(null);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    } finally {
      setClearBusy(false);
    }
  };

  return (
    <section className="section" aria-labelledby="settings-title">
      <header className="section__header">
        <div>
          <h2 id="settings-title">{t('settings.title')}</h2>
          <p className="section__subtitle">{t('settings.subtitle')}</p>
        </div>
        <Badge tone="neutral">{t('about.version', { version: snapshot.version })}</Badge>
      </header>

      <div className="settings-grid">
        <div className="settings-card">
          <h3>{t('settings.appearance')}</h3>
          <Field label={t('settings.theme')}>
            <div className="segmented" role="group" aria-label={t('settings.theme')}>
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`segmented__item ${settings.theme === theme ? 'segmented__item--active' : ''}`}
                  aria-pressed={settings.theme === theme}
                  onClick={() => void save({ theme })}
                >
                  {theme === 'system' ? t('settings.themeSystem') : theme === 'light' ? t('settings.themeLight') : t('settings.themeDark')}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('settings.language')}>
            <Select
              value={settings.locale}
              onChange={(event) => void save({ locale: event.target.value as Settings['locale'] })}
            >
              <option value="auto">{t('settings.languageAuto')}</option>
              <option value="en">{t('settings.english')}</option>
              <option value="fa">{t('settings.persian')}</option>
            </Select>
          </Field>
        </div>

        <div className="settings-card">
          <h3>{t('settings.network')}</h3>
          <Field label={t('settings.bypassLabel')} hint={t('settings.bypassHint')}>
            <textarea
              className="vb-textarea"
              rows={4}
              value={bypass}
              onChange={(event) => setBypass(event.target.value)}
              spellCheck={false}
              dir="ltr"
            />
          </Field>
          <Button size="sm" variant="secondary" onClick={saveBypass}>
            {t('common.save')}
          </Button>
          <Divider />
          <div className="settings-inline">
            <div>
              <div className="settings-inline__title">{t('settings.healthEnabled')}</div>
            </div>
            <Switch
              label={t('settings.healthEnabled')}
              checked={settings.healthCheck.enabled}
              onChange={(enabled) =>
                void save({ healthCheck: { ...settings.healthCheck, enabled } })
              }
            />
          </div>
          <div className="form-grid">
            <Field label={t('settings.healthUrl')}>
              <TextInput value={healthUrl} dir="ltr" onChange={(event) => setHealthUrl(event.target.value)} />
            </Field>
            <Field label={t('settings.healthTimeout')}>
              <TextInput value={healthTimeout} inputMode="numeric" onChange={(event) => setHealthTimeout(event.target.value)} />
            </Field>
          </div>
          <Button size="sm" variant="secondary" onClick={saveHealth}>
            {t('common.save')}
          </Button>
          <Divider />
          <div className="settings-inline">
            <div>
              <div className="settings-inline__title">{t('settings.webRtc')}</div>
              <div className="vb-tiny vb-muted">
                {isFirefox ? t('settings.webRtcUnsupported') : t('settings.webRtcHint')}
              </div>
            </div>
            <Switch
              label={t('settings.webRtc')}
              checked={settings.webRtcLeakGuard}
              disabled={isFirefox}
              onChange={(enabled) => void save({ webRtcLeakGuard: enabled })}
            />
          </div>
        </div>

        <div className="settings-card">
          <h3>{t('settings.autoRefresh')}</h3>
          <div className="settings-inline">
            <div className="vb-tiny vb-muted">{t('settings.autoRefreshHint')}</div>
            <Switch
              label={t('settings.autoRefresh')}
              checked={settings.subscriptionAutoRefresh.enabled}
              onChange={(enabled) => saveAutoRefresh(enabled, Number(staleHours) || 24)}
            />
          </div>
          <div className="form-grid">
            <Field label={t('settings.autoRefreshHours')}>
              <TextInput
                value={staleHours}
                inputMode="numeric"
                onChange={(event) => setStaleHours(event.target.value)}
                onBlur={() => saveAutoRefresh(settings.subscriptionAutoRefresh.enabled, Number(staleHours) || 24)}
              />
            </Field>
          </div>
        </div>

        <div className="settings-card">
          <h3>{t('settings.data')}</h3>
          <p className="vb-small vb-muted">{t('settings.exportHint')}</p>
          <label className="settings-check">
            <input type="checkbox" checked={includeSecrets} onChange={(event) => setIncludeSecrets(event.target.checked)} />
            {t('configs.exportSecrets')}
          </label>
          <Button size="sm" variant="secondary" onClick={() => void exportData()}>
            {t('settings.export')}
          </Button>
          <Divider />
          <p className="vb-small vb-muted">{t('settings.importHint')}</p>
          <label className="settings-check">
            <input
              type="checkbox"
              checked={replaceOnImport}
              onChange={(event) => setReplaceOnImport(event.target.checked)}
            />
            {t('settings.importReplace')}
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.conf,application/json,text/plain"
            className="vb-visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                if (replaceOnImport) void importBundleFile(file);
                else void importData(file);
              }
              event.target.value = '';
            }}
          />
          <Button size="sm" variant="secondary" loading={importBusy} onClick={() => fileRef.current?.click()}>
            {t('settings.import')}
          </Button>
        </div>

        <div className="settings-card settings-card--danger">
          <h3>{t('common.warning')}</h3>
          <p className="vb-small vb-muted">{t('settings.clearBody')}</p>
          <div className="vb-row" style={{ flexWrap: 'wrap' }}>
            <Button size="sm" variant="danger" onClick={() => setClearScope('profiles')}>
              {t('settings.clearProfiles')}
            </Button>
            <Button size="sm" variant="danger" onClick={() => setClearScope('all')}>
              {t('settings.clearAll')}
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(clearScope)}
        title={t('settings.clearTitle')}
        description={t('settings.clearBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={clearBusy}
        onConfirm={() => void clear()}
        onCancel={() => setClearScope(null)}
      />
    </section>
  );
}
