import { NextResponse } from 'next/server';
import { apiError, requireApiUser } from '@/lib/api-auth';
import { countChatConversations, listChatConversations } from '@/lib/chat-data';
import { toApiConversation } from '@/lib/chat-api';
import { apiWidgetIds } from '@/lib/chat-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'pending', 'snoozed', 'resolved'] as const;

/** Conversaciones del inbox (más recientes primero). Filtros: status, assignedTo, widgetId. */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'chat:read');
  if ('res' in auth) return auth.res;
  const sp = new URL(req.url).searchParams;
  const status = sp.get('status');
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    return apiError(400, 'invalid_input', 'status must be open, pending, snoozed or resolved.');
  }
  let widgetIds = await apiWidgetIds(auth);
  const widgetId = sp.get('widgetId');
  if (widgetId) widgetIds = widgetIds.filter((id) => id === widgetId);
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 50, 1), 200);
  const offset = Math.max(Number(sp.get('offset')) || 0, 0);
  const options = {
    status: (status as (typeof STATUSES)[number] | null) ?? undefined,
    assignedTo: sp.get('assignedTo') || undefined,
  };
  const [rows, total] = await Promise.all([
    listChatConversations(widgetIds, { ...options, limit, offset }),
    countChatConversations(widgetIds, options),
  ]);
  return NextResponse.json({ conversations: rows.map(toApiConversation), total, limit, offset });
}
