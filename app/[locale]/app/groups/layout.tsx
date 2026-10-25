import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import ClientMessages from '@/components/i18n/ClientMessages';
import GroupsPwa from '@/components/groups/GroupsPwa';
import '@/styles/groups.css';

/** App instalable (PWA): manifiesto propio de Groups, ícono y modo app en iOS. */
export const metadata: Metadata = {
  manifest: '/groups.webmanifest',
  appleWebApp: { capable: true, title: 'Groups', statusBarStyle: 'black-translucent' },
  icons: { apple: '/api/groups/pwa-icon?size=192' },
};

/** Groups: su hoja de estilos, los textos de sus componentes cliente y el service worker de la app. */
export default async function GroupsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['groups']}>
      <GroupsPwa />
      {props.children}
    </ClientMessages>
  );
}
