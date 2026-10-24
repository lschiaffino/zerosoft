import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser, realUserId } from '@/lib/session';
import { sessionScope } from '@/lib/crm-visibility';
import { listApprovals, requestApproval } from '@/lib/crm-approvals';
import { crmError, guardRecord, invalidBody, notFound, unauthorized } from '@/lib/crm-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const requestSchema = z.object({ stageId: z.string().trim().min(1).max(100), note: z.string().max(2000).optional() });

/** Pedidos de aprobación del deal (los más nuevos primero). */
export async function GET(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const hidden = await guardRecord(user.id, 'deal', id, await sessionScope(user));
  if (hidden) return hidden;
  return NextResponse.json({ rows: await listApprovals(user.id, { dealId: id, limit: 50 }) });
}

/** Pedir aprobación para mover el deal a una etapa que la exige. */
export async function POST(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const hidden = await guardRecord(user.id, 'deal', id, await sessionScope(user));
  if (hidden) return hidden;
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const person = user.actingUser ?? user;
  const res = await requestApproval(user.id, id, parsed.data.stageId, { id: realUserId(user), name: person.name || person.email }, parsed.data.note ?? '');
  if (!res.ok) return res.reason === 'not_found' ? notFound() : crmError(400, 'approval_not_needed');
  return NextResponse.json({ approval: res.approval, created: res.created }, { status: res.created ? 201 : 200 });
}
