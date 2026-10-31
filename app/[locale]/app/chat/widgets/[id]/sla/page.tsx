import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { requireUser } from '@/lib/session';
import {
  CHAT_SLA_PRIORITIES,
  DEFAULT_SLA_FIRST_RESPONSE_MINUTES,
  getChatWidget,
  listSlaPolicies,
} from '@/lib/chat-data';
import SlaClient from '@/components/chat/SlaClient';

export const dynamic = 'force-dynamic';

export default async function WidgetSlaPage(
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
    <SlaClient widgetId={widget.id} initialPolicies={policies} />
  );
}
