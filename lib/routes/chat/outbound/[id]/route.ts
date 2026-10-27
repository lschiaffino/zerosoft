import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canAccessWidget } from '@/lib/chat-access';
import { getChatWidget } from '@/lib/chat-data';
import { deleteOutbound, getOutbound, listOutboundResponses, updateOutbound } from '@/lib/chat-outbound';
import { collabError } from '@/lib/chat-http';
import { limitWrites } from '@/lib/write-limit';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function guard(id: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const message = await getOutbound(id);
  const widget = message ? await getChatWidget(message.widget_id) : undefined;
  if (!message || !canAccessWidget(widget, user)) return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  return { user, message };
}

/** El mensaje con sus últimas respuestas (encuestas). */
export async function GET(_req: Request, props: Ctx) {
  const g = await guard((await props.params).id);
  if (g.error) return g.error;
  return NextResponse.json({ ...g.message, recent: await listOutboundResponses(g.message.id) });
}

export async function PATCH(req: Request, props: Ctx) {
  const g = await guard((await props.params).id);
  if (g.error) return g.error;
  const limited = await limitWrites('chat', realUserId(g.user));
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return NextResponse.json(await updateOutbound(g.message.id, body));
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const g = await guard((await props.params).id);
  if (g.error) return g.error;
  await deleteOutbound(g.message.id);
  return NextResponse.json({ ok: true });
}
