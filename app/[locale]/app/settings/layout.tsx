import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { isAdminEmail } from '@/lib/feedback';
import { settingsTabs } from '@/lib/settings-nav';
import PageHeader from '@/components/ui/PageHeader';
import SettingsTabs from '@/components/ui/SettingsTabs';
import '@/styles/settings.css';

/**
 * Ajustes globales: Cuenta (perfil), Workspace (IA, API keys, webhooks,
 * credenciales, datos de Link) y Admin (feedback, roadmap, changelog; solo
 * ADMIN_EMAILS). Cada pestaña es una ruta.
 */
export default async function SettingsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'settings' });
  const isAdmin = isAdminEmail(user.actingUser?.email ?? user.email);
  const items = settingsTabs(isAdmin).map((tab) => ({ ...tab, label: t(`tabs.${tab.key}`) }));

  return (
    <div className="ui-page st-page">
      <PageHeader title={t('title')} description={t('desc')} />
      <SettingsTabs mode="route" layout="top" items={items} label={t('tabs.label')}>
        {props.children}
      </SettingsTabs>
    </div>
  );
}
