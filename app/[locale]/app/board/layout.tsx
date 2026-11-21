import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import BoardBranch from '@/components/board/BoardBranch';
import AppTour from '@/components/tour/AppTour';
import '@/styles/board.css';

/** Pizarras: la lista vive también en el sidebar del shell, bajo "Pizarras". */
export default async function BoardLayout(props: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  return (
    <ClientMessages locale={locale} namespaces={['board']}>
      {props.children}
      <Suspense fallback={null}>
        <BoardBranch />
      </Suspense>
      {/* Tour guiado de Board (lib/tours/board.ts): la primera vez, y desde el menú de la cuenta. */}
      <Suspense fallback={null}>
        <AppTour tour="board" />
      </Suspense>
    </ClientMessages>
  );
}
