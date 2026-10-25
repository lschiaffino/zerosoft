import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { SETTINGS_ELSEWHERE, type SettingsSectionKey } from '@/lib/settings-nav';
import SettingsSoon from './SettingsSoon';

/** Sección de Ajustes sin contenido propio todavía, con sus textos (settings.soon.<key>) y los links de SETTINGS_ELSEWHERE. */
export default async function SettingsSoonSection({
  locale,
  section,
  children,
}: {
  locale: string;
  section: SettingsSectionKey;
  children?: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'settings.soon' });
  const links = (SETTINGS_ELSEWHERE[section] ?? []).map((l) => ({ href: l.href, label: t(`${section}.${l.label}`) }));
  return (
    <SettingsSoon
      title={t(`${section}.title`)}
      description={t(`${section}.desc`)}
      empty={t(`${section}.empty`)}
      whereLabel={t('whereToday')}
      links={links}
    >
      {children}
    </SettingsSoon>
  );
}
