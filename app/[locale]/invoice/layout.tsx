import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/books.css';

/** Factura pública de Books (/invoice/<token>): los textos de pagar e imprimir. */
export default async function PublicInvoiceLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['books.public', 'books.errors']}>
      {props.children}
    </ClientMessages>
  );
}
