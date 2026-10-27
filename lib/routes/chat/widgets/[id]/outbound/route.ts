import { NextResponse } from 'next/server';
import { getCurrentUser, realUserId } from '@/lib/session';
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
  const limited = await limitWrites('chat', realUserId(user));
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  try {
    return NextResponse.json(await createOutbound(id, realUserId(user), body), { status: 201 });
  } catch (err) {
    return collabError(err);
  }
}
