'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import type { NetworkStatus, SocialPerson } from '@/lib/social';
import { api, NetworkTag, useErrorText, useToast } from './shared';

/**
 * Ajustes de Social: quién publica solo y quién necesita aprobación, y qué
 * redes tiene configuradas la instancia (con la URL de vuelta y el webhook
 * que hay que registrar en cada app de desarrollador).
 */
export default function SettingsView({
  people,
  networks,
  admin,
  redirectUri,
  webhookUrl,
}: {
  people: SocialPerson[];
  networks: NetworkStatus[];
  admin: boolean;
  redirectUri: string;
  webhookUrl: string;
}) {
  const t = useTranslations('social.settings');
  const router = useRouter();
  const errorText = useErrorText();
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function setRole(personId: string, role: string) {
    setBusy(personId);
    try {
      await api('/people', { method: 'PATCH', json: { personId, role } });
      showToast(t('saved'));
      router.refresh();
    } catch (err) {
      showToast(errorText(err), true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="sc-page">
      <section className="sc-panel" aria-labelledby="sc-roles">
        <h2 id="sc-roles">{t('rolesTitle')}</h2>
        <p className="sc-muted">{t('rolesBody')}</p>
        {admin ? (
          <div className="sc-list">
            {people.map((p) => (
              <div key={p.id} className="sc-item" data-testid="social-person">
                <div className="sc-item-main">
                  <strong className="sc-wrap">{p.name}</strong>
                  <span className="sc-muted sc-small sc-wrap">{p.email}</span>
                  <span className="sc-muted sc-small">
                    {t('accounts')}: {p.socialRole === 'admin' ? t('all') : p.accountIds.length}
                  </span>
                </div>
                <div className="sc-item-side">
                  {p.socialRole === 'admin' ? (
                    <span className="sc-small">{t('role_admin')}</span>
                  ) : (
                    <select className="select" aria-label={t('roleFor', { name: p.name })} value={p.socialRole} disabled={busy === p.id} onChange={(e) => void setRole(p.id, e.target.value)}>
                      <option value="publisher">{t('role_publisher')}</option>
                      <option value="drafter">{t('role_drafter')}</option>
                    </select>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="sc-muted">{t('adminOnly')}</p>
        )}
      </section>

      <section className="sc-panel" aria-labelledby="sc-apps">
        <h2 id="sc-apps">{t('appsTitle')}</h2>
        <p className="sc-muted">{t('appsBody')}</p>
        <dl className="sc-checks">
          <dt className="sc-small">{t('redirectUri')}</dt>
          <dd>
            <code className="sc-wrap">{redirectUri}</code>
          </dd>
          <dt className="sc-small">{t('webhookUrl')}</dt>
          <dd>
            <code className="sc-wrap">{webhookUrl}</code>
          </dd>
        </dl>
        <div className="sc-list">
          {networks.map((n) => (
            <div key={n.network} className="sc-item">
              <div className="sc-item-main">
                <NetworkTag network={n.network} name={n.name} />
                <code className="sc-wrap sc-small">{n.env.join(', ') || t('appPassword')}</code>
              </div>
              <div className="sc-item-side">
                <span className="sc-small">{n.method === 'app_password' ? t('configured') : n.configured ? t('configured') : t('notConfigured')}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      {toast}
    </div>
  );
}
