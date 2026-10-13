import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getBoard } from '@/lib/boards';
import BoardEditor from '@/components/board/BoardEditor';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata(props: Props) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const board = await getBoard(user.id, id);
  return { title: board?.name ?? 'Board' };
}

export default async function BoardPage(props: Props) {
  const { locale, id } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const board = await getBoard(user.id, id);
  if (!board) notFound();
  return <BoardEditor board={board} locale={locale} />;
}
