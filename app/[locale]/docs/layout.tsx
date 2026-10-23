import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Documentación de la API: los textos de los ejemplos de código. */
export default async function ApiDocsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['pages.docs']}>
      {props.children}
    </ClientMessages>
  );
}
