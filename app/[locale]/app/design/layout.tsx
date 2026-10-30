import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import DesignBranch from '@/components/design/DesignBranch';
import '@/styles/design.css';

/** Design: inicio, editor, plantillas y kit de marca. Carpetas y recientes cuelgan del sidebar. */
export default async function DesignLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['design']}>
      {props.children}
      <Suspense fallback={null}>
        <DesignBranch />
      </Suspense>
    </ClientMessages>
  );
}
