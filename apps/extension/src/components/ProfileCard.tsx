import type { Profile } from '@v2rb/shared';
import { endpointLabel } from '@v2rb/parser';
import { Badge, Button, IconButton, CheckIcon, CopyIcon, PencilIcon, PowerIcon, TrashIcon } from '@v2rb/ui';
import { protocolKey, useI18n } from '../i18n';

export function ProfileCard({
  profile,
  active,
  connected,
  connectable,
  busy,
  onActivate,
  onEdit,
  onDelete,
  onCopy,
  onToggleConnection,
}: {
  profile: Profile;
  active: boolean;
  connected: boolean;
  connectable: boolean;
  busy: boolean;
  onActivate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onToggleConnection: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className={`profile-card ${active ? 'profile-card--active' : ''}`} aria-current={active}>
      <div className="profile-card__main">
        <div className="profile-card__top">
          <h3 className="profile-card__name vb-truncate">{profile.name}</h3>
          {active ? <Badge tone="success">{t('configs.active')}</Badge> : null}
          <Badge tone="accent">{t(protocolKey(profile.protocol))}</Badge>
          {!connectable ? (
            <Badge tone="warning" title={t('popup.configOnlyNotice')}>
              {t('configs.configOnly')}
            </Badge>
          ) : null}
          {profile.source.subscriptionId ? (
            <Badge tone="neutral">{t('configs.sourceSubscription')}</Badge>
          ) : null}
        </div>
        <div className="profile-card__endpoint vb-mono">{endpointLabel(profile)}</div>
        <div className="profile-card__meta">
          {profile.group ? <span className="tag tag--group">{profile.group}</span> : null}
          {profile.tags.slice(0, 4).map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
          <span className="profile-card__source">
            {profile.source.subscriptionId ? t('configs.sourceSubscription') : t('configs.sourceManual')}
          </span>
        </div>
      </div>
      <div className="profile-card__actions">
        {active && connectable ? (
          <Button
            size="sm"
            variant={connected ? 'secondary' : 'primary'}
            loading={busy}
            icon={<PowerIcon size={13} />}
            onClick={onToggleConnection}
          >
            {connected ? t('configs.disconnect') : t('configs.connect')}
          </Button>
        ) : null}
        <IconButton label={t('configs.setActive')} size="sm" onClick={onActivate} disabled={active}>
          <CheckIcon size={15} />
        </IconButton>
        <IconButton label={t('configs.copyLink')} size="sm" onClick={onCopy}>
          <CopyIcon size={15} />
        </IconButton>
        <IconButton label={t('common.edit')} size="sm" onClick={onEdit}>
          <PencilIcon size={15} />
        </IconButton>
        <IconButton label={t('common.delete')} size="sm" onClick={onDelete}>
          <TrashIcon size={15} />
        </IconButton>
      </div>
    </article>
  );
}
