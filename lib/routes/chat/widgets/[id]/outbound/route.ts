import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { recordChatAudit } from '@/lib/chat-audit';
import { canAccessWidget } from '@/lib/chat-access';
import { getChatWidget } from '@/lib/chat-data';
import { createOutbound, listOutbound } from '@/lib/chat-outbound';
import { collabError } from '@/lib/chat-http';
import { limitWrites } from '@/lib/write-limit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Mensajes salientes y encuestas del widget, con vistas, respuestas y promedio. */
export async function GET(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(id);
  if (!canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ messages: await listOutbound(id) });
}

/** { name, kind?, body?, urlMatch?, urlValue?, delaySeconds?, audience?, active? } */
export async function POST(req: Request, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(id);
  if (!canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  // Lo que se muestra en el sitio de todos los visitantes: solo admins.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const limited = await limitWrites('chat', realUserId(user));
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    const created = await createOutbound(id, realUserId(user), body);
    await recordChatAudit(user.id, realUserId(user), 'outbound.created', { id: created.id, widget: id, name: created.name, active: created.active });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}
