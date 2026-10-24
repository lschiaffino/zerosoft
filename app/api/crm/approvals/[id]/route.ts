import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { cancelApproval, decideApproval, getApproval } from '@/lib/crm-approvals';
import { crmError, forbidden, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ action: z.enum(['approve', 'reject', 'cancel']), note: z.string().max(2000).optional() });

/** Aprobar, rechazar (aprobadores) o cancelar (quien pidió) un pedido pendiente. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const approval = await getApproval(user.id, id);
  if (!approval || !(await canSeeEntity(user.id, 'deal', approval.deal_id, await sessionScope(user)))) return notFound();
  const me = realUserId(user);
  if (parsed.data.action === 'cancel') {
    return (await cancelApproval(user.id, id, me)) ? NextResponse.json({ ok: true }) : crmError(400, 'not_pending');
  }
  const person = user.actingUser ?? user;
  const res = await decideApproval(user.id, id, { id: me, name: person.name ?? '', email: person.email }, parsed.data.action, parsed.data.note ?? '');
  if (!res.ok) {
    if (res.reason === 'forbidden') return forbidden();
    if (res.reason === 'not_found') return notFound();
    return crmError(400, 'not_pending');
  }
  return NextResponse.json({ approval: res.approval, moved: res.moved, missing: res.missing ?? [] });
}
