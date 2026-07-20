import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireUser } from '@/lib/session';
import {
  CHAT_SLA_PRIORITIES,
  DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
  getChatWidget,
  listSlaPolicies,
} from '@/lib/chat-data';
import SlaClient from '@/components/chat/SlaClient';

export const dynamic = 'force-dynamic';

export default async function WidgetSlaPage({
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

  const rows = await listSlaPolicies(widget.id);
  const policies = CHAT_SLA_PRIORITIES.map((priority) => {
    const row = rows.find((r) => r.priority === priority && r.active === 1);
    return {
      priority,
      firstResponseMinutes: row?.first_response_minutes ?? DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
      resolutionMinutes: row?.resolution_minutes ?? null,
      isDefault: !row,
    };
  });

  return (
    <div className="app-page">
      <div className="page-head">
        <div>
          <h1 className="app-title">{t('sla.policies')}</h1>
          <p className="app-sub muted">{widget.name}</p>
        </div>
      </div>
      <SlaClient widgetId={widget.id} initialPolicies={policies} />
    </div>
  );
}
