import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { listChatWidgets, listChatConversations } from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
import WidgetList from '@/components/chat/WidgetList';

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

  const recentConversations = await Promise.all(
    widgets.slice(0, 5).map((w) => listChatConversations([w.id], { status: 'open' })),
  );
  const openConversations = recentConversations.flat();

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('overview.title')}</h1>
          <p className="app-sub muted">{t('overview.subtitle')}</p>
        </div>
        <Link href="/app/chat/widgets/new" className="btn btn-solid btn-small">
          {t('overview.newWidget')}
        </Link>
      </div>

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(widgets.length, locale)}</span>
          <span className="stat-label">{t('overview.widgets')}</span>
        </div>
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(openConversations.length, locale)}</span>
          <span className="stat-label">{t('overview.conversations')}</span>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <p className="section-label">{t('overview.widgets')}</p>
        </div>
        <WidgetList widgets={widgets} />
      </section>
    </div>
  );
}
