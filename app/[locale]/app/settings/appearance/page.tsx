import type { Metadata } from 'next';
import { realUserId, requireUser } from '@/lib/session';
import { getTours } from '@/lib/tours/server';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import AppearanceSettings from '@/components/settings/AppearanceSettings';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'appearance');
}

/** Ajustes › Apariencia: el modo de color, el aspecto y los tours guiados (el idioma vive en Perfil). */
export default async function AppearanceSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const tours = await getTours(realUserId(user)).catch(() => ({ off: false }));
  return <AppearanceSettings toursOff={Boolean(tours.off)} />;
}
