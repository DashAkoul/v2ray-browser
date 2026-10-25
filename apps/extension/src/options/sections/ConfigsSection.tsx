import { useMemo, useRef, useState } from 'react';
import type { ExportBundle, Profile } from '@v2rb/shared';
import { toShareLink } from '@v2rb/parser';
import {
  Badge,
  Button,
  ConfirmDialog,
  DownloadIcon,
  EmptyState,
  Modal,
  PlusIcon,
  SearchField,
  Select,
  ServerIcon,
  UploadIcon,
} from '@v2rb/ui';
import { AddConfigDialog } from '../../components/AddConfigDialog';
import { EditConfigDialog } from '../../components/EditConfigDialog';
import { ProfileCard } from '../../components/ProfileCard';
import { errorMessage, useI18n } from '../../i18n';
import { copyText } from '../../shared/clipboard';
import { rpc } from '../../shared/client';
import { importFile } from '../../shared/importFile';
import { downloadJson } from '../../shared/useAppSnapshot';
import type { SectionProps } from '../../shared/uiTypes';

type SortMode = 'recent' | 'name' | 'protocol';
type FilterMode = 'all' | 'connectable' | 'configOnly';

export function ConfigsSection({
  snapshot,
  onSnapshot,
  push,
  autoOpenAdd = false,
}: SectionProps & { autoOpenAdd?: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [addOpen, setAddOpen] = useState(autoOpenAdd);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const connectedProfileId = snapshot.connection.phase === 'active' ? snapshot.connection.profileId : null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.profiles
      .filter((profile) => {
        if (filter === 'connectable') return Boolean(profile.connectKind);
        if (filter === 'configOnly') return !profile.connectKind;
        return true;
      })
      .filter((profile) => {
        if (!needle) return true;
        return [profile.name, profile.host, profile.protocol, profile.group ?? '', profile.tags.join(' ')]
          .join(' ')
          .toLowerCase()
          .includes(needle);
      })
      .sort((a, b) => {
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'protocol') return a.protocol.localeCompare(b.protocol) || a.name.localeCompare(b.name);
        return (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt);
      });
  }, [snapshot.profiles, query, filter, sort]);

  const run = async (task: () => Promise<void>) => {
    try {
      await task();
    } catch (caught) {
      const code = (caught as { code?: string }).code;
      push(errorMessage(t, code, caught instanceof Error ? caught.message : undefined), 'error');
    }
  };

  const activate = (profile: Profile) =>
    run(async () => {
      onSnapshot(await rpc({ type: 'profile/set-active', id: profile.id }));
    });

  const toggleConnection = async (profile: Profile) => {
    setBusyId(profile.id);
    await run(async () => {
      const next =
        connectedProfileId === profile.id
          ? await rpc({ type: 'connection/disconnect' })
          : await rpc({ type: 'connection/connect', profileId: profile.id });
      onSnapshot(next as Parameters<typeof onSnapshot>[0]);
    });
    setBusyId(null);
  };

  const remove = async () => {
    if (!deleting) return;
    setDeletingBusy(true);
    await run(async () => {
      onSnapshot(await rpc({ type: 'profile/remove', id: deleting.id }));
      push(t('common.done'), 'success');
      setDeleting(null);
    });
    setDeletingBusy(false);
  };

  const copyLink = async (profile: Profile) => {
    const link = profile.rawUri ?? toShareLink(profile);
    const ok = await copyText(link);
    push(ok ? t('common.copied') : t('errors.generic'), ok ? 'success' : 'error');
  };

  const exportData = async (includeSecrets: boolean) => {
    await run(async () => {
      const bundle = await rpc<ExportBundle>({ type: 'profile/export', includeSecrets });
      downloadJson(`v2ray-browser-export-${new Date().toISOString().slice(0, 10)}.json`, bundle);
      setExportOpen(false);
      push(t('settings.exportedToast'), 'success');
    });
  };

  const importFromFile = async (file: File) => {
    await run(async () => {
      const result = await importFile(file);
      onSnapshot(result.snapshot);
      if (result.added > 0) push(t('settings.importedToast', { count: result.added }), 'success');
      if (result.skipped > 0) push(t('add.duplicatesToast', { count: result.skipped }), 'info');
      if (result.failures > 0) push(t('add.failuresToast', { count: result.failures }), 'warning');
    });
  };

  return (
    <section className="section" aria-labelledby="configs-title">
      <header className="section__header">
        <div>
          <h2 id="configs-title">{t('configs.title')}</h2>
          <p className="section__subtitle">{t('configs.subtitle')}</p>
        </div>
        <Badge tone="neutral">{t('configs.count', { count: snapshot.profiles.length })}</Badge>
      </header>

      <div className="toolbar">
        <div className="toolbar__row">
          <div className="toolbar__search">
            <SearchField value={query} onChange={setQuery} placeholder={t('configs.searchPlaceholder')} label={t('common.search')} />
          </div>
          <Select value={filter} onChange={(event) => setFilter(event.target.value as FilterMode)} aria-label={t('configs.filterAll')}>
            <option value="all">{t('configs.filterAll')}</option>
            <option value="connectable">{t('configs.filterConnectable')}</option>
            <option value="configOnly">{t('configs.filterConfigOnly')}</option>
          </Select>
          <Select value={sort} onChange={(event) => setSort(event.target.value as SortMode)} aria-label={t('configs.sortName')}>
            <option value="recent">{t('configs.sortRecent')}</option>
            <option value="name">{t('configs.sortName')}</option>
            <option value="protocol">{t('configs.sortProtocol')}</option>
          </Select>
        </div>
        <div className="toolbar__actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt,.conf,application/json,text/plain"
            className="vb-visually-hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFromFile(file);
              event.target.value = '';
            }}
          />
          <Button size="sm" variant="ghost" icon={<UploadIcon size={14} />} onClick={() => fileRef.current?.click()}>
            {t('configs.import')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<DownloadIcon size={14} />}
            onClick={() => setExportOpen(true)}
            disabled={snapshot.profiles.length === 0}
          >
            {t('configs.export')}
          </Button>
          <Button size="sm" variant="primary" icon={<PlusIcon size={14} />} onClick={() => setAddOpen(true)}>
            {t('configs.add')}
          </Button>
        </div>
      </div>

      {snapshot.profiles.length === 0 ? (
        <EmptyState
          icon={<ServerIcon size={22} />}
          title={t('configs.emptyTitle')}
          description={t('configs.emptyBody')}
          action={
            <Button size="sm" variant="primary" onClick={() => setAddOpen(true)}>
              {t('configs.add')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={t('configs.noResults')} description={t('configs.searchPlaceholder')} />
      ) : (
        <div className="profile-list">
          {filtered.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              active={profile.id === snapshot.settings.activeProfileId}
              connected={connectedProfileId === profile.id}
              connectable={Boolean(profile.connectKind)}
              busy={busyId === profile.id}
              onActivate={() => void activate(profile)}
              onEdit={() => setEditing(profile)}
              onDelete={() => setDeleting(profile)}
              onCopy={() => void copyLink(profile)}
              onToggleConnection={() => void toggleConnection(profile)}
            />
          ))}
        </div>
      )}

      <p className="section__note">{t('configs.secretMasked')}</p>

      {addOpen ? (
        <AddConfigDialog
          open
          onClose={() => setAddOpen(false)}
          onImported={(next) => {
            onSnapshot(next);
          }}
        />
      ) : null}

      {editing ? (
        <EditConfigDialog
          key={editing.id}
          profile={editing}
          onClose={() => setEditing(null)}
          onSaved={onSnapshot}
          push={push}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleting)}
        title={t('configs.deleteTitle')}
        description={t('configs.deleteBody', { name: deleting?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        destructive
        loading={deletingBusy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleting(null)}
      />

      <Modal
        open={exportOpen}
        title={t('configs.export')}
        onClose={() => setExportOpen(false)}
        size="sm"
        footer={
          <Button size="sm" variant="ghost" onClick={() => setExportOpen(false)}>
            {t('common.cancel')}
          </Button>
        }
      >
        <div className="vb-stack">
          <p className="vb-small vb-muted">{t('settings.exportHint')}</p>
          <Button variant="secondary" onClick={() => void exportData(false)}>
            {t('configs.exportNoSecrets')}
          </Button>
          <Button variant="primary" onClick={() => void exportData(true)}>
            {t('configs.exportSecrets')}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
