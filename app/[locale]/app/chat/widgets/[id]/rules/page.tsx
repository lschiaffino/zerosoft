import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import { getChatWidget, listChatAgents, parseOfficeHours } from '@/lib/chat-data';
import RulesClient from '@/components/chat/RulesClient';
import { listChatTeams } from '@/lib/chat-collab';

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
  const widget = await getChatWidget(id);

  if (!widget || !await canAccessWidget(widget, user)) {
    notFound();
  }

  const agents = await listChatAgents(widget.user_id, widget.team_id);
  const teams = (await listChatTeams(widget.user_id)).map((x) => ({ id: x.id, name: x.name }));

  return (
    <RulesClient
      widgetId={widget.id}
      agents={agents}
      teams={teams}
      timeZone={parseOfficeHours(widget.office_hours)?.timezone ?? 'UTC'}
    />
  );
}
