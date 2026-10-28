import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { deleteVariable, updateVariable } from '@/lib/flow-variables';
import { canEditFlows, flowError, forbidden, notFound, realUserId, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Cambia una variable propia (nunca la de otra persona: lib/flow-variables). */
export async function PATCH(req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z
    .object({ key: z.string().max(100).optional(), value: z.string().max(20_000).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await updateVariable(user.id, realUserId(user), id, parsed.data);
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    return flowError(res.error === 'duplicate_key' ? 409 : 400, res.error);
  }
  return NextResponse.json({ variable: res.variable });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  if (!(await deleteVariable(user.id, realUserId(user), id))) return notFound();
  return NextResponse.json({ ok: true });
}
