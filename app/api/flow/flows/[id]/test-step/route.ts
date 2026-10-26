import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { flowStepTestSchema } from '@/lib/flow-schema';
import { canEditFlows, flowError, forbidden, notFound, runViewer, testStepNow, unauthorized } from '@/lib/flow-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Probar paso": corre un solo nodo con datos de prueba (sin crear una corrida). */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!canEditFlows(user)) return forbidden();
  const parsed = flowStepTestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return flowError(400, 'invalid_input');
  if (JSON.stringify(parsed.data.context ?? {}).length > 2_000_000) return flowError(413, 'input_too_large');
  const res = await testStepNow(user.id, id, parsed.data, runViewer(user));
  if (!res.ok) {
    if (res.error === 'not_found') return notFound();
    if (res.error === 'rate_limited') return flowError(429, res.error);
    return flowError(400, res.error);
  }
  return NextResponse.json({ result: res.result });
}
