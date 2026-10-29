import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { deleteTestCase, updateTestCase } from '@/lib/agents-tests';
import { testCaseInputSchema } from '@/lib/agents-config';
import { agentError, canEditAgent, forbidden, notFound, unauthorized, visibleAgentRow } from '@/lib/agents-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; tid: string }> };

export async function PATCH(req: NextRequest, props: Ctx) {
  const { id, tid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const accessRow = await visibleAgentRow(user, id);
  if (!accessRow) return notFound();
  if (!canEditAgent(user, accessRow)) return forbidden();
  const parsed = testCaseInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return agentError(400, 'invalid_input');
  const res = await updateTestCase(user.id, id, tid, parsed.data);
  if (!res.ok) return notFound();
  return NextResponse.json({ test: res.test });
}

export async function DELETE(_req: NextRequest, props: Ctx) {
  const { id, tid } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const accessRow = await visibleAgentRow(user, id);
  if (!accessRow) return notFound();
  if (!canEditAgent(user, accessRow)) return forbidden();
  if (!(await deleteTestCase(user.id, id, tid))) return notFound();
  return NextResponse.json({ ok: true });
}
