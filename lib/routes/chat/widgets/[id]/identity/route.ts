import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { canAccessWidget } from '@/lib/chat-access';
import { getChatWidget } from '@/lib/chat-data';
import { deleteWidgetIdentitySecret, rotateWidgetIdentitySecret } from '@/lib/chat-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Secreto de verificación de identidad del widget (lib/chat-identity.ts).
 * POST genera uno nuevo (o lo reemplaza), DELETE apaga la verificación.
 * Solo owner/admin: con el secreto se puede firmar cualquier email.
 */
async function guard(id: string): Promise<{ res: NextResponse } | { widgetId: string }> {
  const user = await getCurrentUser();
  if (!user) return { res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  if (!isWorkspaceAdmin(user)) return { res: NextResponse.json({ error: 'forbidden' }, { status: 403 }) };
  const widget = await getChatWidget(id);
  if (!await canAccessWidget(widget, user)) return { res: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  return { widgetId: id };
}

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard((await props.params).id);
  if ('res' in g) return g.res;
  return NextResponse.json({ secret: await rotateWidgetIdentitySecret(g.widgetId) });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const g = await guard((await props.params).id);
  if ('res' in g) return g.res;
  await deleteWidgetIdentitySecret(g.widgetId);
  return NextResponse.json({ ok: true });
}
