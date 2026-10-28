import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listBoards } from '@/lib/boards';
import { boardViewer } from '@/lib/board-access';
import { listBoardFolders } from '@/lib/board-folders';
import BoardList, { type BoardView } from '@/components/board/BoardList';

export const dynamic = 'force-dynamic';

export async function generateMetadata(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: 'board' });
  return { title: t('meta.title') };
}

export default async function BoardsPage(props: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ new?: string; folder?: string; view?: string }>;
}) {
  const { locale } = await props.params;
  const sp = await props.searchParams;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  const viewer = boardViewer(user);
  const [boards, folders] = await Promise.all([listBoards(user.id, viewer), listBoardFolders(user.id, viewer)]);
  const view: BoardView =
    sp.view === 'trash' ? { kind: 'trash' } : sp.folder && folders.some((f) => f.id === sp.folder) ? { kind: 'folder', id: sp.folder } : { kind: 'all' };
  return <BoardList initialBoards={boards} initialFolders={folders} initialView={view} startNew={sp.new === '1'} serverNow={Date.now()} />;
}
