import type { Metadata } from 'next';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import AppearanceSettings from '@/components/settings/AppearanceSettings';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'appearance');
}

/** Ajustes › Apariencia: el modo de color (el idioma vive en Perfil). */
export default async function AppearanceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return <AppearanceSettings />;
}
