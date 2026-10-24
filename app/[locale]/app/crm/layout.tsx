import { Suspense, type ReactNode } from 'react';
import type { Metadata } from 'next';
import ClientMessages from '@/components/i18n/ClientMessages';
import CrmObjectsBranch from '@/components/crm/CrmObjectsBranch';
import OfflineSync from '@/components/crm/OfflineSync';
import CallDock from '@/components/crm/CallDock';
import '@/styles/crm.css';
import '@/styles/crm-records.css';
import '@/styles/crm-ai.css';
import CrmAssistant from '@/components/crm/CrmAssistant';
import { CrmViewerProvider } from '@/components/crm/CrmViewer';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import '@/styles/crm-reports.css';

/** Instalable en iOS desde "Agregar a inicio" (el manifest sale de app/manifest.ts). */
export const metadata: Metadata = {
  appleWebApp: { capable: true, title: 'zerosoft CRM', statusBarStyle: 'default' },
};

/** CRM: sus hojas de estilos, los textos de sus componentes cliente, el modo offline y las llamadas desde el navegador. */
export default async function CrmLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await getCurrentUser();
  return (
    <ClientMessages locale={locale} namespaces={['crm']}>
      <Suspense fallback={null}>
        <OfflineSync />
      </Suspense>
      <CrmViewerProvider isAdmin={!!user && isWorkspaceAdmin(user)}>
        <CrmObjectsBranch />
        {props.children}
        <CrmAssistant />
      </CrmViewerProvider>
      <CallDock />
    </ClientMessages>
  );
}
