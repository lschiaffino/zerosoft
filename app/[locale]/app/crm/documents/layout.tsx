import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Documentos del CRM: el botón de copiar usa textos comunes de Link. */
export default async function CrmDocumentsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['link.common']}>
      {props.children}
    </ClientMessages>
  );
}
