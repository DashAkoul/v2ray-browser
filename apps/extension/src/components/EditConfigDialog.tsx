import { useState } from 'react';
import type { Profile, ProfilePatch } from '@v2rb/shared';
import { Badge, Button, Field, Modal, TextInput } from '@v2rb/ui';
import { protocolKey, useI18n, errorMessage } from '../i18n';
import { rpc } from '../shared/client';
import type { AppSnapshot } from '../shared/protocol';
import type { PushToast } from '../shared/uiTypes';

export function EditConfigDialog({
  profile,
  onClose,
  onSaved,
  push,
}: {
  profile: Profile;
  onClose: () => void;
  onSaved: (snapshot: AppSnapshot) => void;
  push: PushToast;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(profile.name);
  const [host, setHost] = useState(profile.host);
  const [port, setPort] = useState(String(profile.port));
  const [tags, setTags] = useState(profile.tags.join(', '));
  const [group, setGroup] = useState(profile.group ?? '');
  const [sni, setSni] = useState(profile.security.sni ?? '');
  const [secret, setSecret] = useState(
    profile.credentials.kind === 'uuid'
      ? (profile.credentials.uuid ?? '')
      : (profile.credentials.password ?? ''),
  );
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasSecret = profile.credentials.kind === 'uuid' || profile.credentials.kind === 'password' || profile.credentials.kind === 'method-password';

  const save = async () => {
    setError(null);
    const portNumber = Number(port);
    if (!name.trim()) return setError(t('add.required'));
    if (!host.trim()) return setError(t('add.invalidHost'));
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      return setError(t('add.invalidPort'));
    }
    setBusy(true);
    try {
      const patch: ProfilePatch = {
        name: name.trim(),
        host: host.trim(),
        port: portNumber,
        tags: tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        group: group.trim(),
      };
      if (profile.security.type !== 'none') {
        patch.security = { type: profile.security.type, sni: sni.trim() };
      }
      if (hasSecret && profile.credentials.kind === 'uuid') {
        patch.credentials = { kind: 'uuid', uuid: secret.trim() };
      } else if (hasSecret) {
        patch.credentials = { kind: profile.credentials.kind, password: secret };
      }
      const snapshot = await rpc<AppSnapshot>({
        type: 'profile/update',
        id: profile.id,
        patch,
      });
      onSaved(snapshot);
      push(t('edit.saved'), 'success');
      onClose();
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      setError(errorMessage(t, code, caught instanceof Error ? caught.message : undefined));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={t('edit.title')}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" variant="primary" onClick={() => void save()} loading={busy}>
            {t('edit.save')}
          </Button>
        </>
      }
    >
      <div className="vb-stack">
        <div className="vb-row vb-row--between">
          <Badge tone="accent">{t(protocolKey(profile.protocol))}</Badge>
          <span className="vb-tiny vb-muted">{t('edit.readonlyNote')}</span>
        </div>
        <div className="form-grid">
          <Field label={t('edit.name')}>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} maxLength={200} />
          </Field>
          <Field label={t('edit.group')}>
            <TextInput value={group} onChange={(event) => setGroup(event.target.value)} maxLength={80} />
          </Field>
          <Field label={t('edit.host')}>
            <TextInput value={host} onChange={(event) => setHost(event.target.value)} />
          </Field>
          <Field label={t('edit.port')}>
            <TextInput value={port} inputMode="numeric" onChange={(event) => setPort(event.target.value)} />
          </Field>
        </div>
        <Field label={t('edit.tags')} hint={t('edit.tagsHint')}>
          <TextInput value={tags} onChange={(event) => setTags(event.target.value)} />
        </Field>
        {profile.security.type !== 'none' ? (
          <Field label={t('edit.sni')}>
            <TextInput value={sni} onChange={(event) => setSni(event.target.value)} />
          </Field>
        ) : null}
        {hasSecret ? (
          <Field label={t('edit.credentials')}>
            <div className="vb-row">
              <TextInput
                className="vb-mono"
                type={reveal ? 'text' : 'password'}
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                autoComplete="off"
              />
              <Button size="sm" variant="secondary" onClick={() => setReveal((current) => !current)}>
                {reveal ? t('common.hide') : t('common.show')}
              </Button>
            </div>
          </Field>
        ) : null}
        {error ? (
          <div className="vb-field__error" role="alert">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
