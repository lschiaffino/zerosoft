import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { listChatWidgets, listChatConversations } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const widgetIds = widgets.map((w) => w.id);
  if (widgetIds.length === 0) return NextResponse.json({ conversations: [] });

  const widgetId = searchParams.get('widgetId');
  if (widgetId && !widgetIds.includes(widgetId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const targetWidgetId = widgetId ?? widgetIds[0];
  const conversations = await listChatConversations(targetWidgetId, {
    status: searchParams.get('status') ?? undefined,
    assigned: searchParams.get('assigned') ?? undefined,
    q: searchParams.get('q') ?? undefined,
  });

  return NextResponse.json({ conversations });
}
