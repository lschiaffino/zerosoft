import { cache } from 'react';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getBoard } from '@/lib/boards';
import { boardViewer, getBoardAccess } from '@/lib/board-access';
import BoardEditor from '@/components/board/BoardEditor';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ comment?: string }>;
};

// Una sola lectura de la pizarra (con su escena) por request: la comparten
// generateMetadata y la página.
const loadBoard = cache(async (locale: string, id: string) => {
  const user = await requireUser(locale);
  const access = await getBoardAccess(boardViewer(user), id);
  const board = access ? await getBoard(user.id, id) : null;
  return board && access ? { board, access } : null;
});

export async function generateMetadata(props: Props) {
  const { locale, id } = await props.params;
  const loaded = await loadBoard(locale, id);
  return { title: loaded?.board.name ?? 'Board' };
}

export default async function BoardPage(props: Props) {
  const { locale, id } = await props.params;
  const { comment } = await props.searchParams;
  setRequestLocale(locale);
  const loaded = await loadBoard(locale, id);
  if (!loaded) notFound();
  return (
    <BoardEditor
      board={{ ...loaded.board, my_access: loaded.access }}
      locale={locale}
      commentId={typeof comment === 'string' ? comment : null}
    />
  );
}
