import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import AiUsagePanel from '@/components/app/AiUsagePanel';
import SettingsSoon from '@/components/app/SettingsSoon';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'billing');
}

/** Ajustes › Plan y uso: el consumo de IA del mes (antes en /app/settings/workspace). */
export default async function BillingSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings.soon.billing' });
  return (
    <SettingsSoon title={t('title')} description={t('desc')} empty={t('empty')}>
      <AiUsagePanel workspaceId={user.id} locale={locale} />
    </SettingsSoon>
  );
}
