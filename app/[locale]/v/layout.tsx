import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/rec.css';

/** Videos de Rec compartidos por link (/v/<id>) y su versión para insertar (/v/<id>/embed). */
export default async function RecPublicLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['rec']}>
      {props.children}
    </ClientMessages>
  );
}
