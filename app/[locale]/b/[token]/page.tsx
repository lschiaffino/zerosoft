import { ogMeta } from '@/lib/og/url';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getSharedBoard } from '@/lib/boards';
import BoardViewer from '@/components/board/BoardViewer';
import '@/styles/board.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const board = await getSharedBoard(token);
  const t = await getTranslations({ locale, namespace: 'board' });
  const title = board?.name ?? t('public.notFound');
  const og = board ? ogMeta(`/api/og/whiteboard/${encodeURIComponent(token)}`, title, undefined, [title]) : null;
  return { title, robots: { index: false, follow: false }, ...(og ? { openGraph: { title, images: og.images }, twitter: og.twitter } : {}) };
}

/** Pizarra compartida por link: solo lectura, sin login. */
export default async function SharedBoardPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const board = await getSharedBoard(token);
  if (!board) notFound();
  const t = await getTranslations({ locale, namespace: 'board' });
  return (
    <main className="board-public">
      <header className="board-public-bar">
        <h1>{board.name}</h1>
        <span className="mono dim">{t('public.viewOnly')}</span>
      </header>
      <BoardViewer scene={board.scene} locale={locale} />
    </main>
  );
}
