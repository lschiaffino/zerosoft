import { requireUser } from '@/lib/session';
import WidgetsIndex from '@/components/chat/WidgetsIndex';

export const dynamic = 'force-dynamic';

/** "Widgets" en el sidebar de Chat: la lista de widgets (ruta canónica). */
export default async function ChatWidgetsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  const user = await requireUser(locale);
  return <WidgetsIndex locale={locale} userId={user.id} teamId={user.team?.id ?? null} />;
}
