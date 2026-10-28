import { Suspense, type ReactNode } from 'react';
import ClientMessages from '@/components/i18n/ClientMessages';
import BoardBranch from '@/components/board/BoardBranch';
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
    </ClientMessages>
  );
}
