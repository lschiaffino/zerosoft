import { NextResponse } from 'next/server';
import { listAssignments } from '@/lib/groups-assignments';
import { chatGuard, groupsError, groupsSession } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Historial de asignaciones de un chat: ?chat=<id>. Quién lo tenía, a quién
 * pasó, quién lo hizo, cuándo y por qué (manual, regla automática o
 * reasignación porque alguien se desconectó). 404 si el chat no es del
 * workspace o la persona no lo ve.
 */
export async function GET(req: Request) {
  const s = await groupsSession();
  if (s instanceof NextResponse) return s;
  const chatId = new URL(req.url).searchParams.get('chat') ?? '';
  if (!/^[\w-]{1,80}$/.test(chatId)) return groupsError(400, 'invalid_chat');
  const guard = await chatGuard(s, chatId);
  if (guard instanceof NextResponse) return guard;
  return NextResponse.json({ events: await listAssignments(s.ws, chatId) }, { headers: { 'cache-control': 'private, no-store' } });
}
