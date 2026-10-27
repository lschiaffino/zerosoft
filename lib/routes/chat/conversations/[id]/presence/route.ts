import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessConversation } from '@/lib/chat-access';
import { leavePresence, listPresence, touchPresence } from '@/lib/chat-collab';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Quién más tiene abierta la conversación (y si está escribiendo una respuesta). */
export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ others: await listPresence(id, realUserId(user)) });
}

/** Latido { typing }: devuelve a los demás, así el cliente hace un solo pedido por poll. */
export async function POST(req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { typing?: unknown };
  const me = realUserId(user);
  await touchPresence(id, me, body.typing === true);
  return NextResponse.json({ others: await listPresence(id, me) });
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!(await canAccessConversation(id, user)).ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await leavePresence(id, realUserId(user));
  return NextResponse.json({ ok: true });
}
