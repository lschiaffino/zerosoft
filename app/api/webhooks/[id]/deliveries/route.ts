import { NextResponse } from 'next/server';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listDeliveries } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Log de entregas de un webhook (las últimas 50, con respuesta y cuerpo). */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rows = await listDeliveries(user.id, id, 50, user.actingUser?.id ?? user.id);
  if (!rows) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ rows });
}
