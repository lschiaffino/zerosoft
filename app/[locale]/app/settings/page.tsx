import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DEMO_MODE, requireUser } from '@/lib/session';
import { formatDate } from '@/lib/utils';
import FormSection from '@/components/ui/FormSection';
import { settingsSectionMetadata } from '@/lib/settings-meta';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'profile');
}

/** Ajustes › Cuenta: quién sos en este workspace. Solo lectura: los datos vienen del login. */
export default async function AccountSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.account' });
  const me = user.actingUser ?? user;
  const initial = (me.name ?? me.email).trim().charAt(0).toUpperCase() || 'Z';

  return (
    <FormSection
      title={t('title')}
      description={t('desc')}
      footer={<p className="ui-section-note">{DEMO_MODE ? t('demoNote') : t('note')}</p>}
    >
      <div className="st-profile">
        {me.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.image} alt="" className="st-avatar" width={48} height={48} />
        ) : (
          <span className="st-avatar st-avatar-initial" aria-hidden="true">
            {initial}
          </span>
        )}
        <dl className="st-facts">
          <div>
            <dt>{t('name')}</dt>
            <dd>{me.name ?? <span className="st-muted">{t('noName')}</span>}</dd>
          </div>
          <div>
            <dt>{t('email')}</dt>
            <dd className="data">{me.email}</dd>
          </div>
          <div>
            <dt>{t('role')}</dt>
            <dd>
              {t(`roles.${user.role}`)}
              {DEMO_MODE && <span className="badge badge-ink st-inline-badge">{t('demoBadge')}</span>}
            </dd>
          </div>
          {user.team && (
            <div>
              <dt>{t('workspace')}</dt>
              <dd>{user.team.name}</dd>
            </div>
          )}
          <div>
            <dt>{t('memberSince')}</dt>
            <dd className="data">{formatDate(me.created_at, locale)}</dd>
          </div>
        </dl>
      </div>
    </FormSection>
  );
}
