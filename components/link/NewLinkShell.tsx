import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import { NEW_LINK_ROUTES } from '@/lib/link-detail-tabs';

/**
 * La única entrada para crear links: "Nuevo" con tres pestañas (un link, en
 * lote, importar desde Bitly). Cada pestaña es su propia ruta, así los links
 * viejos a /app/links/bulk siguen andando.
 */
export default async function NewLinkShell({ locale, children }: { locale: string; children: ReactNode }) {
  const t = await getTranslations({ locale, namespace: 'link' });
  return (
    <div className="ui-page ui-page-narrow link-new">
      <PageHeader back={{ href: '/app/links', label: t('detail.back') }} title={t('new.title')} description={t('new.sub')} />
      <SettingsTabs
        mode="route"
        layout="top"
        label={t('new.tabsLabel')}
        items={[
          { key: 'single', label: t('new.tabs.single'), href: NEW_LINK_ROUTES.single },
          { key: 'bulk', label: t('new.tabs.bulk'), href: NEW_LINK_ROUTES.bulk },
          { key: 'import', label: t('new.tabs.import'), href: NEW_LINK_ROUTES.import },
        ]}
      >
        {children}
      </SettingsTabs>
    </div>
  );
}
