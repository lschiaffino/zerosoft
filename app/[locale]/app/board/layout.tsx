import type { ReactNode } from 'react';
import BoardBranch from '@/components/board/BoardBranch';

/** Pizarras: la lista vive también en el sidebar del shell, bajo "Pizarras". */
export default function BoardLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <BoardBranch />
    </>
  );
}
