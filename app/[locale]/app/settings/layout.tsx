import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { settingsNavGroups } from '@/lib/settings-nav-server';
import { isSettingsEmbed } from '@/lib/settings-embed';
import PageHeader from '@/components/ui/PageHeader';
import PlatformSettingsNav from '@/components/app/PlatformSettingsNav';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/settings.css';

/**
 * Ajustes de la plataforma: nav lateral con cuatro grupos (Cuenta,
 * Workspace, Este dispositivo y Productos), una ruta por sección, y una caja
 * que filtra secciones. La lista sale de lib/settings-nav.ts (la misma que la
 * ventana de Ajustes del escritorio). Dentro de esa ventana la nav la pone el
 * marco embebido (app/[locale]/app/layout.tsx): acá va solo la sección.
 */
export default async function SettingsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings' });
  const embed = isSettingsEmbed((await headers()).get('user-agent'));
  const namespaces = ['settings', 'changelog.admin', 'feedback.admin', 'roadmap', 'link.common', 'common.theme'];

  if (embed) {
    return (
      <ClientMessages locale={locale} namespaces={namespaces}>
        <div className="ui-page st-page st-page-embed">{props.children}</div>
      </ClientMessages>
    );
  }

  const groups = await settingsNavGroups(user, locale);
  return (
    // Admin (changelog, feedback, roadmap) y las secciones movidas usan textos de esas apps.
    <ClientMessages locale={locale} namespaces={namespaces}>
      <div className="ui-page st-page">
        <PageHeader title={t('title')} description={t('desc')} />
        <div className="ui-settings st-layout">
          <PlatformSettingsNav
            groups={groups}
            label={t('tabs.label')}
            selectLabel={t('nav.select')}
            searchLabel={t('nav.search')}
            noResults={t.raw('nav.noResults') as string}
          />
          <div className="ui-settings-content">{props.children}</div>
        </div>
      </div>
    </ClientMessages>
  );
}
