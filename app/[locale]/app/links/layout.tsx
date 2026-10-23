import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Link: los textos de sus componentes cliente (link.css es común a toda la app). */
export default async function LinksLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['link']}>
      {props.children}
    </ClientMessages>
  );
}
