import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/media.css';

/** Documento compartido desde el CRM (link de seguimiento). */
export default async function PublicDocumentLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm.mediaPublic']}>
      {props.children}
    </ClientMessages>
  );
}
