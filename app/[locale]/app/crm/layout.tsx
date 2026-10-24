import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import CrmObjectsBranch from '@/components/crm/CrmObjectsBranch';
import '@/styles/crm.css';
import '@/styles/crm-records.css';
import '@/styles/crm-ai.css';
import CrmAssistant from '@/components/crm/CrmAssistant';

/** CRM: sus hojas de estilos y los textos de sus componentes cliente. */
export default async function CrmLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['crm']}>
      <CrmObjectsBranch />
      {props.children}
      <CrmAssistant />
    </ClientMessages>
  );
}
