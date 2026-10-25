import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { settingsSections } from '@/lib/settings-nav';
import { PRODUCT_CONFIG } from '@/lib/products';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsNav from '@/components/app/PlatformSettingsNav';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/settings.css';

/**
 * Ajustes de la plataforma: nav lateral con dos grupos. "Cuenta y workspace"
 * (perfil, workspace, miembros, equipos, plan y uso, API, conexiones,
 * importar, seguridad, avisos y Admin para ADMIN_EMAILS), una ruta por
 * sección; "Productos" lleva a los ajustes de cada app (/app/<app>/settings).
 */
export default async function SettingsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings' });
  const isAdmin = isAdminEmail(user.actingUser?.email ?? user.email);
  const groups = settingsSections(isAdmin).map((g) => ({
    key: g.key,
    label: t(`groups.${g.key}`),
    items: g.items.map((i) => ({
      key: i.key,
      href: i.href,
      match: i.match,
      product: i.product,
      label: i.product ? PRODUCT_CONFIG[i.product].name : t(`sections.${i.key}`),
    })),
  }));

  return (
    // Admin (changelog, feedback, roadmap) y las secciones movidas usan textos de esas apps.
    <ClientMessages locale={locale} namespaces={['settings', 'changelog.admin', 'feedback.admin', 'roadmap', 'link.common']}>
      <div className="ui-page st-page">
        <PageHeader title={t('title')} description={t('desc')} />
        <div className="ui-settings st-layout">
          <PlatformSettingsNav groups={groups} label={t('tabs.label')} selectLabel={t('nav.select')} />
          <div className="ui-settings-content">{props.children}</div>
        </div>
      </div>
    </ClientMessages>
  );
}
