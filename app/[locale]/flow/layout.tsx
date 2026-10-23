import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Aprobación pública de un paso de Flow: solo sus textos. */
export default async function FlowApprovalLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['flow.approvalPage']}>
      {props.children}
    </ClientMessages>
  );
}
