import { NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { CHAT_FILTERS, listChats, type ChatFilter } from '@/lib/groups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/v1/groups/chats?filter=&q=&label=&kind=group|dm&limit=&offset= */
export async function GET(req: Request) {
  const auth = await requireApiUser(req, 'groups:read');
  if ('res' in auth) return auth.res;
  const p = new URL(req.url).searchParams;
  const filter = (CHAT_FILTERS as readonly string[]).includes(p.get('filter') ?? '') ? (p.get('filter') as ChatFilter) : 'all';
  const kind = p.get('kind') === 'group' || p.get('kind') === 'dm' ? (p.get('kind') as 'group' | 'dm') : undefined;
  const res = await listChats(auth.user.id, auth.personId, {
    filter,
    q: p.get('q') ?? '',
    labelId: p.get('label') || undefined,
    kind,
    limit: Math.min(100, Number(p.get('limit')) || 50),
    offset: Number(p.get('offset')) || 0,
  });
  return NextResponse.json({ data: res.rows, total: res.total });
}
