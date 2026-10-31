import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { canAccessWidget } from '@/lib/chat-access';
import { deleteChatWidget, getChatWidget, updateChatWidget } from '@/lib/chat-data';
import { widgetUpdateSchema } from '@/lib/chat-schema';

export const dynamic = 'force-dynamic';


export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(widget);
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const widget = await getChatWidget(params.id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  }

  const parsed = widgetUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some((i) => i.path[0] === 'name');
    return NextResponse.json({ error: nameIssue ? 'missing_name' : 'invalid_input' }, { status: 400 });
  }

  // El nombre del widget es el remitente visible de los emails de Chat: lo cambian solo los admins.
  if (parsed.data.name !== undefined && parsed.data.name.trim() !== widget!.name && !isWorkspaceAdmin(user)) {
    return NextResponse.json({ error: 'rename_admin_only' }, { status: 403 });
  }
  const updated = await updateChatWidget(params.id, parsed.data);
  if (!updated) return NextResponse.json({ error: 'generic' }, { status: 500 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  // Borrar configuración compartida del workspace: solo owner/admin.
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const widget = await getChatWidget(params.id);
  if (!await canAccessWidget(widget, user)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  await deleteChatWidget(params.id);
  return NextResponse.json({ ok: true });
}
