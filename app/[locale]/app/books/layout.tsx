import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import { requireUser } from '@/lib/session';
import '@/styles/books.css';

/** Books: facturas, compras, bancos, contabilidad e informes. */
export default async function BooksLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  await requireUser(locale);
  return (
    <ClientMessages locale={locale} namespaces={['books']}>
      {props.children}
    </ClientMessages>
  );
}
