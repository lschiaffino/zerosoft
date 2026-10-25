import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import GroupsListsBranch from '@/components/groups/GroupsListsBranch';
import '@/styles/groups.css';

/** Groups: su hoja de estilos, los textos de sus componentes cliente y las listas guardadas en el sidebar. */
export default async function GroupsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['groups']}>
      <Suspense fallback={null}>
        <GroupsListsBranch />
      </Suspense>
      {props.children}
    </ClientMessages>
  );
}
