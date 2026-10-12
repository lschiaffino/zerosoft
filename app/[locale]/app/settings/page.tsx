import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { listApiKeys } from '@/lib/api-auth';
import { formatDate } from '@/lib/utils';
import ApiKeysPanel from '@/components/link/ApiKeysPanel';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(props: { params: Promise<{ locale: string }> }) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'link' });
  const keys = await listApiKeys(user.id);

  return (
    <div className="app-page">
      <h1 className="app-title">{t('settings.title')}</h1>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('settings.profile')}</p>
          {DEMO_MODE && <span className="badge status-protected">{t('settings.demoBadge')}</span>}
        </div>
        {DEMO_MODE && <p className="muted demo-note">{t('settings.demoDesc')}</p>}
        <div className="profile-row">
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="" className="profile-avatar" />
          ) : (
            <span className="brand-zero profile-avatar-fallback">0</span>
          )}
          <div className="profile-fields">
            <div className="profile-field">
              <span className="label">{t('settings.name')}</span>
              <span>{user.name ?? '—'}</span>
            </div>
            <div className="profile-field">
              <span className="label">{t('settings.email')}</span>
              <span className="mono">{user.email}</span>
            </div>
            <div className="profile-field">
              <span className="label">{t('settings.memberSince')}</span>
              <span className="mono">{formatDate(user.created_at, locale)}</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <p className="section-label">{t('settings.apiKeys')}</p>
        <ApiKeysPanel initialKeys={keys} />
      </section>
    </div>
  );
}
