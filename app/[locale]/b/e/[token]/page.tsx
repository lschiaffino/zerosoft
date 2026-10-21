import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getGuestBoard } from '@/lib/boards';
import BoardEditor from '@/components/board/BoardEditor';
import '@/styles/board.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; token: string }> };

export async function generateMetadata(props: Props) {
  const { locale, token } = await props.params;
  const guest = await getGuestBoard(token);
  const t = await getTranslations({ locale, namespace: 'board' });
  return { title: guest?.board.name ?? t('public.notFound'), robots: { index: false, follow: false } };
}

/** Link de invitado con edición: el editor sin login (sin comentarios, historial ni taller). */
export default async function GuestBoardPage(props: Props) {
  const { locale, token } = await props.params;
  setRequestLocale(locale);
  const guest = await getGuestBoard(token);
  if (!guest) notFound();
  return (
    <main className="board-public board-guest">
      <BoardEditor board={{ ...guest.board, my_access: 'edit' }} locale={locale} guestToken={token} />
    </main>
  );
}
