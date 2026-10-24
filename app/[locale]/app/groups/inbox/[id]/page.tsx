import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { loadChatPage } from '@/lib/groups-page';
import ChatThread from '@/components/groups/ChatThread';

export const dynamic = 'force-dynamic';

/** Chat abierto: columnas 2 y 3 de la bandeja (la lista vive en el layout). */
export default async function GroupsChatPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const data = await loadChatPage(user, id);
  if (!data) notFound();
  return <ChatThread key={id} {...data} />;
}
