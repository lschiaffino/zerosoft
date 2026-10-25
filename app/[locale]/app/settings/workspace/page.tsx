import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import FormSection from '@/components/ui/FormSection';
import SettingsSoonSection from '@/components/app/SettingsSoonSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'workspace');
}

/**
 * Ajustes › Workspace: la ficha del workspace. Lo que vivía acá se mudó a su
 * sección (API keys y webhooks → API, uso de IA → Plan y uso, credenciales →
 * Conexiones, datos de Link → ajustes de Link); los anchors viejos (#api,
 * #webhooks, #ai, #credentials) los redirige PlatformSettingsNav.
 */
export default async function WorkspaceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.workspace' });
  const ta = await getTranslations({ locale, namespace: 'settings.account' });
  const name = user.team?.name ?? user.name ?? user.email;

  return (
    <SettingsSoonSection locale={locale} section="workspace">
      <FormSection title={t('title')} description={t('desc')}>
        <dl className="st-facts">
          <div>
            <dt>{t('name')}</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>{t('owner')}</dt>
            <dd className="data">{user.email}</dd>
          </div>
          <div>
            <dt>{ta('role')}</dt>
            <dd>{ta(`roles.${user.role}`)}</dd>
          </div>
        </dl>
      </FormSection>
    </SettingsSoonSection>
  );
}
