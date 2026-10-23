import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Chat público de un agente: los textos del chat de Agents. */
export default async function PublicAgentLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['agents']}>
      {props.children}
    </ClientMessages>
  );
}
