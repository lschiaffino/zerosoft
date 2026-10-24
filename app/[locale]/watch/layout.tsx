import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/media.css';

/** Video 1:1 compartido desde el CRM. */
export default async function PublicVideoLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm.mediaPublic']}>
      {props.children}
    </ClientMessages>
  );
}
