import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PRODUCT_CONFIG, type ProductKey } from '@/lib/products';
import { PRODUCT_SETTINGS_SHORTCUTS, type MinimalSettingsApp } from '@/lib/product-settings';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import PlatformSettingsLink from './PlatformSettingsLink';
import '@/styles/settings.css';

/** Cabecera y pestañas de los ajustes de una app, con el link a los de la plataforma. */
export async function ProductSettingsShell({
  locale,
  product,
  tabs,
  children,
}: {
  locale: string;
  product: ProductKey;
  tabs: Array<{ key: string; label: string }>;
  children: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  const name = PRODUCT_CONFIG[product].name;
  return (
    <div className="ui-page ui-page-narrow st-page">
      <PageHeader
        title={t('title', { app: name })}
        description={t('desc', { app: name })}
        actions={<PlatformSettingsLink locale={locale} />}
      />
      <SettingsTabs mode="query" param="tab" layout="top" label={t('title', { app: name })} items={tabs}>
        {children}
      </SettingsTabs>
    </div>
  );
}

/**
 * Ajustes de una app que todavía no tiene ajustes propios: un estado vacío
 * que lo dice, y atajos a lo que ya existe (importar, credenciales, miembros).
 */
export default async function MinimalProductSettings({ locale, product }: { locale: string; product: MinimalSettingsApp }) {
  const t = await getTranslations({ locale, namespace: 'settings.products' });
  const name = PRODUCT_CONFIG[product].name;
  const shortcuts = PRODUCT_SETTINGS_SHORTCUTS[product];
  return (
    <ProductSettingsShell locale={locale} product={product} tabs={[{ key: 'general', label: t('general') }]}>
      <div className="st-stack">
        <EmptyState
          product={product}
          title={t('emptyTitle', { app: name })}
          body={t('emptyBody')}
          action={{ label: t(`links.${shortcuts[0].label}`), href: shortcuts[0].href }}
        />
        <FormSection title={t('shortcuts')}>
          <ul className="st-links">
            {shortcuts.map((s) => (
              <li key={s.href}>
                <Link href={s.href} className="st-link">
                  {t(`links.${s.label}`)}
                </Link>
              </li>
            ))}
          </ul>
        </FormSection>
      </div>
    </ProductSettingsShell>
  );
}
