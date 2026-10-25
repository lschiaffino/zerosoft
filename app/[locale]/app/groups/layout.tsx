import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import ClientMessages from '@/components/i18n/ClientMessages';
import GroupsListsBranch from '@/components/groups/GroupsListsBranch';
import GroupsPwa from '@/components/groups/GroupsPwa';
import '@/styles/groups.css';

/** Instalable en iOS desde "Agregar a inicio" (el manifest de la suite sale de app/manifest.ts). */
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'zerosoft', statusBarStyle: 'default' },
};

/**
 * Groups: su hoja de estilos, los textos de sus componentes cliente, las
 * listas guardadas en el sidebar y el registro del service worker de la suite
 * (push y app instalable).
 */
export default async function GroupsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['groups']}>
      <Suspense fallback={null}>
        <GroupsListsBranch />
      </Suspense>
      <GroupsPwa />
      {props.children}
    </ClientMessages>
  );
}
