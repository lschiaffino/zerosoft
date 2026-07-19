import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { createCannedResponse, getChatWidget, listCannedResponses } from '@/lib/chat-data';

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

  const responses = await listCannedResponses(params.id);
  return NextResponse.json({ responses });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
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

  const shortcut = typeof body.shortcut === 'string' ? body.shortcut.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const responseBody = typeof body.body === 'string' ? body.body : '';
  if (!shortcut || !title || !responseBody) {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const response = await createCannedResponse(params.id, { shortcut, title, body: responseBody });
  return NextResponse.json(response, { status: 201 });
}
