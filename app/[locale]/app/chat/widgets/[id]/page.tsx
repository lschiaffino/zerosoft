import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import { countChatConversations, getChatWidget } from '@/lib/chat-data';
import { aiEnabled } from '@/lib/ai';
import { publicOrigin } from '@/components/calendar/event-type-items';
import WidgetSettings from '@/components/chat/WidgetSettings';

export const dynamic = 'force-dynamic';

export default async function EditWidgetPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;

  const user = await requireUser(locale);
  const widget = await getChatWidget(id);
  if (!widget || !canAccessWidget(widget, user)) notFound();

  const origin = publicOrigin((await headers()).get('host'));
  // Para el diálogo de borrar: cuántas conversaciones se van con el widget.
  const conversationCount = await countChatConversations([widget.id]);

  return (
    <WidgetSettings
      widget={widget}
      origin={origin}
      aiAvailable={aiEnabled()}
      conversationCount={conversationCount}
      helpCenterPath={user.handle ? `/${locale}/h/${user.handle}` : null}
    />
  );
}
