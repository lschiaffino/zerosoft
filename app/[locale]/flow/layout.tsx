import type { ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';

/** Páginas públicas de Flow (aprobación de un paso, formulario hospedado): solo sus textos. */
export default async function FlowApprovalLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['flow.approvalPage', 'flow.formPage']}>
      {props.children}
    </ClientMessages>
  );
}
