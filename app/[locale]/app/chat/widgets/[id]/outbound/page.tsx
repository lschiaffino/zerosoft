import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { canAccessWidget } from '@/lib/chat-access';
import { isWorkspaceAdmin, requireUser } from '@/lib/session';
import { getChatWidget } from '@/lib/chat-data';
import OutboundClient from '@/components/chat/OutboundClient';

export const dynamic = 'force-dynamic';

/** Mensajes salientes y encuestas del widget. */
export default async function WidgetOutboundPage(props: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await props.params;
  const user = await requireUser(locale);
  const widget = await getChatWidget(id);
  if (!widget || !canAccessWidget(widget, user)) notFound();
  return (
    <Suspense fallback={null}>
      <OutboundClient widgetId={widget.id} canManage={isWorkspaceAdmin(user)} />
    </Suspense>
  );
}
