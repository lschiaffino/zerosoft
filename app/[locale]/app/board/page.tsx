import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listBoards } from '@/lib/boards';
import { boardViewer } from '@/lib/board-access';
import BoardList from '@/components/board/BoardList';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'board' });
  return { title: t('meta.title') };
}

export default async function BoardsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const boards = await listBoards(user.id, boardViewer(user));
  return <BoardList initialBoards={boards} startNew={sp.new === '1'} serverNow={Date.now()} />;
}
