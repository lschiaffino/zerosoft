import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { SettingsSectionKey } from './settings-nav';

/** <title> de una sección de Ajustes: "Miembros · Ajustes". */
export async function settingsSectionMetadata(locale: string, key: SettingsSectionKey): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: 'settings' });
  return { title: `${t(`sections.${key}`)} · ${t('title')}` };
}
