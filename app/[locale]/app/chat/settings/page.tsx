import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { listChatWidgets } from '@/lib/chat-data';
import { Link } from '@/i18n/navigation';
import WidgetList from '@/components/chat/WidgetList';
import NewWidgetButton from '@/components/chat/NewWidgetButton';

export const dynamic = 'force-dynamic';

export default async function ChatSettingsPage(
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

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('settings.title')}</h1>
          <p className="app-sub muted">{t('settings.subtitle')}</p>
        </div>
        <Link href="/app/chat/reports" className="btn btn-small">
          {t('reports.title')} →
        </Link>
      </div>

      <section className="chat-section">
        <div className="chat-section-head">
          <p className="section-label">{t('overview.widgets')}</p>
        </div>
        <p className="muted chat-section-sub chat-stats-note">{t('settings.widgetsNote')}</p>
        {widgets.length > 0 ? (
          <WidgetList widgets={widgets} />
        ) : (
          <NewWidgetButton shortcut={false} />
        )}
      </section>
    </div>
  );
}
