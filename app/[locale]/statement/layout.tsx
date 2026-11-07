import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/books.css';

/** Vista pública de Books sin login: textos de la acción y de los errores. */
export default async function Layout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['books.public', 'books.errors']}>
      {props.children}
    </ClientMessages>
  );
}
