import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { countChatConversations, getChatWidget } from '@/lib/chat-data';
import WidgetHeader from '@/components/chat/WidgetHeader';
import WidgetForm from '@/components/chat/WidgetForm';
import { aiEnabled } from '@/lib/ai';
import EmbedCode from '@/components/chat/EmbedCode';

export const dynamic = 'force-dynamic';

export default async function EditWidgetPage(
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

  if (!widget || (widget.user_id !== user.id && widget.team_id !== user.team?.id)) {
    notFound();
  }

  const conversations = await countChatConversations([widget.id]);

  return (
    <div className="app-page">
      <WidgetHeader locale={locale} widget={widget} active="settings" conversations={conversations} />

      <div className="chat-edit-grid">
        <div className="chat-edit-form">
          <WidgetForm initial={widget} aiAvailable={aiEnabled()} />
        </div>
        <div className="chat-edit-side">
          <EmbedCode widgetId={widget.id} />
        </div>
      </div>
    </div>
  );
}
