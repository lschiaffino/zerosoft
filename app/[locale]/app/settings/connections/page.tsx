import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listCredentials } from '@/lib/flow-credentials';
import { canEditFlows } from '@/lib/flow-http';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import CredentialsSummary from '@/components/app/CredentialsSummary';
import SettingsSoon from '@/components/app/SettingsSoon';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'connections');
}

/**
 * Ajustes › Conexiones: las credenciales de Flow (antes en /app/settings/workspace)
 * y dónde se conecta hoy cada cuenta externa (Google, Gmail, WhatsApp, GitHub).
 */
export default async function ConnectionsSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.soon' });
  const credentials = await listCredentials(user.id);
  return (
    <SettingsSoon
      title={t('connections.title')}
      description={t('connections.desc')}
      empty={t('connections.empty')}
      whereLabel={t('whereToday')}
      links={[
        { href: '/app/calendar/settings?tab=connections', label: t('connections.google') },
        { href: '/app/crm/settings?tab=integrations', label: t('connections.gmail') },
        { href: '/app/groups/settings?tab=numbers', label: t('connections.whatsapp') },
        { href: '/app/track/settings?tab=github', label: t('connections.github') },
      ]}
    >
      <CredentialsSummary credentials={credentials} canEdit={canEditFlows(user)} locale={locale} />
    </SettingsSoon>
  );
}
