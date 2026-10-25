import { useRef, useState } from 'react';
import type { ProfileSourceType } from '@v2rb/shared';
import { Button, Field, Modal, Select, Tabs, TextInput, useToasts, ToastStack } from '@v2rb/ui';
import { parseInput } from '@v2rb/parser';
import { rpc } from '../shared/client';
import { useI18n, errorMessage, protocolKey } from '../i18n';
import { buildManualLink, EMPTY_MANUAL_DRAFT, protocolNeedsMethod, protocolNeedsUuid, protocolUsesCredentials, protocolUsesSecurity, type ManualDraft } from '../shared/manual';
import type { AppSnapshot } from '../shared/protocol';

interface AddResponse {
  snapshot: AppSnapshot;
  added: number;
  duplicates: number;
  failures: Array<{ input: string; error: { message: string } }>;
}

const PROTOCOLS = ['socks5', 'socks4', 'http', 'https', 'vless', 'vmess', 'trojan', 'shadowsocks', 'shadowsocksr', 'hysteria2', 'wireguard'];

export function AddConfigDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (snapshot: AppSnapshot) => void;
}) {
  const { t } = useI18n();
  const { toasts, push, dismiss } = useToasts();
  const [tab, setTab] = useState('link');
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<ManualDraft>(EMPTY_MANUAL_DRAFT);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText('');
    setDraft(EMPTY_MANUAL_DRAFT);
    setFieldError(null);
    setParseErrors([]);
    setFileName(null);
  };

  const finish = (response: AddResponse) => {
    onImported(response.snapshot);
    if (response.added > 0) push(t('add.addedToast', { count: response.added }), 'success');
    if (response.duplicates > 0) push(t('add.duplicatesToast', { count: response.duplicates }), 'info');
    if (response.failures.length > 0) {
      push(t('add.failuresToast', { count: response.failures.length }), 'warning');
      setParseErrors(response.failures.slice(0, 3).map((failure) => failure.error.message));
    }
    if (response.added > 0) {
      reset();
      onClose();
    }
  };

  const importText = async (value: string, source: ProfileSourceType) => {
    if (!value.trim()) return;
    setBusy(true);
    setParseErrors([]);
    try {
      const response = await rpc<AddResponse>({ type: 'profile/add', input: value, source });
      finish(response);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      const message = caught instanceof Error ? caught.message : undefined;
      if (code === 'PARSE' && message) setParseErrors([message]);
      push(errorMessage(t, code, message), 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitManual = async () => {
    setFieldError(null);
    const built = buildManualLink(draft);
    if (!built.ok) {
      setFieldError(t(built.error));
      return;
    }
    await importText(built.link, 'manual');
  };

  const importFile = async (file: File) => {
    setBusy(true);
    setParseErrors([]);
    setFileName(file.name);
    try {
      const content = await file.text();
      const trimmed = content.trim();
      if (trimmed.startsWith('{')) {
        try {
          const json: unknown = JSON.parse(trimmed);
          if (typeof json === 'object' && json !== null && (json as Record<string, unknown>)['format'] === 'v2ray-browser.export') {
            const response = await rpc<{ snapshot: AppSnapshot; added: number; skipped: number }>({
              type: 'profile/import-bundle',
              bundle: json,
              mode: 'merge',
            });
            onImported(response.snapshot);
            push(t('settings.importedToast', { count: response.added }), 'success');
            onClose();
            return;
          }
        } catch {
          // Not JSON: fall through to link parsing.
        }
      }
      const parsed = parseInput(trimmed, { source: 'file', maxBytes: 1024 * 1024 });
      if (!parsed.ok) {
        setParseErrors([parsed.error.message]);
        push(errorMessage(t, parsed.error.code, parsed.error.message), 'error');
        return;
      }
      const response = await rpc<AddResponse>({ type: 'profile/add', input: trimmed, source: 'file' });
      finish(response);
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    } finally {
      setBusy(false);
    }
  };

  const pasteClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      if (!value.trim()) {
        push(t('add.clipboardEmpty'), 'warning');
        return;
      }
      setText(value);
      await importText(value, 'clipboard');
    } catch {
      push(t('add.clipboardDenied'), 'error');
    }
  };

  const update = (patch: Partial<ManualDraft>) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <>
      <Modal
        open={open}
        title={t('add.title')}
        onClose={() => {
          reset();
          onClose();
        }}
        footer={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              {t('common.cancel')}
            </Button>
            {tab === 'link' ? (
              <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={() => void importText(text, 'paste')}>
                {t('add.importButton')}
              </Button>
            ) : null}
            {tab === 'manual' ? (
              <Button size="sm" variant="primary" loading={busy} onClick={() => void submitManual()}>
                {t('add.addButton')}
              </Button>
            ) : null}
            {tab === 'file' ? (
              <Button size="sm" variant="primary" loading={busy} onClick={() => fileRef.current?.click()}>
                {t('add.chooseFile')}
              </Button>
            ) : null}
          </>
        }
      >
        <div className="vb-stack">
          <Tabs
            label={t('add.title')}
            value={tab}
            onChange={(next) => {
              setTab(next);
              setParseErrors([]);
            }}
            items={[
              { id: 'link', label: t('add.tabLink') },
              { id: 'manual', label: t('add.tabManual') },
              { id: 'file', label: t('add.tabFile') },
            ]}
          />

          {tab === 'link' ? (
            <>
              <Field label={t('add.linkLabel')} hint={t('add.linkHint')}>
                <textarea
                  className="vb-textarea"
                  rows={6}
                  value={text}
                  placeholder={t('add.linkPlaceholder')}
                  onChange={(event) => setText(event.target.value)}
                  spellCheck={false}
                />
              </Field>
              <div className="vb-row vb-row--between">
                <Button size="sm" variant="secondary" onClick={() => void pasteClipboard()}>
                  {t('add.clipboard')}
                </Button>
                <span className="vb-tiny vb-muted">{t('popup.browserOnlyNote')}</span>
              </div>
            </>
          ) : null}

          {tab === 'manual' ? (
            <div className="vb-stack">
              <div className="form-grid">
                <Field label={t('add.name')}>
                  <TextInput value={draft.name} onChange={(event) => update({ name: event.target.value })} />
                </Field>
                <Field label={t('add.protocol')}>
                  <Select value={draft.protocol} onChange={(event) => update({ protocol: event.target.value })}>
                    {PROTOCOLS.map((protocol) => (
                      <option key={protocol} value={protocol}>
                        {t(protocolKey(protocol))}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('add.host')}>
                  <TextInput
                    value={draft.host}
                    placeholder="example.com"
                    onChange={(event) => update({ host: event.target.value })}
                  />
                </Field>
                <Field label={t('add.port')}>
                  <TextInput
                    value={draft.port}
                    inputMode="numeric"
                    placeholder="443"
                    onChange={(event) => update({ port: event.target.value })}
                  />
                </Field>
                {protocolNeedsUuid(draft.protocol) ? (
                  <Field label={t('add.uuid')}>
                    <TextInput
                      className="vb-mono"
                      value={draft.uuid}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      onChange={(event) => update({ uuid: event.target.value })}
                    />
                  </Field>
                ) : null}
                {protocolNeedsMethod(draft.protocol) ? (
                  <Field label={t('add.method')}>
                    <TextInput value={draft.method} onChange={(event) => update({ method: event.target.value })} />
                  </Field>
                ) : null}
                {protocolUsesCredentials(draft.protocol) ? (
                  <Field label={t('add.username')}>
                    <TextInput value={draft.username} onChange={(event) => update({ username: event.target.value })} />
                  </Field>
                ) : null}
                {!protocolNeedsUuid(draft.protocol) ? (
                  <Field label={t('add.password')}>
                    <TextInput
                      type="password"
                      value={draft.password}
                      autoComplete="off"
                      onChange={(event) => update({ password: event.target.value })}
                    />
                  </Field>
                ) : null}
                {protocolUsesSecurity(draft.protocol) ? (
                  <>
                    <Field label={t('add.security')}>
                      <Select
                        value={draft.security}
                        onChange={(event) => update({ security: event.target.value as ManualDraft['security'] })}
                      >
                        <option value="none">none</option>
                        <option value="tls">tls</option>
                        <option value="reality">reality</option>
                      </Select>
                    </Field>
                    <Field label={t('add.sni')}>
                      <TextInput value={draft.sni} onChange={(event) => update({ sni: event.target.value })} />
                    </Field>
                    <Field label={t('add.transport')}>
                      <Select
                        value={draft.transport}
                        onChange={(event) => update({ transport: event.target.value as ManualDraft['transport'] })}
                      >
                        <option value="tcp">tcp</option>
                        <option value="ws">ws</option>
                        <option value="grpc">grpc</option>
                      </Select>
                    </Field>
                    <Field label={t('add.path')}>
                      <TextInput value={draft.path} onChange={(event) => update({ path: event.target.value })} />
                    </Field>
                  </>
                ) : null}
              </div>
              {fieldError ? (
                <div className="vb-field__error" role="alert">
                  {fieldError}
                </div>
              ) : null}
              <p className="vb-tiny vb-muted">{t('add.manualHint')}</p>
            </div>
          ) : null}

          {tab === 'file' ? (
            <div className="vb-stack">
              <p className="vb-small vb-soft">{t('add.fileHint')}</p>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.json,.conf,application/json,text/plain"
                className="vb-visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void importFile(file);
                  event.target.value = '';
                }}
              />
              <div className="file-drop">
                <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()} loading={busy}>
                  {busy ? t('add.readingFile') : t('add.chooseFile')}
                </Button>
                <span className="vb-tiny vb-muted">{fileName ?? '.txt · .json · .conf'}</span>
              </div>
            </div>
          ) : null}

          {parseErrors.length > 0 ? (
            <div className="inline-errors" role="alert">
              {parseErrors.map((message, index) => (
                <div key={index} className="vb-tiny">
                  {message}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </Modal>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  );
}
