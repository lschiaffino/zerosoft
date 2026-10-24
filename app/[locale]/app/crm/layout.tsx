import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import '@/styles/crm.css';
import '@/styles/crm-records.css';
import '@/styles/crm-reports.css';

/** CRM: sus hojas de estilos y los textos de sus componentes cliente. */
export default async function CrmLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm']}>
      {props.children}
    </ClientMessages>
  );
}
