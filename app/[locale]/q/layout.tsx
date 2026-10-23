import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Cotización pública: los textos de aceptar o rechazar. */
export default async function PublicQuoteLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm.common', 'crm.errors', 'crm.quotePublic', 'crm.quotes']}>
      {props.children}
    </ClientMessages>
  );
}
