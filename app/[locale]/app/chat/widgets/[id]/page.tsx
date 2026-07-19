import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChatWidget, listChatConversations } from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
import WidgetForm from '@/components/chat/WidgetForm';
import EmbedCode from '@/components/chat/EmbedCode';

export const dynamic = 'force-dynamic';

export default async function EditWidgetPage({
  params: { locale, id },
}: {
  params: { locale: string; id: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widget = await getChatWidget(id);

  if (!widget || (widget.user_id !== user.id && widget.team_id !== user.team?.id)) {
    notFound();
  }

  const conversations = await listChatConversations([widget.id]);

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('widgetForm.editTitle')}</h1>
          <p className="app-sub muted">{widget.name}</p>
        </div>
      </div>

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(conversations.length, locale)}</span>
          <span className="stat-label">{t('overview.conversations')}</span>
        </div>
      </div>

      <div className="chat-edit-grid">
        <div className="chat-edit-form">
          <WidgetForm initial={widget} />
        </div>
        <div className="chat-edit-side">
          <EmbedCode widgetId={widget.id} />
        </div>
      </div>
    </div>
  );
}
