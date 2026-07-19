import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteChatWidget, getChatWidget, updateChatWidget } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

function canAccess(widget: Awaited<ReturnType<typeof getChatWidget>>, user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  if (!widget) return false;
  if (widget.user_id === user.id) return true;
  if (widget.team_id && user.team?.id === widget.team_id) return true;
  return false;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!canAccess(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(widget);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!canAccess(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const updated = await updateChatWidget(params.id, {
    name: typeof body.name === 'string' ? body.name : undefined,
    color: typeof body.color === 'string' ? body.color : undefined,
    position:
      body.position === 'bottom-left' || body.position === 'bottom-right'
        ? body.position
        : undefined,
    welcomeMessage: typeof body.welcomeMessage === 'string' ? body.welcomeMessage : undefined,
    fields: Array.isArray(body.fields) ? (body.fields as Parameters<typeof updateChatWidget>[1]['fields']) : undefined,
  });

  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!canAccess(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await deleteChatWidget(params.id);
  return NextResponse.json({ ok: true });
}
