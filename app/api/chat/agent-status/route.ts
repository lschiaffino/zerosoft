import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { isChatAgentAway, listChatWidgets, setChatAgentAway } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

/** Estado del agente logueado: disponible o ausente. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json({ away: await isChatAgentAway(realUserId(user)) });
}

/**
 * { away: boolean, reassign?: boolean }. Ausente: el round-robin lo saltea;
 * con reassign, sus conversaciones abiertas y pendientes de este workspace
 * pasan a otros agentes disponibles (o quedan sin asignar).
 */
export async function PUT(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { away?: unknown; reassign?: unknown } | null;
  if (typeof body?.away !== 'boolean') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  const widgets = body.away && body.reassign === true ? await listChatWidgets(user.id, user.team?.id ?? null) : [];
  const result = await setChatAgentAway(realUserId(user), body.away, { reassign: body.reassign === true, widgets });
  return NextResponse.json(result);
}
