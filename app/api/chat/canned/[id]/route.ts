import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import {
  deleteCannedResponse,
  getCannedResponse,
  getChatWidget,
  updateCannedResponse,
} from '@/lib/chat-data';

export const dynamic = 'force-dynamic';

async function canAccessResponse(
  responseId: string,
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
) {
  const response = await getCannedResponse(responseId);
  if (!response) return { ok: false, response: null };
  const widget = await getChatWidget(response.widget_id);
  if (!widget) return { ok: false, response: null };
  if (widget.user_id !== user.id && widget.team_id !== user.team?.id) {
    return { ok: false, response: null };
  }
  return { ok: true, response };
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok, response } = await canAccessResponse(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(response);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessResponse(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const updated = await updateCannedResponse(params.id, {
    shortcut: typeof body.shortcut === 'string' ? body.shortcut : undefined,
    title: typeof body.title === 'string' ? body.title : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
  });

  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { ok } = await canAccessResponse(params.id, user);
  if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await deleteCannedResponse(params.id);
  return NextResponse.json({ ok: true });
}
