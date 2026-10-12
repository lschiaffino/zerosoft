import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import { getChatWidget, listChatAgents } from '@/lib/chat-data';
import RulesClient from '@/components/chat/RulesClient';

export const dynamic = 'force-dynamic';

export default async function WidgetRulesPage(
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

  const agents = await listChatAgents(widget.user_id, widget.team_id);

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('rules.title')}</h1>
          <p className="app-sub muted">{widget.name}</p>
        </div>
      </div>
      <RulesClient widgetId={widget.id} agents={agents} />
    </div>
  );
}
