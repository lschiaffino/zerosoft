import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Formularios del CRM: el editor usa textos comunes de Link. */
export default async function CrmFormsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['link.common']}>
      {props.children}
    </ClientMessages>
  );
}
