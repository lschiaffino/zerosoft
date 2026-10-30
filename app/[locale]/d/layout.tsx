import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/design.css';

/** Diseños compartidos con link (/d/<token>): solo lectura. */
export default async function DesignPublicLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['design']}>
      {props.children}
    </ClientMessages>
  );
}
