import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Pizarra compartida: los textos del editor de Board. */
export default async function PublicBoardLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['board']}>
      {props.children}
    </ClientMessages>
  );
}
