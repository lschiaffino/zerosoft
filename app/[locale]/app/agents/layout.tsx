import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import '@/styles/agents.css';

/** Agents: su hoja de estilos, los textos de sus componentes cliente y el tour guiado. */
export default async function AgentsLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['agents']}>
      {props.children}
      {/* Tour guiado de Agents (lib/tours/agents.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="agents" />
      </Suspense>
    </ClientMessages>
  );
}
