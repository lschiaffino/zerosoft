import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createChatWidget, listChatWidgets } from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widgets = await listChatWidgets(user.id, user.team?.id ?? null);
  return NextResponse.json({ widgets });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'missing_name' }, { status: 400 });

  const widget = await createChatWidget(user.id, user.team?.id ?? null, {
    name,
    color: typeof body.color === 'string' ? body.color : undefined,
    position:
      body.position === 'bottom-left' || body.position === 'bottom-right'
        ? body.position
        : undefined,
    welcomeMessage: typeof body.welcomeMessage === 'string' ? body.welcomeMessage : undefined,
    fields: Array.isArray(body.fields) ? (body.fields as Parameters<typeof createChatWidget>[2]['fields']) : undefined,
  });

  return NextResponse.json(widget, { status: 201 });
}
