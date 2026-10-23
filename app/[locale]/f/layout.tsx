import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Formulario público del CRM: solo sus textos. */
export default async function PublicFormLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm.formsPublic']}>
      {props.children}
    </ClientMessages>
  );
}
