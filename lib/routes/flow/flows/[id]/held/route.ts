import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/session';
import { getFlowRow, resolveHeldRuns } from '@/lib/flow';
import { canEditFlows, flowError, forbidden, notFound, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Corridas retenidas por la protección ante avalanchas: dejarlas correr o descartarlas. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = z
    .object({ action: z.enum(['release', 'discard']), runIds: z.array(z.string().max(100)).max(500).optional() })
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  if (!(await getFlowRow(user.id, id))) return notFound();
  const changed = await resolveHeldRuns(user.id, id, parsed.data.action, parsed.data.runIds);
  return NextResponse.json({ ok: true, changed });
}
