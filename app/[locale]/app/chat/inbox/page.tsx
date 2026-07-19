import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets, listChatConversations } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export default async function ChatInboxPage({
  params: { locale },
}: {
  params: { locale: string };
}) {
  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const allConversations = (
    await Promise.all(widgets.map((w) => listChatConversations(w.id)))
  ).flat();

  return (
    <div className="app-page">
      <div className="page-head">
        <h1 className="app-title">{t('sidebar.inbox')}</h1>
      </div>
      <section className="panel">
        {allConversations.length === 0 ? (
          <div className="empty-inline">
            <p className="empty-zeros mono" aria-hidden>0 0 0</p>
            <p className="muted">{t('common.empty')}</p>
          </div>
        ) : (
          <ul className="chat-conversation-list">
            {allConversations.map((c) => (
              <li key={c.id} className="chat-conversation-row panel">
                <span className={`chat-status chat-status-${c.status}`}>{t(`conversation.${c.status}`)}</span>
                <span className="chat-subject">{c.subject ?? c.id.slice(0, 8)}</span>
                <span className="mono muted">{c.priority}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
