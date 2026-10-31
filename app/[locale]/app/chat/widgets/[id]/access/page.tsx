import { notFound } from 'next/navigation';
import { canAccessWidget, listWidgetAccess } from '@/lib/chat-access';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getChatWidget, listChatAgents } from '@/lib/chat-data';
import WidgetAccessClient from '@/components/chat/WidgetAccessClient';

export const dynamic = 'force-dynamic';

export default async function WidgetAccessPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const widget = await getChatWidget(id);
  if (!widget || !(await canAccessWidget(widget, user))) notFound();
  const [agents, members] = await Promise.all([listChatAgents(user.id, user.team?.id ?? null), listWidgetAccess(widget.id)]);
  return (
    <WidgetAccessClient
      widgetId={widget.id}
      agents={agents}
      initialRestricted={Number(widget.restricted ?? 0) === 1}
      initialMembers={members}
      canManage={isWorkspaceAdmin(user)}
    />
  );
}
