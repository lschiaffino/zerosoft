import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { flowRunSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, runFlowNow, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Test run": corre el flow ahora con datos de prueba y devuelve los pasos. */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowRunSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return flowError(400, 'invalid_input');
  const res = await runFlowNow(user.id, id, parsed.data.input);
  if (!res.ok) return res.error === 'not_found' ? notFound() : flowError(429, res.error);
  return NextResponse.json({ run: res.run });
}
