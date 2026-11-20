import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import AppTour from '@/components/tour/AppTour';
import '@/styles/docs.css';
import '@/styles/notes.css';
import '@/styles/notes-parity.css';

/** Notes usa el editor de bloques de Docs: trae su hoja y sus textos además de los propios. */
export default async function NotesLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['notes', 'docs']}>
      {props.children}
      {/* Tour guiado de Notes (lib/tours/notes.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="notes" />
      </Suspense>
    </ClientMessages>
  );
}
