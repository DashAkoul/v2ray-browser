import type { MessageKey } from '../../i18n/en';
import { Badge, ExternalIcon, Logo, ShieldIcon } from '@v2rb/ui';
import { useI18n } from '../../i18n';
import type { SectionProps } from '../../shared/uiTypes';

type Status = 'supported' | 'config' | 'unsupported';

interface Row {
  protocol: string;
  label?: string;
  status: Status;
  reason: MessageKey;
}

const REPO_URL = 'https://github.com/DashAkoul/v2ray-browser';

export function AboutSection({ snapshot }: SectionProps) {
  const { t } = useI18n();
  const chrome = snapshot.browser === 'chrome';

  const rows: Row[] = [
    { protocol: 'socks5', status: 'supported', reason: 'about.reason.socks' },
    { protocol: 'socks4', status: 'supported', reason: 'about.reason.socks' },
    { protocol: 'http', status: 'supported', reason: 'about.reason.http' },
    {
      protocol: 'https',
      status: chrome ? 'supported' : 'unsupported',
      reason: chrome ? 'about.reason.https.chrome' : 'about.reason.https.firefox',
    },
    { protocol: 'vless', status: 'config', reason: 'about.reason.noSockets' },
    { protocol: 'vmess', status: 'config', reason: 'about.reason.noSockets' },
    { protocol: 'trojan', status: 'config', reason: 'about.reason.noSockets' },
    { protocol: 'shadowsocks', status: 'config', reason: 'about.reason.ss' },
    { protocol: 'shadowsocksr', status: 'config', reason: 'about.reason.ss' },
    { protocol: 'hysteria2', status: 'config', reason: 'about.reason.udp' },
    { protocol: 'wireguard', status: 'config', reason: 'about.reason.tunnel' },
    { protocol: 'openvpn', label: 'OpenVPN', status: 'unsupported', reason: 'about.reason.tunnel' },
  ];

  return (
    <section className="section" aria-labelledby="about-title">
      <header className="section__header">
        <div className="about-brand">
          <Logo size={40} />
          <div>
            <h2 id="about-title">{t('about.title')}</h2>
            <p className="section__subtitle">{t('about.version', { version: snapshot.version })}</p>
          </div>
        </div>
      </header>

      <div className="settings-card">
        <h3>{t('about.disclaimerTitle')}</h3>
        <p className="vb-small about-text">{t('about.disclaimerBody')}</p>
        <div className="disclaimer-box">
          <ShieldIcon size={16} />
          <span className="vb-tiny">{t('popup.browserOnlyNote')}</span>
        </div>
      </div>

      <div className="settings-card">
        <h3>{t('about.protocolTitle')}</h3>
        <div className="table-wrap">
          <table className="proto-table">
            <thead>
              <tr>
                <th>{t('about.protocolHeader')}</th>
                <th>{t('about.protocolStatus')}</th>
                <th>{t('about.protocolReason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.protocol}>
                  <td className="vb-mono">{row.protocol}</td>
                  <td>
                    {row.status === 'supported' ? (
                      <Badge tone="success">{t('about.protocolSupported')}</Badge>
                    ) : row.status === 'config' ? (
                      <Badge tone="warning">{t('about.protocolConfigOnly')}</Badge>
                    ) : (
                      <Badge tone="danger">{t('about.protocolUnsupported')}</Badge>
                    )}
                  </td>
                  <td className="vb-small vb-soft">{t(row.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="vb-tiny vb-muted">{t('about.testNote')}</p>
      </div>

      <div className="settings-card">
        <h3>{t('about.license')}</h3>
        <p className="vb-small about-text">{t('about.licenseBody')}</p>
        <h3 style={{ marginTop: 12 }}>{t('about.privacy')}</h3>
        <p className="vb-small about-text">{t('about.privacyBody')}</p>
        <a className="about-link" href={REPO_URL} target="_blank" rel="noreferrer noopener">
          {t('about.repo')}
          <ExternalIcon size={13} />
        </a>
      </div>
    </section>
  );
}
