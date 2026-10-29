import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { actionView } from '@/lib/assistant/engine';
import { assistantUser, owner } from '@/lib/assistant/http';
import { deleteConversation, getConversation, listActions, listMessagesPage, renameConversation } from '@/lib/assistant/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * Una charla con sus mensajes (de a 100, los más nuevos; ?before=<id del
 * mensaje más viejo cargado> trae los anteriores) y el estado de sus acciones.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const who = owner(user);
  const conversation = await getConversation(who, id);
  if (!conversation) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const before = req.nextUrl.searchParams.get('before');
  const { messages, hasMore } = await listMessagesPage(id, { limit: 100, before });
  const ids = messages.flatMap((m) => m.parts.flatMap((p) => (p.type === 'action' ? [p.actionId] : [])));
  const actions = (await listActions(who, ids)).map(actionView);
  return NextResponse.json({ conversation, messages, actions, hasMore });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  const parsed = z.object({ title: z.string().trim().min(1).max(200) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  if (!(await renameConversation(owner(user), id, parsed.data.title))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(await getConversation(owner(user), id));
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await assistantUser();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  if (!(await deleteConversation(owner(user), id))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
