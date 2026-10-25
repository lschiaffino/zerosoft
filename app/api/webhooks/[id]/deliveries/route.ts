import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, isWorkspaceAdmin } from '@/lib/session';
import { listWebhookDeliveries, redeliverWebhook } from '@/lib/webhooks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Log de las últimas entregas del webhook (evento, estado, intentos, código). */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const rows = await listWebhookDeliveries(user.id, id);
  if (!rows) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ rows });
}

const redeliverSchema = z.object({ deliveryId: z.string().min(1).max(64) });

/** Reenvía una entrega con el mismo payload. */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isWorkspaceAdmin(user)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const parsed = redeliverSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  if (!(await redeliverWebhook(user.id, id, parsed.data.deliveryId))) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ rows: await listWebhookDeliveries(user.id, id) });
}
