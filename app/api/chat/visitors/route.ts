import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { countChatVisitors, listChatVisitors, listChatWidgets } from '@/lib/chat-data';

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
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  const ownedIds = widgets.map((w) => w.id);
  const widgetIds = parseWidgetIds(searchParams.get('widgetIds'), ownedIds);

  if (widgetIds.length === 0) {
    return NextResponse.json({ rows: [], total: 0 });
  }

  const q = searchParams.get('q') ?? undefined;
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 200);
  const offset = Math.max(parseInt(searchParams.get('offset') ?? '0', 10), 0);

  const options = { q, limit, offset };

  const [rows, total] = await Promise.all([
    listChatVisitors(widgetIds, options),
    countChatVisitors(widgetIds, options),
  ]);

  return NextResponse.json({ rows, total });
}
