import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { settingsSectionMetadata } from '@/lib/settings-meta';
import { DESKTOP_NATIVE_SECTIONS } from '@/lib/settings-nav';
import DesktopAppSettings from '@/components/settings/DesktopAppSettings';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await props.params;
  return settingsSectionMetadata(locale, 'desktop');
}

/**
 * Ajustes › App de escritorio. En el navegador: qué es, la descarga y qué
 * ajustes tiene la app. Dentro de la ventana de Ajustes del escritorio esta
 * ruta no se llega a ver: la app intercepta /app/settings/desktop/<sección>
 * y abre la sección nativa.
 */
export default async function DesktopSettingsPage(props: { params: Promise<{ locale: string; tab?: string[] }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings' });
  const sections = DESKTOP_NATIVE_SECTIONS.map((key) => ({ key, label: t(`desktopSections.${key}`), help: t(`desktopApp.sectionHelp.${key}`) }));
  return <DesktopAppSettings sections={sections} />;
}
