import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import { getChatWidget, listChatAgents } from '@/lib/chat-data';
import CannedClient from '@/components/chat/CannedClient';

export const dynamic = 'force-dynamic';

export default async function WidgetCannedPage(
  props: {
    params: Promise<{ locale: string; id: string }>;
  }
) {
  const params = await props.params;

  const {
    locale,
    id
  } = params;

  const user = await requireUser(locale);
  const widget = await getChatWidget(id);

  if (!widget || !await canAccessWidget(widget, user)) {
    notFound();
  }

  const agents = await listChatAgents(widget.user_id, widget.team_id);

  return (
    <CannedClient widgetId={widget.id} agents={agents} />
  );
}
