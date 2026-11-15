import { setRequestLocale } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { boardViewer } from '@/lib/board-access';
import LocalBoard from '@/components/board/LocalBoard';

export const dynamic = 'force-dynamic';

/**
 * Pizarra creada sin red (/app/board/local?id=<uuid>). La página no trae datos
 * de ninguna pizarra: el service worker la guarda una vez y la sirve sin red
 * para cualquier id (el id se lee en el navegador). Con red, la sube y abre la
 * pizarra de verdad.
 */
export default async function LocalBoardPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const user = await requireUser(locale);
  return <LocalBoard locale={locale} meId={boardViewer(user).personId} />;
}
