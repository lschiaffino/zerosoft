import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/session';
import { getChatWidget, listChatConversations } from '@/lib/chat-data';
import { formatNumber } from '@/lib/utils';
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

      <nav className="chat-widget-nav">
        <Link href={`/app/chat/widgets/${widget.id}`} className="chat-widget-nav-link active">
          {t('widgetForm.editTitle')}
        </Link>
        <Link href={`/app/chat/widgets/${widget.id}/rules`} className="chat-widget-nav-link">
          {t('rules.title')}
        </Link>
        <Link href={`/app/chat/widgets/${widget.id}/canned`} className="chat-widget-nav-link">
          {t('canned.title')}
        </Link>
        <Link href={`/app/chat/widgets/${widget.id}/sla`} className="chat-widget-nav-link">
          {t('sla.policies')}
        </Link>
      </nav>

      <div className="stat-cards">
        <div className="panel stat-card">
          <span className="stat-num">{formatNumber(conversations.length, locale)}</span>
          <span className="stat-label">{t('overview.conversations')}</span>
        </div>
      </div>

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
