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

export async function generateMetadata(props: Props) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const board = (await getBoardAccess(boardViewer(user), id)) ? await getBoard(user.id, id) : null;
  return { title: board?.name ?? 'Board' };
}

export default async function BoardPage(props: Props) {
  const { locale, id } = await props.params;
  const { comment } = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const access = await getBoardAccess(boardViewer(user), id);
  const board = access ? await getBoard(user.id, id) : null;
  if (!board || !access) notFound();
  return (
    <BoardEditor
      board={{ ...board, my_access: access }}
      locale={locale}
      commentId={typeof comment === 'string' ? comment : null}
    />
  );
}
