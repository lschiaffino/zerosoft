import { NextResponse } from 'next/server';
import { deleteWebhook, listDeliveries, sendTestWebhook, setWebhookActive } from '@/lib/webhooks';
import { groupsError, groupsSession, readJson } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Log de entregas del webhook (estado, código, intentos, payload). */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ admin: true });
  if (s instanceof NextResponse) return s;
  return NextResponse.json({ deliveries: await listDeliveries(s.ws, (await ctx.params).id, 50) });
}

/** { active } pausa o reanuda; { action: 'test' } manda un ping. */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  const id = (await ctx.params).id;
  const b = await readJson(req);
  if (b.action === 'test') return (await sendTestWebhook(s.ws, id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
  if (typeof b.active !== 'boolean') return groupsError(400, 'invalid_input');
  return (await setWebhookActive(s.ws, id, b.active)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await groupsSession({ write: true, admin: true });
  if (s instanceof NextResponse) return s;
  return (await deleteWebhook(s.ws, (await ctx.params).id)) ? NextResponse.json({ ok: true }) : groupsError(404, 'not_found');
}
