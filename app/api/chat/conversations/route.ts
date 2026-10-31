import { NextResponse } from 'next/server';
import { listAccessibleChatWidgets } from '@/lib/chat-access';
import { getCurrentUser, realUserId } from '@/lib/session';
import {
  listChatConversations,
  countChatConversations,
  reopenExpiredSnoozesThrottled,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

function parseWidgetIds(param: string | null, ownedIds: string[]): string[] {
  if (!param) return ownedIds;
  const requested = param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const set = new Set(requested.length > 0 ? requested : ownedIds);
  return ownedIds.filter((id) => set.has(id));
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const widgets = await listAccessibleChatWidgets(user);
  const ownedIds = widgets.map((w) => w.id);
  const widgetIds = parseWidgetIds(searchParams.get('widgetIds'), ownedIds);

  if (widgetIds.length === 0) {
    return NextResponse.json({ rows: [], total: 0 });
  }

  const status = searchParams.get('status') ?? undefined;
  const assignedTo = searchParams.get('assignedTo') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const tag = searchParams.get('tag') ?? undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

  const pick = (k: string, allowed?: string[]) => {
    const v = searchParams.get(k)?.trim();
    if (!v) return undefined;
    return allowed && !allowed.includes(v) ? undefined : v.slice(0, 64);
  };
  const options = {
    status,
    assignedTo: assignedTo as 'unassigned' | string | undefined,
    tag,
    q,
    teamId: pick('teamId'),
    priority: pick('priority', ['low', 'medium', 'high', 'urgent']),
    channel: pick('channel', ['web', 'email']),
    followedBy: searchParams.get('following') === '1' ? realUserId(user) : undefined,
    limit,
    offset,
  };

  // Antes de listar y contar: si no, el total podía no incluir una conversación recién reabierta.
  await reopenExpiredSnoozesThrottled(widgetIds);
  const [rows, total] = await Promise.all([
    listChatConversations(widgetIds, options),
    countChatConversations(widgetIds, options),
  ]);

  return NextResponse.json({ rows, total });
}
