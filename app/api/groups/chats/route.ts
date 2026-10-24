import { NextResponse } from 'next/server';
import { CHAT_FILTERS, listChats, type ChatFilter } from '@/lib/groups';
import { groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Bandeja: chats y grupos con filtros (sin leer, sin responder, míos, etiqueta) y búsqueda en mensajes. */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const p = new URL(req.url).searchParams;
  const filter = (CHAT_FILTERS as readonly string[]).includes(p.get('filter') ?? '') ? (p.get('filter') as ChatFilter) : 'all';
  const kind = p.get('kind') === 'group' || p.get('kind') === 'dm' ? (p.get('kind') as 'group' | 'dm') : undefined;
  const res = await listChats(s.ws, s.me, {
    filter,
    q: p.get('q') ?? '',
    labelId: p.get('label') || undefined,
    numberId: p.get('number') || undefined,
    kind,
    limit: Number(p.get('limit')) || 50,
    offset: Number(p.get('offset')) || 0,
  });
  return NextResponse.json(res);
}
