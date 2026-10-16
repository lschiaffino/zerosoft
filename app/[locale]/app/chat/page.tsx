import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { realUserId, requireUser } from '@/lib/session';
import {
  countChatConversations,
  listChatConversations,
  listChatWidgets,
  reopenExpiredSnoozesThrottled,
} from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import NewWidgetButton from '@/components/chat/NewWidgetButton';
import ConversationList from '@/components/chat/ConversationList';

export const dynamic = 'force-dynamic';

/**
 * Resumen de Chat: lo que pide respuesta ahora (abiertas, sin asignar, mías)
 * y las últimas conversaciones abiertas. Los widgets viven en su propia lista.
 */
export default async function ChatOverviewPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;

  const user = await requireUser(locale);
  const t = await getTranslations({ locale, namespace: 'chat' });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const widgetIds = widgets.map((w) => w.id);

  if (widgets.length === 0) {
    return (
      <div className="ui-page">
        <PageHeader title={t('overview.title')} description={t('overview.subtitle')} />
        <EmptyState
          title={t('overview.emptyTitle')}
          body={t('overview.emptySub')}
          action={<NewWidgetButton />}
          product="chat"
        />
      </div>
    );
  }

  await reopenExpiredSnoozesThrottled(widgetIds);
  const [openCount, unassignedCount, mineCount, recentOpen] = await Promise.all([
    countChatConversations(widgetIds, { status: 'open' }),
    countChatConversations(widgetIds, { status: 'open', assignedTo: 'unassigned' }),
    countChatConversations(widgetIds, { status: 'open', assignedTo: realUserId(user) }),
    listChatConversations(widgetIds, { status: 'open', limit: 8 }),
  ]);

  const stats = [
    { key: 'open', label: t('overview.openConversations'), value: openCount },
    { key: 'unassigned', label: t('overview.unassignedOpen'), value: unassignedCount },
    { key: 'mine', label: t('overview.mineOpen'), value: mineCount },
  ];

  return (
    <div className="ui-page">
      <PageHeader
        title={t('overview.title')}
        description={t('overview.subtitle')}
        actions={
          <>
            <NewWidgetButton secondary />
            <Link href="/app/chat/inbox" className="btn btn-primary">
              {t('overview.openInbox')}
            </Link>
          </>
        }
      />

      <dl className="chat-counts">
        {stats.map((s) => (
          <div key={s.key} className="chat-count">
            <dt>{s.label}</dt>
            <dd className="data">{formatNumber(s.value, locale)}</dd>
          </div>
        ))}
        <div className="chat-count">
          <dt>{t('overview.widgets')}</dt>
          <dd className="data">
            <Link href="/app/chat/settings">{formatNumber(widgets.length, locale)}</Link>
          </dd>
        </div>
      </dl>

      <section className="chat-pane" aria-labelledby="chat-recent-title">
        <div className="chat-pane-head">
          <h2 id="chat-recent-title" className="ui-section-title">
            {t('overview.recentConversations')}
          </h2>
          {recentOpen.length > 0 && (
            <Link href="/app/chat/inbox" className="chat-more-link">
              {t('overview.seeAll', { count: openCount })}
            </Link>
          )}
        </div>
        <div className="chat-list-panel">
          <ConversationList conversations={recentOpen} emptyTitle={t('overview.noOpen')} />
        </div>
      </section>
    </div>
  );
}
