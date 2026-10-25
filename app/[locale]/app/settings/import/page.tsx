import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import SettingsSoonSection from '@/components/app/SettingsSoonSection';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'import');
}

/** Ajustes › Importar. Hasta que esté el hub, lleva al importador de cada app. */
export default async function ImportSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <SettingsSoonSection locale={locale} section="import" />;
}
