import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import {
  countChatConversations,
  listChatConversations,
  listChatWidgets,
  reopenExpiredSnoozesThrottled,
} from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
import WidgetList from '@/components/chat/WidgetList';
import NewWidgetButton from '@/components/chat/NewWidgetButton';
import ConversationList from '@/components/chat/ConversationList';

export const dynamic = 'force-dynamic';

export default async function ChatOverviewPage(
  props: {
    params: Promise<{ locale: string }>;
  }
) {
  const params = await props.params;

  const {
    locale
  } = params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const widgetIds = widgets.map((w) => w.id);

  await reopenExpiredSnoozesThrottled(widgetIds);
  // Antes contaba solo las conversaciones abiertas de los primeros 5 widgets.
  const [openCount, unassignedCount, recentOpen] = await Promise.all([
    countChatConversations(widgetIds, { status: 'open' }),
    countChatConversations(widgetIds, { status: 'open', assignedTo: 'unassigned' }),
    listChatConversations(widgetIds, { status: 'open', limit: 5 }),
  ]);

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('overview.title')}</h1>
          <p className="app-sub muted">{t('overview.subtitle')}</p>
        </div>
        {widgets.length > 0 && <NewWidgetButton />}
      </div>

      {widgets.length === 0 ? (
        <div className="empty-state">
          <p className="empty-zeros mono" aria-hidden>
            0 0 0
          </p>
          <h2>{t('overview.emptyTitle')}</h2>
          <p className="muted">{t('overview.emptySub')}</p>
          <NewWidgetButton />
        </div>
      ) : (
        <>
          <div className="chat-stats">
            <Link href="/app/chat/inbox" className="chat-stat">
              <span className="chat-stat-num">{formatNumber(openCount, locale)}</span>
              <span className="chat-stat-label mono">{t('overview.openConversations')}</span>
            </Link>
            <Link href="/app/chat/inbox" className="chat-stat">
              <span className="chat-stat-num">{formatNumber(unassignedCount, locale)}</span>
              <span className="chat-stat-label mono">{t('inbox.filters.unassigned')}</span>
            </Link>
            <div className="chat-stat">
              <span className="chat-stat-num">{formatNumber(widgets.length, locale)}</span>
              <span className="chat-stat-label mono">{t('overview.widgets')}</span>
            </div>
          </div>

          <section className="chat-section">
            <div className="chat-section-head">
              <p className="section-label">{t('overview.recentConversations')}</p>
              <Link href="/app/chat/inbox" className="chat-section-link mono">
                {t('overview.openInbox')} →
              </Link>
            </div>
            <ConversationList conversations={recentOpen} emptyTitle={t('overview.noOpen')} />
          </section>

          <section className="chat-section">
            <div className="chat-section-head">
              <p className="section-label">{t('overview.widgets')}</p>
            </div>
            <WidgetList widgets={widgets} />
          </section>
        </>
      )}
    </div>
  );
}
